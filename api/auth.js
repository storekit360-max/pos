'use strict';
const crypto = require('node:crypto');
const { db } = require('./_db');
const { json, session, setSession, clearSession, authorized } = require('./_http');
const { hash, verify } = require('./_password');
const { ensureMain, tenantId, license, announcements, rootDomain, tenantForRequest, hostSlug } = require('./_tenant');
const { registerTenantDomain } = require('./_vercel-domain');
const Billing = require('./_billing');
// Never send credentials or internal fields to the browser.
const publicUser = (u) => { const out = { ...u }; delete out._id; delete out.hash; delete out.tenantId; delete out.sessionVersion; return out; };
// Licence summary shown in the UI. The two lookups are independent, so run them together.
async function licenseView(database, tid, entitlement, opts = {}) {
  const [rows, notices] = await Promise.all([database.collection('superadmin_settings').find({_id:{$in:['global',Billing.SETTINGS_ID]}}).toArray(), announcements(database,tid)]);
  const settings = rows.find(x=>x._id==='global'), { _id: _skip, ...billingSettings } = rows.find(x=>x._id===Billing.SETTINGS_ID) || {};
  const support = billingSettings.supportContact || settings?.supportContact || '';
  const view = {state:entitlement.state,expiresAt:entitlement.tenant?.expiresAt||entitlement.tenant?.trialEndsAt||null,daysLeft:entitlement.daysLeft,plan:entitlement.tenant?.planSnapshot?.name||'Standard',message:entitlement.state==='expired'?'Subscription payment is due. Pay the outstanding amount below; access remains available while super admin confirms payment.':entitlement.state==='grace'?`Your subscription is in its grace period (${entitlement.daysLeft} days remaining).`:'',announcements:notices};
  // The public pre-login status call never carries amounts or bank details.
  if (!opts.publicView && entitlement.tenant) view.billing = Billing.view(entitlement.tenant, { monthlyFee: Billing.DEFAULT_FEE, currency: 'LKR', ...billingSettings }, entitlement.state);
  return view;
}
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if (['POST','PUT','DELETE'].includes(req.method) && req.headers.origin) { try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res,403,{error:'Cross-origin request rejected'}); } catch { return json(res,403,{error:'Invalid request origin'}); } }
  try {
    const database = await db(), users = database.collection('users');
    const requestedMode = new URL(req.url,'https://pos.invalid').searchParams.get('mode');
    const hostTenant = await tenantForRequest(database, req);
    const requestHost=String(req.headers.host||'').trim().toLowerCase().replace(/:\d+$/,'');
    const rootHost=!!rootDomain(req)&&requestHost===rootDomain(req);
    if (req.method === 'POST' && !['setup','register','login','handoff'].includes(requestedMode) && !authorized(req,res)) return;
    if (req.method === 'GET' && req.url.split('?')[0] === '/api/auth') {
      if (requestedMode === 'status' && rootHost) {const siteBrand=(await database.collection('superadmin_settings').findOne({_id:'global'},{projection:{_id:0,siteLogo:1,siteFavicon:1}}))||{};return json(res,200,{setupRequired:false,registrationOpen:process.env.POS_REGISTRATION_OPEN === 'true',tenantCreationOnly:true,siteBranding:{logo:siteBrand.siteLogo||'',favicon:siteBrand.siteFavicon||''}});}
      if (requestedMode === 'slug') {
        const slug=String(new URL(req.url,'https://pos.invalid').searchParams.get('value')||'').trim().toLowerCase();
        if(!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug))return json(res,200,{available:false,valid:false});
        const used=await database.collection('tenants').findOne({slug},{projection:{_id:1}});
        const root=rootDomain(req);
        const currentHost=String(req.headers.host||'').trim().toLowerCase().replace(/:\d+$/,'');
        // Vercel's shared *.vercel.app hostnames cannot be delegated as wildcard domains.
        const subdomain=root&&!root.endsWith('.vercel.app')?`${slug}.${root}`:null;
        return json(res,200,{available:!!subdomain&&!used,valid:true,subdomain,displayDomain:root||currentHost,wildcardSupported:!!subdomain});
      }
      if (requestedMode === 'status') {
        if (hostSlug(req) && !hostTenant) return json(res,404,{error:'Shop subdomain was not found'});
        const scope = hostTenant?._id || 'main', registrationOpen = process.env.POS_REGISTRATION_OPEN === 'true';
        // These three reads are independent; running them together removes two sequential database round trips.
        const [state, anyTenant, existing] = await Promise.all([
          database.collection('pos_state').findOne({_id:scope},{projection:{_id:1,'data.settings.business':1,'data.settings.tagline':1,'data.settings.accent':1}}),
          database.collection('tenants').findOne({}, {projection:{_id:1}}),
          users.findOne({tenantId:scope},{projection:{_id:1}})
        ]);
        const initialized = !!state;
        if (!anyTenant && !initialized && (await users.countDocuments())===0) return json(res,200,{setupRequired:true});
        if (existing || initialized || (scope==='main' && anyTenant)) {
          const entitlement = await license(database,scope), view = await licenseView(database,scope,entitlement,{publicView:true}), publicSettings = state?.data?.settings||{};
          const siteBrand=(await database.collection('superadmin_settings').findOne({_id:'global'},{projection:{_id:0,siteLogo:1,siteFavicon:1}}))||{};
          return json(res,200,{setupRequired:false,registrationOpen,tenant:{name:hostTenant?.name||'The Smart POS',slug:hostTenant?.slug||'main',branding:{business:String(publicSettings.business||hostTenant?.name||'The Smart POS').slice(0,120),tagline:String(publicSettings.tagline||'').slice(0,160),accent:/^#[0-9a-f]{6}$/i.test(publicSettings.accent||'')?publicSettings.accent:'#f97316',logo:siteBrand.siteLogo||''}},siteBranding:{favicon:siteBrand.siteFavicon||'',logo:siteBrand.siteLogo||''},license:view});
        }
        return json(res,200,{setupRequired:false,registrationOpen});
      }
      const s = session(req); if (!s) return json(res,200,{ authenticated:false });
      if (rootHost) return json(res,200,{authenticated:false,user:null});
      await ensureMain(database);
      const tid = tenantId(s);
      if (!hostTenant || hostTenant._id !== tid) return json(res,200,{authenticated:false,user:null});
      const fullUser = await users.findOne({ id:s.userId, tenantId:tid, active:true });
      const user = fullUser && (s.sessionVersion||0)===(fullUser.sessionVersion||0) ? publicUser(fullUser) : null;
      const entitlement = user ? await license(database, tid) : null;
      if (entitlement && ['suspended','cancelled','deleted'].includes(entitlement.state)) return json(res,200,{authenticated:false,user:null,license:{state:entitlement.state,message:'This shop account is suspended. Contact support.'}});
      return json(res,200,{ authenticated:!!user, user:user || null, ...(entitlement ? {license:await licenseView(database,tid,entitlement)} : {}) });
    }
    if (req.method !== 'POST') return json(res,405,{error:'Method not allowed'});
    const mode = new URL(req.url,'https://pos.invalid').searchParams.get('mode');
    if (mode === 'setup') {
      if (rootHost) return json(res,403,{error:'Create a shop from this domain. Shop setup is only available on its shop subdomain.'});
      if (await users.countDocuments() || await database.collection('pos_state').findOne({_id:'main'},{projection:{_id:1}}) || await database.collection('tenants').findOne({},{projection:{_id:1}})) return json(res,409,{error:'Live POS setup is already complete'});
      const { name, username, password, business, phone, address, currency } = req.body || {};
      const un = String(username || '').trim().toLowerCase();
      if (!name || !/^[a-z0-9._-]{3,40}$/.test(un) || String(password || '').length < 10 || !business) return json(res,400,{error:'Enter a business name, valid username, and password of at least 10 characters'});
      const owner = {id:crypto.randomUUID(),tenantId:'main',name:String(name).trim(),username:un,role:'owner',active:true};
      const hashValue = await hash(String(password));
      try { await users.insertOne({ ...owner, hash:hashValue, createdAt:new Date() }); } catch (error) { if (error.code === 11000) return json(res,409,{error:'Live POS setup is already complete'}); throw error; }
      const d = { v:1, settings:Object.fromEntries(Object.entries({ business, phone, address, currency }).map(([k,v])=>[k,String(v ?? '').trim().slice(0,200)]).filter(([,v])=>v)), categories:['Smartphones','Feature Phones','Tablets','Chargers','Charging Cables','Power Banks','Earphones','Headphones','Bluetooth Speakers','Phone Cases','Screen Protectors','Memory Cards','USB Drives','Smartwatches','Phone Parts','Repair Accessories','Other Accessories'], brands:['Apple','Samsung','Xiaomi','Huawei','Oppo','Vivo','Realme','Anker','JBL','Generic'], expCats:['Rent','Electricity','Internet','Salaries','Transport','Repairs','Packaging','Bank Charges','Marketing','Miscellaneous'], products:[], suppliers:[], customers:[], sales:[], returns:[], purchases:[], expenses:[], payments:[], moves:[], held:[], shifts:[], attendance:[], audit:[], quotations:[], quotationTemplates:[], users:[{...owner,hash:''}], counters:{sale:0,pur:0,ret:0,bar:0,sku:0,quote:0} };
      const init = await database.collection('pos_state').updateOne({ _id:'main' },{$setOnInsert:{ data:d, revision:0, updatedAt:new Date() }},{upsert:true});
      if (!init.upsertedCount) { await users.deleteOne({id:owner.id}); return json(res,409,{error:'Live POS setup is already complete'}); }
      await database.collection('tenants').updateOne({_id:'main'},{$setOnInsert:{name:String(business).trim(),slug:'main',status:'active',planSnapshot:{name:'Grandfathered',userLimit:100000,features:[]},graceDays:7,flags:{},createdAt:new Date(),updatedAt:new Date()}},{upsert:true});
      return json(res,201,{ok:true});
    }
    if (mode === 'register') {
      if (!rootHost) return json(res,403,{error:'Create a shop from the main domain.'});
      const { name, email:requestedEmail, password, business, slug:requestedSlug, phone:requestedPhone } = req.body || {};
      const email = String(requestedEmail || '').trim().toLowerCase();
      const shopName=String(business||'').trim(),slug=String(requestedSlug||'').trim().toLowerCase();
      if (hostSlug(req)) return json(res,400,{error:'Create a shop from the main domain, not a shop subdomain'});
      const configuredRoot=rootDomain(req);
      if (!configuredRoot || configuredRoot.endsWith('.vercel.app')) return json(res,503,{error:'Shop subdomains need a custom domain with wildcard DNS and TLS configured in Vercel. A *.vercel.app address cannot be used.'});
      const ownerName=String(name||'').trim();
      const phone=String(requestedPhone||'').trim();
      if (shopName.length<2 || shopName.length>120 || !/^[\p{L}\p{N}][\p{L}\p{N} .,'&()_-]*$/u.test(shopName) || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug) || ownerName.length<2 || ownerName.length>80 || !/^[\p{L}][\p{L} .'-]*$/u.test(ownerName) || phone.length<5 || phone.length>40 || !/^[+0-9() .-]+$/.test(phone) || phone.replace(/\D/g,'').length<5 || email.length>254 || !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email) || String(password || '').length < 10 || String(password).length > 200) return json(res,400,{error:'Enter valid business, POS address, owner name, contact number, email address, and password details'});
      if (await database.collection('tenants').findOne({slug})) return json(res,409,{error:`${slug}.${configuredRoot} is already taken`});
      if (await users.findOne({email})) return json(res,409,{error:'This email already has a POS account. Sign in with your email to open your existing shop.' ,code:'EMAIL_IN_USE'});
      const id=crypto.randomUUID(),now=new Date(), owner={id:crypto.randomUUID(),tenantId:id,name:ownerName,username:email,email,role:'owner',active:true,hash:await hash(String(password)),createdAt:now};
      const tenant={_id:id,name:shopName,slug,status:'trial',planSnapshot:{name:'24-hour trial',userLimit:5,features:[]},trialEndsAt:new Date(now.getTime()+86400000),graceDays:0,staffCount:1,contact:{name:ownerName,email,phone},flags:{},createdAt:now,updatedAt:now};
      try {
        await database.collection('tenants').insertOne(tenant);
        await users.insertOne(owner);
        await database.collection('pos_state').insertOne({_id:id,data:{v:1,settings:{business:shopName,phone,address:'',currency:'LKR'},categories:[],brands:[],expCats:[],products:[],suppliers:[],customers:[],sales:[],returns:[],purchases:[],expenses:[],payments:[],moves:[],held:[],shifts:[],attendance:[],audit:[],quotations:[],users:[],counters:{sale:0,pur:0,ret:0,bar:0,sku:0,quote:0}},revision:0,updatedAt:now});
      } catch(error) { await Promise.allSettled([database.collection('tenants').deleteOne({_id:id}),users.deleteOne({tenantId:id}),database.collection('pos_state').deleteOne({_id:id})]); if(error.code===11000)return json(res,409,{error:'That username or POS address is already in use'}); throw error; }
      const handoffToken=crypto.randomBytes(32).toString('base64url'),handoffHash=crypto.createHash('sha256').update(handoffToken).digest('hex');
      await database.collection('login_handoffs').insertOne({_id:handoffHash,userId:owner.id,tenantId:id,sessionVersion:owner.sessionVersion||0,expiresAt:new Date(Date.now()+10*60*1000),createdAt:new Date()});
      const root=configuredRoot;
      // Attach the hostname before returning a URL to the browser. Otherwise
      // the first visit can arrive before Vercel knows which project serves it.
      try {
        await registerTenantDomain(slug);
      } catch (error) {
        console.error('Vercel domain registration failed:',error.message);
        await Promise.allSettled([
          database.collection('tenants').deleteOne({_id:id}),
          users.deleteOne({tenantId:id}),
          database.collection('pos_state').deleteOne({_id:id}),
          database.collection('login_handoffs').deleteOne({_id:handoffHash})
        ]);
        return json(res,503,{error:error.code==='VERCEL_DOMAIN_CONFIG'
          ? 'Your shop could not be opened because automatic domain setup is not configured. Contact support.'
          : 'Your shop address could not be activated. Please try again or contact support.'});
      }
      return json(res,201,{ok:true,tenant:{name:shopName,slug},tenantUrl:`https://${slug}.${root}`,handoffToken,user:{id:owner.id,name:owner.name,email:owner.email,role:owner.role}});
    }
    if (mode === 'login') {
      const { username, password } = req.body || {}, un = String(username || '').trim().toLowerCase();
      if (rootHost) {
        if (!un || !password) return json(res,400,{error:'Enter your email and password.'});
        const matches=await users.find({$or:[{email:un},{username:un}],active:true}).limit(20).toArray();
        const verified=[];
        for (const candidate of matches) if (candidate.hash && await verify(String(password),candidate.hash)) verified.push(candidate);
        if (!verified.length) return json(res,401,{error:'We couldn’t find a shop account with those details. Check your email and password.'});
        if (verified.length>1) return json(res,409,{error:'This email is linked to more than one shop. Contact support to resolve the duplicate account.' ,code:'MULTIPLE_SHOPS'});
        const user=verified[0], tenant=await database.collection('tenants').findOne({_id:user.tenantId});
        if (!tenant || tenant.status==='deleted' || tenant.slug==='main') return json(res,403,{error:'This account uses the main POS address. Please contact support to confirm your sign-in address.'});
        const entitlement=await license(database,user.tenantId);
        if (['suspended','cancelled','deleted'].includes(entitlement.state)) return json(res,403,{error:'This shop account is suspended. Contact support.',code:'TENANT_SUSPENDED'});
        const token=crypto.randomBytes(32).toString('base64url'),tokenHash=crypto.createHash('sha256').update(token).digest('hex'),expiresAt=new Date(Date.now()+2*60*1000);
        await database.collection('login_handoffs').insertOne({_id:tokenHash,userId:user.id,tenantId:user.tenantId,sessionVersion:user.sessionVersion||0,expiresAt,createdAt:new Date()});
        const root=rootDomain(req);
        return json(res,200,{ok:true,tenantUrl:`https://${tenant.slug}.${root}/?handoff=${encodeURIComponent(token)}`});
      }
      await ensureMain(database);
      if (!hostTenant) return json(res,404,{error:'Shop subdomain was not found'});
      const user = await users.findOne({username:un,tenantId:hostTenant._id,active:true});
      if (!user || !await verify(String(password || ''),user.hash)) return json(res,401,{error:'Invalid username or password'});
      const entitlement = await license(database, user.tenantId || 'main');
      if (['suspended','cancelled','deleted'].includes(entitlement.state)) return json(res,403,{error:'This shop account is suspended. Contact support.',code:'TENANT_SUSPENDED'});
      await database.collection('tenants').updateOne({_id:user.tenantId||'main'},{$set:{lastActiveAt:new Date()}});
      setSession(res,user.id,user.tenantId || 'main',user.sessionVersion||0); return json(res,200,{ok:true,user:{id:user.id,name:user.name,username:user.username,role:user.role,active:true},license:await licenseView(database,user.tenantId||'main',entitlement)});
    }
    if (mode === 'handoff') {
      if (rootHost || !hostTenant) return json(res,400,{error:'Open your shop address to finish signing in.'});
      const token=String(req.body?.token||'');
      if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))return json(res,400,{error:'Sign-in link is invalid or expired. Please try again.'});
      const tokenHash=crypto.createHash('sha256').update(token).digest('hex'),handoffs=database.collection('login_handoffs');
      const handoff=await handoffs.findOneAndDelete({_id:tokenHash,tenantId:hostTenant._id,expiresAt:{$gt:new Date()}});
      if(!handoff)return json(res,401,{error:'Sign-in link has expired. Please enter your details again.'});
      // Older accounts predate sessionVersion and have no field stored. Treat
      // that as version 0, while still invalidating links after account edits.
      const user=await users.findOne({id:handoff.userId,tenantId:hostTenant._id,active:true});
      if(!user || (user.sessionVersion||0)!==(handoff.sessionVersion||0))return json(res,401,{error:'Your account changed. Please enter your details again.'});
      const entitlement=await license(database,user.tenantId);
      if(['suspended','cancelled','deleted'].includes(entitlement.state))return json(res,403,{error:'This shop account is suspended. Contact support.',code:'TENANT_SUSPENDED'});
      setSession(res,user.id,user.tenantId,user.sessionVersion||0);
      // Return the signed-in user and licence now so the browser does not need an extra status call before loading shop data.
      return json(res,200,{ok:true,user:publicUser(user),license:await licenseView(database,user.tenantId,entitlement)});
    }
    if (mode === 'staff') {
      const s = session(req);
      if (!s) return json(res,401,{error:'Please sign in again'});
      const tid = tenantId(s);
      if (!hostTenant || hostTenant._id !== tid) return json(res,403,{error:'Session does not belong to this shop',code:'TENANT_HOST_MISMATCH'});
      const actor = await users.findOne({id:s.userId,tenantId:tid,active:true});
      if (!actor || actor.role !== 'owner') return json(res,403,{error:'Only an active owner can manage staff accounts'});
      const { action, id, name, username, password, role, active } = req.body || {};
      if (action === 'create') {
        const un = String(username || '').trim().toLowerCase();
        if (!String(name || '').trim() || !/^[a-z0-9._-]{3,40}$/.test(un) || String(password || '').length < 10 || !['owner','manager','cashier'].includes(role)) return json(res,400,{error:'Enter a name, valid username, role, and password of at least 10 characters'});
        const ent = await license(database,tid);
        const limit = Number(ent.tenant?.planSnapshot?.userLimit || 5);
        if (await users.findOne({username:un,tenantId:tid})) return json(res,409,{error:'Username already exists in this shop'});
        let reservation = await database.collection('tenants').findOneAndUpdate({_id:tid,staffCount:{$lt:limit}},{$inc:{staffCount:1}},{returnDocument:'after'});
        if (!reservation) { const count=await users.countDocuments({tenantId:tid,active:true}); await database.collection('tenants').updateOne({_id:tid,staffCount:{$exists:false}},{$set:{staffCount:count}}); reservation=await database.collection('tenants').findOneAndUpdate({_id:tid,staffCount:{$lt:limit}},{$inc:{staffCount:1}},{returnDocument:'after'}); }
        if (!reservation) return json(res,409,{error:'This plan has reached its staff account limit',code:'USER_LIMIT'});
        const staff = {id:crypto.randomUUID(),tenantId:tid,name:String(name).trim(),username:un,role,active:true,hash:await hash(String(password)),createdAt:new Date()};
        try { await users.insertOne(staff); } catch (error) { await database.collection('tenants').updateOne({_id:tid},{$inc:{staffCount:-1}}); if (error.code === 11000) return json(res,409,{error:'Username already exists'}); throw error; }
        return json(res,201,{user:{id:staff.id,name:staff.name,username:staff.username,role:staff.role,active:true}});
      }
      const target = await users.findOne({id,tenantId:tid});
      if (!target) return json(res,404,{error:'Staff account not found'});
      if (action === 'reset-password') {
        if (String(password || '').length < 10) return json(res,400,{error:'Password must be at least 10 characters'});
        await users.updateOne({id,tenantId:tid},{$set:{hash:await hash(String(password)),updatedAt:new Date()},$inc:{sessionVersion:1}});
        return json(res,200,{ok:true});
      }
      if (action === 'set-active') {
        if (typeof active !== 'boolean') return json(res,400,{error:'Invalid account status'});
        if (target.active === active) return json(res,200,{ok:true});
        if (target.id === actor.id && !active) return json(res,409,{error:'You cannot disable your own account'});
        if (!target.active && active) { const entitlement=await license(database,tid),limit=Number(entitlement.tenant?.planSnapshot?.userLimit||5); let reserve=await database.collection('tenants').findOneAndUpdate({_id:tid,staffCount:{$lt:limit}},{$inc:{staffCount:1}},{returnDocument:'after'}); if(!reserve){const count=await users.countDocuments({tenantId:tid,active:true});await database.collection('tenants').updateOne({_id:tid,staffCount:{$exists:false}},{$set:{staffCount:count}});reserve=await database.collection('tenants').findOneAndUpdate({_id:tid,staffCount:{$lt:limit}},{$inc:{staffCount:1}},{returnDocument:'after'});} if(!reserve)return json(res,409,{error:'This plan has reached its staff account limit',code:'USER_LIMIT'}); }
        if (target.role === 'owner' && target.active && !active) {
          const owners=await users.countDocuments({tenantId:tid,role:'owner',active:true});
          if (owners < 2) return json(res,409,{error:'Keep at least one active owner'});
          const result=await users.updateOne({id,tenantId:tid,role:'owner',active:true},{$set:{active:false,updatedAt:new Date()},$inc:{sessionVersion:1}});
          if (!result.modifiedCount) return json(res,409,{error:'Keep at least one active owner'});
          await database.collection('tenants').updateOne({_id:tid},{$inc:{staffCount:-1}});
          return json(res,200,{ok:true});
        }
        const update={$set:{active,updatedAt:new Date()},$inc:{sessionVersion:1}}, changed=await users.updateOne({id,tenantId:tid,active:target.active},update);
        if (!changed.modifiedCount && active) await database.collection('tenants').updateOne({_id:tid},{$inc:{staffCount:-1}});
        if (!active && changed.modifiedCount) await database.collection('tenants').updateOne({_id:tid},{$inc:{staffCount:-1}});
        return json(res,200,{ok:true});
      }
      if (action === 'list') return json(res,200,{users:await users.find({tenantId:tid}, {projection:{_id:0,hash:0,tenantId:0}}).toArray()});
      return json(res,400,{error:'Invalid staff action'});
    }
    if (mode === 'logout') { clearSession(res); return json(res,200,{ok:true}); }
    return json(res,400,{error:'Invalid authentication action'});
  } catch (e) { console.error('POS auth failure:',e.message); return json(res,500,{error:e.publicMessage || (e.message.includes('not configured') ? e.message : 'Authentication service is temporarily unavailable')}); }
};

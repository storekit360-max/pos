'use strict';
(() => {
  const $=s=>document.querySelector(s), main=$('#main'), nav=$('#nav'), notice=$('#notice'), modal=$('#modal');
  let csrf='', admin=null, page=1, tenantName='', pending=null;
  const el=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);if(cls)x.className=cls;return x;};
  const safeCsv=rows=>rows.map(row=>row.map(value=>{let s=String(value??'');if(typeof value==='string'&&/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
  const btn=(label,fn,cls='')=>{const b=el('button',label,cls);b.type='button';b.addEventListener('click',fn);return b;};
  const api=async(route,body,method)=>{
    const m=method|| (body?'POST':'GET'),h={'Accept':'application/json'},parts=route.split('&'),name=parts[0],url=`/api/superadmin?r=${encodeURIComponent(parts.shift())}${parts.length?'&'+parts.join('&'):''}`;
    if(body)h['Content-Type']='application/json';
    if(csrf&&m!=='GET')h['X-CSRF-Token']=csrf;
    let r;
    try{r=await fetch(url,{method:m,headers:h,credentials:'same-origin',body:body?JSON.stringify(body):undefined});}
    catch(_){throw Object.assign(Error('Cannot reach the server. Check your connection and try again.'),{code:'NETWORK'});}
    let d={};try{d=await r.json();}catch(_){}
    if(!r.ok){
      const err=Object.assign(Error(d.error||(r.status===404?'The superadmin API was not found on this server.':`Request failed (${r.status})`)),{status:r.status,code:d.code});
      if(admin&&name!=='session.login'&&(d.code==='UNAUTHENTICATED'||d.code==='MFA_REQUIRED')){
        err.handled=true;
        endSession(d.code==='MFA_REQUIRED'?'Two-factor setup was not completed. Please sign in again.':'Your session has expired. Please sign in again.');
      }
      throw err;
    }
    return d;
  };
  const toast=(msg,bad=false)=>{notice.replaceChildren();const x=el('div',msg,`toast${bad?' error':''}`);x.setAttribute('role','status');notice.append(x);};
  const heading=(title,...actions)=>{const h=el('div',undefined,'title');h.append(el('h1',title));for(const a of actions)h.append(a);main.replaceChildren(h);};
  const card=(title)=>{const c=el('section',undefined,'card');if(title)c.append(el('h2',title));main.append(c);return c;};
  const field=(label,type='text',value='',name='')=>{const l=el('label',undefined,'field');l.append(el('span',label));const x=type==='textarea'?el('textarea'):el(type==='select'?'select':'input');if(type!=='textarea'&&type!=='select')x.type=type;if(value!==undefined)x.value=value;if(name)x.name=name;l.append(x);l.control=x;return l;};
  const row=()=>{const x=el('div',undefined,'row');main.append(x);return x;};
  const table=(headers,items,render)=>{const wrap=el('div',undefined,'scroll'),t=el('table'),thead=el('thead'),tr=el('tr');headers.forEach(h=>tr.append(el('th',h)));thead.append(tr);t.append(thead);const tb=el('tbody');items.forEach(item=>{const r=el('tr');render(r,item);tb.append(r);});t.append(tb);wrap.append(t);return wrap;};
  const modalShow=(title,content,actions)=>{$('#modal-title').textContent=title;const b=$('#modal-body');b.replaceChildren();if(typeof content==='string')b.append(el('p',content));else b.append(content);const a=$('#modal-actions');a.replaceChildren(...actions);modal.hidden=false;actions[0]?.focus();};
  const secret=(label,value)=>{const box=el('div'),x=el('p',label),v=el('code',value,'mono');box.append(x,v);modal.dataset.secret='true';modalShow('Save this secret now',box,[btn('Copy',async()=>{await navigator.clipboard.writeText(value);toast('Copied to clipboard');}),btn('I have saved it',()=>{modal.dataset.secret='false';modal.hidden=true;})]);};
  /* ================= Sign-in, MFA setup and session handling ================= */
  const boot=$('#boot'), authBox=$('#auth'), appBox=$('#app'), loginForm=$('#login-form'), enrollForm=$('#enroll-form');
  const loginEmail=$('#login-email'), loginPass=$('#login-password'), loginCode=$('#login-code'), loginSubmit=$('#login-submit'), loginError=$('#login-error');
  const enrollCode=$('#enroll-code'), enrollSubmit=$('#enroll-submit'), enrollError=$('#enroll-error');
  const formMsg=(box,text,info)=>{box.textContent=text||'';box.hidden=!text;box.classList.toggle('info',!!info);};
  const view=name=>{
    boot.hidden=true;
    appBox.hidden=name!=='app';
    authBox.hidden=name==='app';
    loginForm.hidden=name!=='login';
    enrollForm.hidden=name!=='enroll';
    document.title=name==='app'?'Smart POS Superadmin':name==='enroll'?'Set up MFA · Smart POS Superadmin':'Sign in · Smart POS Superadmin';
  };
  function showLogin(message,info=true){
    view('login');
    formMsg(loginError,message,info);
    loginPass.value='';loginCode.value='';
    (loginEmail.value?loginPass:loginEmail).focus();
  }
  function showEnroll(){
    view('enroll');
    formMsg(enrollError,'');
    const key=pending.secret, label='Smart POS Superadmin';
    $('#enroll-secret').textContent=key.replace(/(.{4})/g,'$1 ').trim();
    $('#enroll-link').href=`otpauth://totp/${encodeURIComponent(label)}:${encodeURIComponent(pending.email)}?secret=${key}&issuer=${encodeURIComponent(label)}&algorithm=SHA1&digits=6&period=30`;
    enrollCode.value='';enrollCode.focus();
  }
  function showApp(){
    view('app');
    notice.replaceChildren();
    nav.classList.remove('open');$('#menu').setAttribute('aria-expanded','false');
    $('#who').textContent=admin?`${admin.email} · ${admin.role}`:'';
  }
  function endSession(message,info=true){
    csrf='';admin=null;pending=null;
    modal.hidden=true;modal.dataset.secret='false';
    notice.replaceChildren();
    showLogin(message,info);
  }
  const go=hash=>{if(location.hash===hash)return route();location.hash=hash;};
  const cleanCode=v=>String(v||'').replace(/\s+/g,'').toLowerCase();

  loginForm.addEventListener('submit',async e=>{
    e.preventDefault();
    const email=loginEmail.value.trim(),password=loginPass.value,code=cleanCode(loginCode.value);
    if(!email.includes('@')||!password){formMsg(loginError,'Enter your email address and password.');(email.includes('@')?loginPass:loginEmail).focus();return;}
    formMsg(loginError,'');
    loginSubmit.disabled=true;loginSubmit.textContent='Signing in…';
    try{
      const r=await api('session.login',{email,password,code});
      csrf=r.csrf;
      loginPass.value='';loginCode.value='';
      if(r.mfaEnrollmentRequired){
        pending={email:r.email||email,role:r.role,secret:r.totpSecret};
        showEnroll();
      }else{
        admin=r.admin||{email,role:''};
        showApp();
        await go(location.hash&&location.hash!=='#/'?location.hash:'#/dashboard');
      }
    }catch(err){
      loginPass.value='';
      formMsg(loginError,err.message,false);
      (err.code==='INVALID_MFA'?loginCode:loginPass).focus();
    }finally{
      loginSubmit.disabled=false;loginSubmit.textContent='Sign in';
    }
  });

  $('#pw-toggle').addEventListener('click',()=>{
    const show=loginPass.type==='password';
    loginPass.type=show?'text':'password';
    $('#pw-toggle').textContent=show?'Hide':'Show';
    $('#pw-toggle').setAttribute('aria-pressed',String(show));
    $('#pw-toggle').setAttribute('aria-label',show?'Hide password':'Show password');
    loginPass.focus();
  });
  const caps=ev=>{if(ev.getModifierState)$('#caps').hidden=!ev.getModifierState('CapsLock');};
  loginPass.addEventListener('keydown',caps);loginPass.addEventListener('keyup',caps);loginPass.addEventListener('blur',()=>{$('#caps').hidden=true;});

  enrollForm.addEventListener('submit',async e=>{
    e.preventDefault();
    const code=cleanCode(enrollCode.value);
    if(!/^\d{6}$/.test(code)){formMsg(enrollError,'Enter the 6-digit code from your authenticator app.');enrollCode.focus();return;}
    formMsg(enrollError,'');
    enrollSubmit.disabled=true;enrollSubmit.textContent='Verifying…';
    try{
      const done=await api('session.enroll',{code});
      csrf=done.csrf;
      admin={email:pending.email,role:pending.role};pending=null;
      showApp();
      await go('#/dashboard');
      secret('Recovery codes. Store them securely; they will not be shown again.',done.recoveryCodes.join('\n'));
    }catch(err){
      if(err.code==='UNAUTHENTICATED'){endSession('Your setup session expired. Please sign in again.');}
      else{formMsg(enrollError,err.message,false);enrollCode.value='';enrollCode.focus();}
    }finally{
      enrollSubmit.disabled=false;enrollSubmit.textContent='Confirm and continue';
    }
  });
  $('#enroll-copy').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(pending.secret);formMsg(enrollError,'Key copied to clipboard.',true);}
    catch(_){formMsg(enrollError,'Copy failed. Select the key above and copy it manually.');}
  });
  $('#enroll-cancel').addEventListener('click',async()=>{
    try{await api('session.logout',{});}catch(_){}
    endSession('Sign-in cancelled. MFA must be set up before you can use the panel.');
  });

  /* ================= Dashboard (live data from the backend) ================= */
  let dashRun=0;
  const num=v=>Number(v||0).toLocaleString();
  const mbText=b=>`${(Number(b||0)/1048576).toFixed(2)} MB`;
  const fmt=v=>{const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d.toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'—';};
  const fmtDay=v=>{const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d.toLocaleDateString([],{dateStyle:'medium'}):'—';};
  const cap=v=>String(v||'').charAt(0).toUpperCase()+String(v||'').slice(1);
  const expiryOf=t=>t.status==='trial'?(t.trialEndsAt||t.expiresAt):(t.expiresAt||t.trialEndsAt);
  const pill=status=>el('span',status,`pill pl-${status}`);
  const openBtn=t=>btn('Open',()=>{location.hash=`#/tenants/${encodeURIComponent(t._id)}`;});
  const unavailable=(parent,r)=>parent.append(el('p',r.reason?.message||'Not available.','muted'));

  async function dashboard(){
    const run=++dashRun;
    heading('Dashboard',btn('Refresh',()=>dashboard()));
    const status=el('p','Loading dashboard…','muted');main.append(status);
    const [dR,tR,pR,hR,rR]=await Promise.allSettled([api('dashboard'),api('tenants.list&page=1&limit=50'),api('payments.list&limit=8'),api('health'),api('releases')]);
    if(run!==dashRun||!admin||!/^(#\/?(dashboard)?)?$/.test(location.hash))return;
    status.remove();
    if(dR.status==='rejected'){
      if(!dR.reason.handled){const c=card('Dashboard could not be loaded');c.append(el('p',dR.reason.message,'error-text'),btn('Try again',()=>dashboard(),'primary'));}
      return;
    }
    const d=dR.value,counts=d.counts||{},tenants=tR.status==='fulfilled'?(tR.value.items||[]):[],names=Object.fromEntries(tenants.map(t=>[t._id,t.name]));
    main.append(el('p',`Live data · updated ${new Date().toLocaleTimeString()}`,'muted'));

    // KPI cards
    const kpis=[
      ['Total shops',num(d.tenantCount),'all states'],
      ['Active',num(counts.active),'paying / licensed'],
      ['On trial',num(counts.trial),''],
      ['Expiring in 7 days',num(d.expiringIn7Days),'renewal needed soon',d.expiringIn7Days>0?'warn':''],
      ['Expiring in 30 days',num(d.expiringIn30Days),''],
      ['Grace period',num(counts.grace),'past expiry, still working',counts.grace>0?'warn':''],
      ['Expired',num(counts.expired),'',counts.expired>0?'bad':''],
      ['Suspended',num(counts.suspended),''],
      ['Revenue (LKR) this month',num(d.revenueThisMonth),'recorded payments'],
      ['New shops this month',num(d.newTenantsThisMonth),''],
      ['Staff accounts',num(d.totalUsers),'across all shops'],
      ['Stored POS data',mbText(d.storageBytes),'across all shops']
    ];
    const grid=el('div',undefined,'grid kpis');
    for(const [label,value,hint,tone] of kpis){const c=el('div',undefined,`card metric${tone?' '+tone:''}`);c.append(el('small',label),el('b',value));if(hint)c.append(el('small',hint,'muted'));grid.append(c);}
    main.append(grid);

    // Status distribution
    const dist=card('Shops by status'),keys=['active','trial','grace','expired','suspended'],total=keys.reduce((n,k)=>n+(Number(counts[k])||0),0);
    if(!total)dist.append(el('p','No shops yet. Create the first one from Tenants.','empty'));
    else{
      const bar=el('div',undefined,'bar'),legend=el('div',undefined,'legend');
      bar.setAttribute('role','img');bar.setAttribute('aria-label',keys.map(k=>`${cap(k)} ${counts[k]||0}`).join(', '));
      for(const k of keys){
        const n=Number(counts[k])||0;
        if(n){const seg=el('span',undefined,`st-${k}`);seg.style.width=`${(n/total)*100}%`;seg.title=`${cap(k)}: ${n}`;bar.append(seg);}
        const lg=el('span',undefined,'lg');lg.append(el('i',undefined,`dot st-${k}`),document.createTextNode(`${cap(k)} ${n}`));legend.append(lg);
      }
      dist.append(bar,legend);
    }

    // Needs attention + recent shops
    const cols=el('div',undefined,'cols');main.append(cols);
    const mk=(title)=>{const c=el('section',undefined,'card');c.append(el('h2',title));cols.append(c);return c;};
    const now=Date.now(),attention=mk('Needs attention');
    if(tR.status!=='fulfilled')unavailable(attention,tR);
    else{
      const rows=tenants.filter(t=>{
        if(['cancelled','deleted'].includes(t.status))return false;
        if(['grace','expired','suspended'].includes(t.status))return true;
        const e=expiryOf(t);return e&&new Date(e).getTime()-now<=14*86400000;
      }).map(t=>({t,e:expiryOf(t)})).sort((x,y)=>(x.e?new Date(x.e).getTime():0)-(y.e?new Date(y.e).getTime():0)).slice(0,8);
      if(!rows.length)attention.append(el('p','Nothing needs attention right now.','empty'));
      else attention.append(table(['Shop','Status','Expires','',''],rows,(tr,{t,e})=>{
        const days=e?Math.ceil((new Date(e).getTime()-now)/86400000):null,td=el('td');td.append(pill(t.status));
        tr.append(el('td',t.name),td,el('td',fmtDay(e)),el('td',days===null?'':days<0?`${-days} d overdue`:`${days} d left`));
        const a=el('td',undefined,'actions');a.append(openBtn(t));tr.append(a);
      }));
    }
    const recent=mk('Newest shops');
    if(tR.status!=='fulfilled')unavailable(recent,tR);
    else if(!tenants.length)recent.append(el('p','No shops yet.','empty'));
    else recent.append(table(['Shop','Status','Plan','Staff','Created',''],tenants.slice(0,5),(tr,t)=>{
      const td=el('td');td.append(pill(t.status));
      tr.append(el('td',t.name),td,el('td',t.planSnapshot?.name||'—'),el('td',num(t.userCount)),el('td',fmtDay(t.createdAt)));
      const a=el('td',undefined,'actions');a.append(openBtn(t));tr.append(a);
    }));

    // Payments + system
    const cols2=el('div',undefined,'cols');main.append(cols2);
    const mk2=(title)=>{const c=el('section',undefined,'card');c.append(el('h2',title));cols2.append(c);return c;};
    const pay=mk2('Recent payments');
    if(pR.status!=='fulfilled')unavailable(pay,pR);
    else if(!(pR.value.items||[]).length)pay.append(el('p','No payments recorded yet.','empty'));
    else pay.append(table(['Shop','Amount','Method','Recorded',''],pR.value.items,(tr,p)=>{
      tr.append(el('td',names[p.tenantId]||String(p.tenantId||'').slice(0,8)),el('td',`${p.currency||'LKR'} ${num(p.amount)}`),el('td',p.method||'—'),el('td',fmt(p.createdAt)));
      tr.append(el('td',p.voidedAt?'Voided':''));
    }));
    const sys=mk2('System');
    if(hR.status==='fulfilled'){
      const h=hR.value,missing=Object.entries(h.env||{}).filter(([,ok])=>!ok).map(([k])=>k);
      sys.append(el('p',`MongoDB: ${h.mongo?.ok?'Online':'Unavailable'}${h.mongo?.latencyMs!==undefined?` (${h.mongo.latencyMs} ms)`:''}`),
        el('p',`Region: ${h.region||'unknown'} · System errors (24 h): ${num(h.recentSystemErrors)}`),
        el('p',missing.length?`Missing environment variables: ${missing.join(', ')}`:'Required environment variables are set.',missing.length?'error-text':'muted'));
    }else if(hR.reason?.code!=='FORBIDDEN')unavailable(sys,hR);
    if(rR.status==='fulfilled')sys.append(el('p',`Installer version: ${rR.value.version||'unavailable'} · UI revision: ${rR.value.ui?.revision||'unavailable'}`));
    if(!sys.querySelector('p'))sys.append(el('p','System details are not available for your role.','muted'));

    // Activity
    const act=card('Recent activity');
    if(!(d.recentAudit||[]).length)act.append(el('p','No activity recorded yet.','empty'));
    else act.append(table(['When','Actor','Action','Summary'],d.recentAudit,(tr,x)=>[fmt(x.ts),x.actorEmail,x.action,x.summary].forEach(v=>tr.append(el('td',v||'')))));
  }
  async function tenants(){heading('Tenants',btn('Create tenant',createTenant,'primary'));const filters=row(),q=field('Search','search','','search');q.control.placeholder='Name, slug or email';const state=field('State','select');['','trial','active','grace','expired','suspended','cancelled','deleted'].forEach(v=>{const o=el('option',v||'All states');o.value=v;state.control.append(o);});filters.append(q,state);let timer;const list=async()=>{try{const d=await api(`tenants.list&page=${page}&limit=25&search=${encodeURIComponent(q.control.value)}&state=${state.control.value}`);const c=card('Shop accounts');if(!d.items?.length){c.append(el('p','No tenants match this search.','empty'));return;}c.append(table(['Shop','State','Plan','Staff','Data','Expiry',''],d.items,(tr,t)=>{tr.append(el('td',t.name),el('td',t.status),el('td',t.planSnapshot?.name||''),el('td',t.userCount),el('td',`${(t.dataBytes/1048576).toFixed(2)} MB`),el('td',t.expiresAt||t.trialEndsAt||'—'));const td=el('td',undefined,'actions');td.append(btn('Open',()=>{location.hash=`#/tenants/${encodeURIComponent(t._id)}`;}));tr.append(td);}));const p=el('p',`Page ${d.page} · ${d.total} tenants`);p.append(btn('Previous',()=>{page=Math.max(1,page-1);tenants();}),btn('Next',()=>{page=Math.min(Math.ceil(d.total/25),page+1);tenants();}));c.append(p);}catch(e){toast(e.message,true);}};q.control.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;tenants();},250);});state.control.addEventListener('change',()=>{page=1;tenants();});await list();}
  function createTenant(){const box=el('div'),fields={};[['Shop name','name'],['Slug','slug'],['Owner name','ownerName'],['Username','username'],['Email','email'],['Phone','phone'],['Trial days','trialDays']].forEach(([l,n])=>{fields[n]=field(l,n==='trialDays'?'number':'text',n==='trialDays'?'14':'',n);box.append(fields[n]);});modalShow('Create tenant with owner',box,[btn('Create',async()=>{const b={};for(const[k,v]of Object.entries(fields))b[k]=v.control.value;try{const d=await api('tenants.create',b);modal.hidden=true;secret(`Temporary password for ${d.owner.username}`,d.temporaryPassword);tenantName=d.tenant.name;}catch(e){toast(e.message,true);}},'primary'),btn('Cancel',()=>modal.hidden=true)]);}
  async function downloadTenant(id){const d=await api(`backups.export&tenantId=${encodeURIComponent(id)}`),blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}),a=el('a');a.href=URL.createObjectURL(blob);a.download=`tenant-${id}-backup.json`;a.click();URL.revokeObjectURL(a.href);toast('Tenant data exported.');}
  async function tenantDetail(id){const d=await api(`tenants.get&id=${encodeURIComponent(id)}`),t=d.tenant;tenantName=t.name;heading(t.name,btn('Export data',async()=>{try{await downloadTenant(id);}catch(e){toast(e.message,true);}}));const c=card('License and profile');const info=el('p',`Status: ${t.status} · Plan: ${t.planSnapshot?.name||''} · Users: ${d.usage.users} · Data: ${(d.usage.dataBytes/1048576).toFixed(2)} MB · Revision: ${d.usage.revision}`);c.append(info);const actions=row();if(t.status==='deleted')actions.append(btn('Restore tenant',()=>confirmRestore(t),'primary'));else{for(const [label,status]of[['Activate','active'],['Suspend','suspended'],['Cancel','cancelled']])actions.append(btn(label,()=>confirmTenantAction(t,status),status==='suspended'?'danger':''));actions.append(btn('Delete tenant',()=>confirmDelete(t),'danger'));}const profile=el('div',undefined,'row'),name=field('Shop name','text',t.name),notes=field('Internal notes','textarea',t.notes||''),contact=t.contact||{},contactName=field('Contact name','text',contact.name||''),contactEmail=field('Contact email','email',contact.email||''),phone=field('Phone','tel',contact.phone||'');profile.append(name,notes,contactName,contactEmail,phone);c.append(profile,btn('Save profile',async()=>{try{await api('tenants.update',{id,name:name.control.value,notes:notes.control.value,contact:{...contact,name:contactName.control.value,email:contactEmail.control.value,phone:phone.control.value}});toast('Tenant profile saved');await tenantDetail(id);}catch(e){toast(e.message,true);}}));const expiry=field('Expiry date','date',t.expiresAt?new Date(t.expiresAt).toISOString().slice(0,10):'');c.append(expiry);c.append(btn('Save expiry',async()=>{try{await api('tenants.update',{id,expiresAt:expiry.control.value?new Date(expiry.control.value).toISOString():null});toast('License expiry updated');await tenantDetail(id);}catch(e){toast(e.message,true);}}));if(['root','billing'].includes(admin.role)){const plansData=await api('plans.list'),planCard=card('Assign a plan'),select=field('Active plan','select');(plansData.items||[]).filter(x=>x.active).forEach(x=>{const o=el('option',`${x.name} — ${x.durationDays} days`);o.value=x._id;select.control.append(o);});planCard.append(select,btn('Apply plan and extend',async()=>{try{const plan=(plansData.items||[]).find(x=>x._id===select.control.value);if(!plan)throw Error('Choose an active plan.');const base=t.expiresAt&&new Date(t.expiresAt)>new Date()?new Date(t.expiresAt):new Date(),expiresAt=new Date(base.getTime()+plan.durationDays*86400000);await api('tenants.update',{id,planId:plan._id,planSnapshot:{name:plan.name,userLimit:plan.userLimit,features:plan.features||[]},graceDays:plan.graceDays,expiresAt:expiresAt.toISOString(),status:'active'});toast('Plan applied and license extended');await tenantDetail(id);}catch(e){toast(e.message,true);}},'primary'));}const st=card('Staff accounts');st.append(table(['Name','Username','Role','Status','Actions'],d.staff||[],(tr,u)=>{tr.append(el('td',u.name),el('td',u.username),el('td',u.role),el('td',u.active?'Active':'Disabled'));const td=el('td',undefined,'actions');td.append(btn('Reset password',async()=>{try{const r=await api('staff.reset',{tenantId:id,userId:u.id});secret(`Temporary password for ${u.username}`,r.temporaryPassword);}catch(e){toast(e.message,true);}}),btn(u.active?'Disable':'Enable',async()=>{try{await api('staff.update',{tenantId:id,userId:u.id,active:!u.active});await tenantDetail(id);}catch(e){toast(e.message,true);}}),btn('Sign out',async()=>{try{await api('staff.update',{tenantId:id,userId:u.id,signOut:true});toast('Staff session invalidated');}catch(e){toast(e.message,true);}}));tr.append(td);}));}
  function confirmDelete(t){const box=el('div'),name=field(`Type ${t.name} to confirm`),reason=field('Reason');box.append(el('p','Export the tenant data first. Deletion is soft and can be reversed for 30 days.'),name,reason);modalShow('Delete tenant',box,[btn('Delete',async()=>{try{await api('tenants.delete',{id:t._id,confirmName:name.control.value,reason:reason.control.value});modal.hidden=true;toast('Tenant deleted. Restore is available for 30 days.');location.hash='#/tenants';}catch(e){toast(e.message,true);}},'danger'),btn('Cancel',()=>modal.hidden=true)]);}
  function confirmRestore(t){const box=el('div'),name=field(`Type ${t.name} to confirm`);box.append(el('p','A safety snapshot will be created before the tenant is reactivated.'),name);modalShow('Restore tenant',box,[btn('Restore',async()=>{try{await api('tenants.restore',{id:t._id,confirmName:name.control.value});modal.hidden=true;toast('Tenant restored');await tenantDetail(t._id);}catch(e){toast(e.message,true);}},'primary'),btn('Cancel',()=>modal.hidden=true)]);}
  function confirmTenantAction(t,status){const box=el('div'),reason=field('Reason','text');box.append(el('p',`Set ${t.name} to ${status}?`),reason);modalShow('Confirm tenant change',box,[btn('Confirm',async()=>{try{await api('tenants.update',{id:t._id,status,reason:reason.control.value});modal.hidden=true;toast(`Tenant ${status}`);await tenantDetail(t._id);}catch(e){toast(e.message,true);}},'primary'),btn('Cancel',()=>modal.hidden=true)]);}
  async function plans(){heading('Plans');const d=await api('plans.list'),c=card('Available plans');c.append(table(['Name','Duration','Price','Currency','Users','Grace','Status','Actions'],d.items||[],(tr,p)=>{[p.name,p.durationDays,p.price,p.currency,p.userLimit,p.graceDays,p.active?'Active':'Inactive'].forEach(v=>tr.append(el('td',v)));const td=el('td',undefined,'actions');td.append(btn('Edit',()=>{f.id.control.value=p._id;f.name.control.value=p.name;f.durationDays.control.value=p.durationDays;f.price.control.value=p.price;f.currency.control.value=p.currency;f.userLimit.control.value=p.userLimit;f.graceDays.control.value=p.graceDays;f.features.control.value=(p.features||[]).join(', ');f.active.control.checked=!!p.active;save.textContent='Update plan';}),btn(p.active?'Deactivate':'Activate',async()=>{try{await api('plans.save',{...p,active:!p.active});await plans();}catch(e){toast(e.message,true);}}));tr.append(td);}));const box=el('div',undefined,'row'),f={};[['Plan name','name','text'],['Duration days','durationDays','number'],['Price','price','number'],['Currency','currency','text'],['User limit','userLimit','number'],['Grace days','graceDays','number'],['Features (comma separated)','features','text']].forEach(([l,n,t])=>{f[n]=field(l,t);box.append(f[n]);});f.id=field('','hidden');f.active=field('Active','checkbox');const save=btn('Save plan',async()=>{try{await api('plans.save',{id:f.id.control.value||undefined,name:f.name.control.value,durationDays:+f.durationDays.control.value,price:+f.price.control.value,currency:f.currency.control.value,userLimit:+f.userLimit.control.value,graceDays:+f.graceDays.control.value,features:f.features.control.value.split(',').map(x=>x.trim()).filter(Boolean),active:f.active.control.checked});toast('Plan saved');await plans();}catch(e){toast(e.message,true);}},'primary');const reset=btn('New plan',()=>{f.id.control.value='';f.name.control.value='';f.durationDays.control.value='';f.price.control.value='';f.currency.control.value='LKR';f.userLimit.control.value='';f.graceDays.control.value='';f.features.control.value='';f.active.control.checked=true;save.textContent='Save plan';});f.currency.control.value='LKR';f.active.control.checked=true;card('Create or edit plan').append(box,save,reset);}
  async function payments(){heading('Payments',btn('Export monthly CSV',async()=>{try{const d=await api('payments.csv'),blob=new Blob([d.csv],{type:'text/csv'}),a=el('a');a.href=URL.createObjectURL(blob);a.download=`payments-${d.month}.csv`;a.click();URL.revokeObjectURL(a.href);}catch(e){toast(e.message,true);}}));const c=card('Record a manual payment'),box=el('div',undefined,'row'),f={};[['Tenant ID','tenantId'],['Amount','amount'],['Currency','currency'],['Reference','reference'],['Extension days','extendDays']].forEach(([l,n])=>{f[n]=field(l,n==='amount'||n==='extendDays'?'number':'text',n==='currency'?'LKR':'');box.append(f[n]);});const method=field('Method','select');['cash','bank transfer','card','other'].forEach(v=>{const o=el('option',v);o.value=v;method.control.append(o);});box.append(method);const extend=field('Extend expiry','checkbox');box.append(extend);c.append(box,btn('Record payment',async()=>{try{await api('payments.record',{tenantId:f.tenantId.control.value,amount:+f.amount.control.value,currency:f.currency.control.value,method:method.control.value,reference:f.reference.control.value,extend:extend.control.checked,extendDays:+f.extendDays.control.value});toast('Payment recorded');await payments();}catch(e){toast(e.message,true);}},'primary'));const d=await api('payments.list'),hist=card('Recent payments');hist.append(table(['Tenant','Amount','Method','Reference','Recorded',''],d.items||[],(tr,p)=>{[p.tenantId,`${p.currency} ${p.amount}`,p.method,p.reference,p.createdAt].forEach(v=>tr.append(el('td',v||'')));const td=el('td',undefined,'actions');if(!p.voidedAt)td.append(btn('Void',()=>{const reason=field('Reason for voiding');modalShow('Void payment',reason,[btn('Void payment',async()=>{try{await api('payments.void',{id:p._id,reason:reason.control.value});modal.hidden=true;await payments();}catch(e){toast(e.message,true);}},'danger'),btn('Cancel',()=>modal.hidden=true)]);}));else td.append(el('span','Voided'));tr.append(td);}));}
  async function announcements(){heading('Announcements');let editing=null;const c=card('Publish a banner'),box=el('div'),title=field('Title'),body=field('Message','textarea'),aud=field('Target tenant IDs or all','text','all'),sev=field('Severity','select'),start=field('Starts at','datetime-local'),end=field('Ends at','datetime-local');start.control.value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);end.control.value=new Date(Date.now()+30*86400000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);['info','warn','critical'].forEach(v=>{const o=el('option',v);o.value=v;sev.control.append(o);});box.append(title,body,aud,sev,start,end);const publish=btn('Publish announcement',async()=>{try{await api('announcements.save',{id:editing,title:title.control.value,body:body.control.value,tenantIds:aud.control.value==='all'?'all':aud.control.value.split(',').map(x=>x.trim()),severity:sev.control.value,startsAt:new Date(start.control.value).toISOString(),endsAt:new Date(end.control.value).toISOString(),active:true});toast(editing?'Announcement updated':'Announcement published');await announcements();}catch(e){toast(e.message,true);}},'primary');c.append(box,publish);const d=await api('announcements.list'),hist=card('Scheduled and active');hist.append(table(['Title','Severity','Start','End','Status','Actions'],d.items||[],(tr,x)=>{[x.title,x.severity,x.startsAt,x.endsAt,x.active?'Active':'Inactive'].forEach(v=>tr.append(el('td',v)));const td=el('td',undefined,'actions');td.append(btn('Edit',()=>{editing=x._id;title.control.value=x.title;body.control.value=x.body;aud.control.value=x.tenantIds==='all'?'all':(x.tenantIds||[]).join(',');sev.control.value=x.severity;start.control.value=new Date(new Date(x.startsAt).getTime()-new Date(x.startsAt).getTimezoneOffset()*60000).toISOString().slice(0,16);end.control.value=new Date(new Date(x.endsAt).getTime()-new Date(x.endsAt).getTimezoneOffset()*60000).toISOString().slice(0,16);publish.textContent='Save announcement';title.control.focus();}),btn(x.active?'Deactivate':'Activate',async()=>{try{await api('announcements.save',{id:x._id,title:x.title,body:x.body,tenantIds:x.tenantIds,severity:x.severity,startsAt:x.startsAt,endsAt:x.endsAt,active:!x.active});await announcements();}catch(e){toast(e.message,true);}}));tr.append(td);}));}
  async function auditPage(){heading('Audit log',btn('Export CSV',async()=>{try{const d=await api('audit.csv'),blob=new Blob([d.csv],{type:'text/csv'}),a=el('a');a.href=URL.createObjectURL(blob);a.download='superadmin-audit.csv';a.click();URL.revokeObjectURL(a.href);}catch(e){toast(e.message,true);}}));const d=await api(`audit.list&page=${page}&limit=50`),c=card(`${d.total} entries`);c.append(table(['Time','Actor','Role','Action','Tenant','Summary'],d.items||[],(tr,x)=>[x.ts,x.actorEmail,x.role,x.action,x.tenantId||'—',x.summary].forEach(v=>tr.append(el('td',v||'')))));c.append(btn('Previous',()=>{page=Math.max(1,page-1);auditPage();}),btn('Next',()=>{page++;auditPage();}));}
  async function backups(){heading('Backups and data tools',el('span','Take an Atlas snapshot before restoring.','muted'));const box=el('div'),id=field('Tenant ID'),download=btn('Export JSON',async()=>{try{await downloadTenant(id.control.value);}catch(e){toast(e.message,true);}});box.append(id,download);card('Tenant export').append(box);const restore=el('div'),file=field('Backup JSON','file'),confirm=field('Type tenant name to confirm restore');file.control.accept='application/json,.json';const b=btn('Restore from file',async()=>{const f=file.control.files?.[0];if(!f){toast('Choose a tenant backup JSON file first.',true);return;}try{const backup=JSON.parse(await f.text());if(!backup.tenant?._id||!backup.tenant?.name||!backup.data)throw Error('The selected file is not a valid tenant export.');if(confirm.control.value!==backup.tenant.name)throw Error('Typed tenant name does not match the backup.');await api('backups.restore',{tenantId:backup.tenant._id,confirmName:confirm.control.value,data:backup.data});toast('Restore completed after a pre-restore snapshot.');}catch(e){toast(e.message,true);}},'danger');restore.append(el('p','Restoring replaces the current POS data. An application snapshot is made first; take an Atlas snapshot as well.'),file,confirm,b);card('Restore tenant data').append(restore);}
  async function releases(){heading('Releases and health');const [r,h]=await Promise.all([api('releases'),api('health')]),c=card('Deployment');c.append(el('p',`Installer version: ${r.version||'Unavailable'}`),el('p',`UI revision: ${r.ui?.revision||'Unavailable'}`),el('p',`UI notes: ${r.ui?.notes||'—'} · Minimum shell: ${r.ui?.minShell||'—'}`));const health=card('Health');health.append(el('p',`MongoDB: ${h.mongo.ok?'Online':'Unavailable'} (${h.mongo.latencyMs} ms)`),el('p',`Region: ${h.region} · System errors (24 h): ${h.recentSystemErrors}`));}
  async function settings(){heading('Settings');const d=await api('settings.get'),box=el('div'),trial=field('Default trial days','number',d.settings.defaultTrialDays),grace=field('Default grace days','number',d.settings.defaultGraceDays),contact=field('Renewal contact message','textarea',d.settings.supportContact);box.append(trial,grace,contact);const c=card('Defaults');c.append(box,btn('Save settings',async()=>{try{await api('settings.save',{defaultTrialDays:+trial.control.value,defaultGraceDays:+grace.control.value,supportContact:contact.control.value});toast('Settings saved');}catch(e){toast(e.message,true);}},'primary'));const current=await api('session.me'),sessions=await api('session.sessions'),sc=card('Active super admin sessions');sc.append(table(['Created','Last active','IP'],sessions.items||[],(tr,s)=>[s.createdAt,s.lastSeenAt,s.ip].forEach(v=>tr.append(el('td',v||'')))));sc.append(btn('Sign out everywhere',async()=>{try{await api('session.sessions',{},'POST');endSession('All of your sessions were signed out.');}catch(e){toast(e.message,true);}},'danger'));const pc=card('Change your password'),prow=el('div',undefined,'row'),oldPw=field('Current password','password'),newPw=field('New password (14+ characters)','password'),confirmPw=field('Confirm new password','password');prow.append(oldPw,newPw,confirmPw);pc.append(prow,btn('Change password',async()=>{try{if(newPw.control.value!==confirmPw.control.value)throw Error('New passwords do not match.');await api('session.password',{currentPassword:oldPw.control.value,newPassword:newPw.control.value});toast('Password changed');oldPw.control.value='';newPw.control.value='';confirmPw.control.value='';}catch(e){toast(e.message,true);}},'primary'));if(current.admin.role==='root'){const admins=await api('admins.list'),ac=card('Super admin accounts');ac.append(table(['Email','Role','Status','MFA','Actions'],admins.items||[],(tr,a)=>{[a.email,a.role,a.active?'Active':'Disabled',a.mfaEnabled?'Enabled':'Required at next sign-in'].forEach(v=>tr.append(el('td',v||'')));const td=el('td',undefined,'actions');td.append(btn(a.active?'Disable':'Enable',async()=>{try{await api('admins.save',{id:a.id,active:!a.active});await settings();}catch(e){toast(e.message,true);}}));if(a.email!==current.admin.email){const next=field('Role','select');['root','billing','support','readonly'].forEach(v=>{const o=el('option',v);o.value=v;o.selected=v===a.role;next.control.append(o);});td.append(next,btn('Update role',async()=>{try{await api('admins.save',{id:a.id,role:next.control.value});await settings();}catch(e){toast(e.message,true);}}),btn('Reset MFA',async()=>{try{await api('admins.save',{id:a.id,resetMfa:true});toast('MFA reset; enrollment is required at next sign in');await settings();}catch(e){toast(e.message,true);}}));}tr.append(td);}));const email=field('New admin email','email'),role=field('Role','select'),pw=field('Temporary password (min 14)','password');['billing','support','readonly','root'].forEach(v=>{const o=el('option',v);o.value=v;role.control.append(o);});ac.append(email,role,pw,btn('Create admin',async()=>{try{await api('admins.save',{action:'create',email:email.control.value,role:role.control.value,password:pw.control.value});toast('Admin created. MFA enrollment is required at first sign-in.');await settings();}catch(e){toast(e.message,true);}},'primary'));}}
  async function licenses(){heading('Licenses');const count=field('Number of keys','number','1'),plan=field('Plan ID','text','standard'),c=card('Generate license keys');c.append(count,plan,btn('Generate keys',async()=>{try{const d=await api('licenses.generate',{count:+count.control.value,planId:plan.control.value});const csv=new Blob([safeCsv([['License key'],...d.keys.map(k=>[k])])],{type:'text/csv'}),a=el('a');a.href=URL.createObjectURL(csv);a.download='license-keys-once.csv';a.click();URL.revokeObjectURL(a.href);secret('License keys have also been downloaded once as CSV. Save this list now.',d.keys.join('\n'));}catch(e){toast(e.message,true);}},'primary'));const tenant=field('Tenant ID to redeem into'),key=field('License key'),redeem=card('Redeem license');redeem.append(tenant,key,btn('Apply key',async()=>{try{await api('licenses.redeem',{tenantId:tenant.control.value,key:key.control.value});toast('License applied');await licenses();}catch(e){toast(e.message,true);}},'primary'));const d=await api('licenses.list'),list=card(`${d.total} stored license keys`);list.append(table(['Hint','Status','Tenant','Plan','Created','Actions'],d.items||[],(tr,k)=>{tr.append(el('td',`…${k.keyHint}`),el('td',k.status),el('td',k.tenantId||'—'),el('td',k.planId),el('td',k.createdAt));const td=el('td');td.append(btn('Revoke',()=>modalShow('Revoke license key','This action cannot be undone.',[btn('Revoke',async()=>{try{await api('licenses.revoke',{id:k._id});modal.hidden=true;await licenses();}catch(e){toast(e.message,true);}},'danger'),btn('Cancel',()=>modal.hidden=true)])));tr.append(td);}));}
  async function route(){if(!admin){if(authBox.hidden)showLogin();return;}nav.classList.remove('open');$('#menu').setAttribute('aria-expanded','false');const hash=location.hash||'#/dashboard',path=hash.slice(2).split('?')[0],parts=path.split('/').filter(Boolean);document.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')===`#/${parts[0]}`));try{switch(parts[0]){case'dashboard':await dashboard();break;case'tenants':parts[1]?await tenantDetail(decodeURIComponent(parts[1])):await tenants();break;case'plans':await plans();break;case'payments':await payments();break;case'announcements':await announcements();break;case'backups':await backups();break;case'audit':await auditPage();break;case'releases':await releases();break;case'licenses':await licenses();break;case'licenses-old':{const count=field('Number of keys','number','1'),plan=field('Plan ID','text','standard'),c=card('Generate license keys');c.append(count,plan,btn('Generate keys',async()=>{try{const d=await api('licenses.generate',{count:+count.control.value,planId:plan.control.value});secret('License keys. Copy and store them now.',d.keys.join('\n'));}catch(e){toast(e.message,true);}},'primary'));}break;case'settings':await settings();break;default:await dashboard();}}catch(e){if(!e.handled)toast(e.message,true);}}
  $('#logout').addEventListener('click',async()=>{
    try{await api('session.logout',{});}catch(_){}
    history.replaceState(null,'',location.pathname+location.search);
    endSession('You have been signed out.');
  });
  $('#menu').addEventListener('click',()=>{const open=nav.classList.toggle('open');$('#menu').setAttribute('aria-expanded',String(open));});
  nav.addEventListener('click',e=>{if(e.target.closest('a')){nav.classList.remove('open');$('#menu').setAttribute('aria-expanded','false');}});
  modal.addEventListener('click',e=>{if(e.target===modal&&modal.dataset.secret!=='true')modal.hidden=true;});
  window.addEventListener('hashchange',route);
  (async()=>{
    try{const s=await api('session.me');csrf=s.csrfToken;admin=s.admin;showApp();await route();}
    catch(_){if(!admin)showLogin();}
  })();
})();
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
  const field=(label,type='text',value='',name='')=>{const l=el('label',undefined,'field');l.append(el('span',label));const x=type==='textarea'?el('textarea'):el(type==='select'?'select':'input');if(type!=='textarea'&&type!=='select')x.type=type;if(value!==undefined)x.value=value;if(name)x.name=name;l.append(x);Object.defineProperty(l,'control',{value:x});return l;};
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
    const staffLink=nav.querySelector('a[href="#/staff"]');if(staffLink)staffLink.hidden=!['root','support'].includes(admin?.role);
    const licenseLink=nav.querySelector('a[href="#/licenses"]');if(licenseLink)licenseLink.hidden=!['root','billing','readonly'].includes(admin?.role);
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

  /* ================= Shared helpers ================= */
  const num=v=>Number(v||0).toLocaleString();
  const mbText=b=>`${(Number(b||0)/1048576).toFixed(2)} MB`;
  const fmt=v=>{const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d.toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'—';};
  const fmtDay=v=>{const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d.toLocaleDateString([],{dateStyle:'medium'}):'—';};
  const cap=v=>String(v||'').charAt(0).toUpperCase()+String(v||'').slice(1);
  const expiryOf=t=>t.status==='trial'?(t.trialEndsAt||t.expiresAt):(t.expiresAt||t.trialEndsAt);
  const pill=status=>el('span',status,`pill pl-${status}`);
  const qs=o=>Object.entries(o).filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
  const can={
    tenantCreate:()=>admin?.role==='root',
    tenantEdit:()=>['root','billing'].includes(admin?.role),
    tenantDelete:()=>admin?.role==='root',
    staff:()=>['root','support'].includes(admin?.role)
  };
  const rowIn=parent=>{const x=el('div',undefined,'row');parent.append(x);return x;};
  const options=(select,list,current)=>{select.replaceChildren();for(const [v,l] of list){const o=el('option',l);o.value=v;select.append(o);}select.value=current??'';};
  const closeModal=()=>{modal.hidden=true;};
  const busy=async(button,fn)=>{button.disabled=true;try{await fn();}catch(e){if(!e.handled)toast(e.message,true);}finally{button.disabled=false;}};
  // Dialog with fields and a submit button. onSubmit may throw; the message is shown and the dialog stays open.
  function dialog(title,intro,fields,submitLabel,onSubmit,danger=false){
    const box=el('div');
    if(intro)box.append(el('p',intro));
    const err=el('p','','error-text');err.hidden=true;
    for(const f of fields)box.append(f);
    box.append(err);
    const submit=btn(submitLabel,()=>busy(submit,async()=>{err.hidden=true;try{await onSubmit();}catch(e){if(e.handled)return;err.textContent=e.message;err.hidden=false;}}),danger?'danger':'primary');
    modalShow(title,box,[submit,btn('Cancel',closeModal)]);
  }
  const slugify=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);
  function pager(parent,state,total,reload){
    const pages=Math.max(1,Math.ceil(total/state.limit)),r=rowIn(parent);
    r.append(el('span',`${num(total)} total · page ${state.page} of ${pages}`,'muted'),
      btn('Previous',()=>{state.page--;reload();}),btn('Next',()=>{state.page++;reload();}));
    r.children[1].disabled=state.page<=1;r.children[2].disabled=state.page>=pages;
  }
  async function downloadTenant(id){
    const d=await api(`backups.export&tenantId=${encodeURIComponent(id)}`),blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}),a=el('a');
    a.href=URL.createObjectURL(blob);a.download=`tenant-${id}-backup.json`;a.click();URL.revokeObjectURL(a.href);
  }

  /* ================= Dashboard (one request) ================= */
  let dashRun=0;
  async function dashboard(){
    const run=++dashRun;
    heading('Dashboard',btn('Refresh',()=>dashboard()));
    const status=el('p','Loading dashboard…','muted');main.append(status);
    let d;
    try{d=await api('dashboard');}
    catch(e){
      if(run!==dashRun)return;
      status.remove();
      if(!e.handled){const c=card('Dashboard could not be loaded');c.append(el('p',e.message,'error-text'),btn('Try again',()=>dashboard(),'primary'));}
      return;
    }
    if(run!==dashRun||!admin)return;
    status.remove();
    const counts=d.counts||{};
    main.append(el('p',`Live data · updated ${new Date().toLocaleTimeString()}`,'muted'));
    const kpis=[
      ['Total shops',num(d.tenantCount),'excluding cancelled / deleted'],
      ['Active',num(counts.active),'licensed'],
      ['On trial',num(counts.trial),''],
      ['Expiring in 7 days',num(d.expiringIn7Days),'renewal needed soon',d.expiringIn7Days>0?'warn':''],
      ['Expiring in 30 days',num(d.expiringIn30Days),''],
      ['Grace period',num(counts.grace),'past expiry, still working',counts.grace>0?'warn':''],
      ['Expired',num(counts.expired),'',counts.expired>0?'bad':''],
      ['Suspended',num(counts.suspended),''],
      ['New shops this month',num(d.newTenantsThisMonth),''],
      ['Staff accounts',num(d.totalUsers),`${num(d.activeUsers)} active`],
      ['Stored POS data',mbText(d.storageBytes),'across all shops']
    ];
    const grid=el('div',undefined,'grid kpis');
    for(const [label,value,hint,tone] of kpis){const c=el('div',undefined,`card metric${tone?' '+tone:''}`);c.append(el('small',label),el('b',value));if(hint)c.append(el('small',hint,'muted'));grid.append(c);}
    main.append(grid);

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

    const cols=el('div',undefined,'cols');main.append(cols);
    const mk=title=>{const c=el('section',undefined,'card');c.append(el('h2',title));cols.append(c);return c;};
    const openBtn=t=>btn('Open',()=>{location.hash=`#/tenants/${encodeURIComponent(t._id)}`;});
    const now=Date.now(),attention=mk('Needs attention');
    const rows=(d.attention||[]).map(t=>({t,e:expiryOf(t)})).sort((x,y)=>(x.e?new Date(x.e).getTime():0)-(y.e?new Date(y.e).getTime():0)).slice(0,8);
    if(!rows.length)attention.append(el('p','Nothing needs attention right now.','empty'));
    else attention.append(table(['Shop','Status','Expires','',''],rows,(tr,{t,e})=>{
      const days=e?Math.ceil((new Date(e).getTime()-now)/86400000):null,td=el('td');td.append(pill(t.status));
      tr.append(el('td',t.name),td,el('td',fmtDay(e)),el('td',days===null?'':days<0?`${-days} d overdue`:`${days} d left`));
      const a=el('td',undefined,'actions');a.append(openBtn(t));tr.append(a);
    }));
    const recent=mk('Newest shops');
    if(!(d.recent||[]).length)recent.append(el('p','No shops yet.','empty'));
    else recent.append(table(['Shop','Status','Plan','Staff','Created',''],d.recent,(tr,t)=>{
      const td=el('td');td.append(pill(t.status));
      tr.append(el('td',t.name),td,el('td',t.planSnapshot?.name||'—'),el('td',`${num(t.staffCount)} / ${num(t.planSnapshot?.userLimit)}`),el('td',fmtDay(t.createdAt)));
      const a=el('td',undefined,'actions');a.append(openBtn(t));tr.append(a);
    }));

    const act=card('Recent activity');
    if(!(d.recentAudit||[]).length)act.append(el('p','No activity recorded yet.','empty'));
    else act.append(table(['When','Actor','Action','Summary'],d.recentAudit,(tr,x)=>[fmt(x.ts),x.actorEmail,x.action,x.summary].forEach(v=>tr.append(el('td',v||'')))));
  }

  /* ================= Tenants: list ================= */
  const tState={page:1,limit:25,search:'',state:''};
  async function tenants(){
    heading('Tenants',...(can.tenantCreate()?[btn('Create tenant',createTenant,'primary')]:[]));
    const filters=row(),q=field('Search','search',tState.search,'search'),st=field('Status','select');
    q.control.placeholder='Name, slug or email';
    options(st.control,[['','All (not deleted)'],['trial','Trial'],['active','Active'],['grace','Grace'],['expired','Expired'],['suspended','Suspended'],['cancelled','Cancelled'],['deleted','Deleted']],tState.state);
    const go2=()=>{tState.search=q.control.value.trim();tState.state=st.control.value;tState.page=1;load();};
    q.control.addEventListener('keydown',e=>{if(e.key==='Enter')go2();});
    st.control.addEventListener('change',go2);
    filters.append(q,st,btn('Search',go2,'primary'));
    const out=el('div');main.append(out);
    const mine=++dashRun;
    async function load(){
      out.replaceChildren(el('p','Loading…','muted'));
      let d;
      try{d=await api(`tenants.list&${qs({page:tState.page,limit:tState.limit,search:tState.search,state:tState.state})}`);}
      catch(e){out.replaceChildren();if(!e.handled)out.append(el('p',e.message,'error-text'));return;}
      if(mine!==dashRun)return;
      out.replaceChildren();
      if(!d.items.length){out.append(el('p','No tenants match.','empty'));return;}
      out.append(table(['Shop','Slug','Status','Plan','Staff','Expires','Created',''],d.items,(tr,t)=>{
        const td=el('td');td.append(pill(t.status));
        tr.append(el('td',t.name),el('td',t.slug||'—'),td,el('td',t.planSnapshot?.name||'—'),el('td',`${num(t.activeStaff)} / ${num(t.planSnapshot?.userLimit)}`),el('td',fmtDay(expiryOf(t))),el('td',fmtDay(t.createdAt)));
        const a=el('td',undefined,'actions');a.append(btn('Open',()=>{location.hash=`#/tenants/${encodeURIComponent(t._id)}`;}));tr.append(a);
      }));
      pager(out,tState,d.total,load);
    }
    await load();
  }
  function createTenant(){
    const f={};
    [['Shop name','name','text','',true],['Slug (web id)','slug','text','',true],['Owner name','ownerName','text','',true],['Owner username','username','text','',true],['Owner email','email','email','',true],['Phone','phone','tel','',false],['Staff limit','userLimit','number','5',false],['Trial days','trialDays','number','14',false],['Plan name','planName','text','Standard',false]]
      .forEach(([l,n,t,v])=>{f[n]=field(l,t,v,n);});
    let slugTouched=false;
    f.slug.control.addEventListener('input',()=>{slugTouched=true;});
    f.name.control.addEventListener('input',()=>{if(!slugTouched)f.slug.control.value=slugify(f.name.control.value);});
    dialog('Create tenant with owner','A temporary password is generated for the owner and shown once.',Object.values(f),'Create',async()=>{
      const b={};for(const [k,v] of Object.entries(f))b[k]=v.control.value.trim();
      const d=await api('tenants.create',b);
      closeModal();
      secret(`Temporary password for ${d.owner.username}`,d.temporaryPassword);
      location.hash=`#/tenants/${encodeURIComponent(d.tenant._id)}`;
    });
    const hint=el('small','Enter a slug to check its subdomain.','muted');f.slug.append(hint);let checkTimer;
    f.slug.control.addEventListener('input',()=>{clearTimeout(checkTimer);hint.textContent='Checking subdomain…';checkTimer=setTimeout(async()=>{try{const r=await fetch(`/api/auth?mode=slug&value=${encodeURIComponent(f.slug.control.value.trim().toLowerCase())}`,{credentials:'same-origin'}),d=await r.json();hint.textContent=d.valid?(d.available?`${d.subdomain||f.slug.control.value} is available`:`${f.slug.control.value} is already taken`):'Use 2–49 lowercase letters, numbers, and dashes.';}catch{hint.textContent='Could not check subdomain availability.';}},250);});
  }

  /* ================= Tenants: detail (edit, status, delete, staff) ================= */
  async function tenantDetail(id){
    const run=++dashRun;
    heading('Loading…');
    let d;
    try{d=await api(`tenants.get&id=${encodeURIComponent(id)}`);}
    catch(e){main.replaceChildren();const c=card('Tenant could not be loaded');if(!e.handled)c.append(el('p',e.message,'error-text'));c.append(btn('Back to tenants',()=>{location.hash='#/tenants';}));return;}
    if(run!==dashRun)return;
    const t=d.tenant,u=d.usage,contact=t.contact||{},deleted=t.status==='deleted';
    tenantName=t.name;
    const head=[btn('Back',()=>{location.hash='#/tenants';})];
    if(['root','support'].includes(admin.role))head.push(btn('Export data',()=>busy(head[head.length-1],async()=>{await downloadTenant(id);toast('Tenant data exported.');})));
    heading(t.name,...head);

    const ov=card('Overview'),grid=el('div',undefined,'grid kpis');
    for(const [l,v] of [['Status',cap(t.status)],['Plan',t.planSnapshot?.name||'—'],['Staff (active / limit)',`${num(u.activeStaff)} / ${num(t.planSnapshot?.userLimit)}`],['All staff accounts',num(u.users)],['Expires',fmtDay(expiryOf(t))],['Grace days',num(t.graceDays)],['POS data',mbText(u.dataBytes)],['Last activity',fmt(u.lastActiveAt)],['Created',fmtDay(t.createdAt)]]){
      const c=el('div',undefined,'card metric');c.append(el('small',l),el('b',v));grid.append(c);
    }
    ov.append(grid);

    if(deleted){
      const c=card('This tenant is deleted');
      c.append(el('p',`Deleted ${fmt(t.deletedAt)}${t.deleteReason?` — ${t.deleteReason}`:''}. It can be restored for 30 days.`));
      if(can.tenantDelete())c.append(btn('Restore tenant',()=>confirmRestore(t),'primary'));
      return;
    }

    // Edit form
    const edit=card('Shop details'),r1=rowIn(edit),r2=rowIn(edit),r3=rowIn(edit);
    const name=field('Shop name','text',t.name),cName=field('Contact name','text',contact.name||''),cEmail=field('Contact email','email',contact.email||''),phone=field('Phone','tel',contact.phone||'');
    const planName=field('Plan name','text',t.planSnapshot?.name||'Standard'),limit=field('Staff limit','number',t.planSnapshot?.userLimit??5),grace=field('Grace days','number',t.graceDays??7),expiry=field('Expiry date','date',(t.status==='trial'?t.trialEndsAt:t.expiresAt)?new Date(t.status==='trial'?t.trialEndsAt:t.expiresAt).toISOString().slice(0,10):'');
    const notes=field('Internal notes','textarea',t.notes||'');
    r1.append(name,cName,cEmail,phone);r2.append(planName,limit,grace,expiry);r3.append(notes);
    if(!can.tenantEdit()){for(const f of [name,cName,cEmail,phone,planName,limit,grace,expiry,notes])f.control.disabled=true;}
    else{
      const save=btn('Save changes',()=>busy(save,async()=>{
        const body={id,name:name.control.value,notes:notes.control.value,contact:{...contact,name:cName.control.value,email:cEmail.control.value,phone:phone.control.value},planName:planName.control.value,userLimit:Number(limit.control.value),graceDays:Number(grace.control.value)};
        if(expiry.control.value){const iso=new Date(expiry.control.value+'T23:59:59').toISOString();if(t.status==='trial')body.trialEndsAt=iso;else body.expiresAt=iso;}
        await api('tenants.update',body);toast('Tenant saved');await tenantDetail(id);
      }),'primary');
      edit.append(save);
    }

    // Status + delete
    if(can.tenantEdit()||can.tenantDelete()){
      const sc=card('Status'),ar=rowIn(sc);
      if(can.tenantEdit())for(const [label,status] of [['Activate','active'],['Suspend','suspended'],['Cancel','cancelled']]){
        if(t.status===status)continue;
        ar.append(btn(label,()=>confirmStatus(t,status),status==='active'?'primary':'danger'));
      }
      if(can.tenantDelete())ar.append(btn('Delete tenant',()=>confirmDelete(t),'danger'));
      sc.append(el('p','Suspended and cancelled shops cannot sign in to the POS. Deleting is soft: the data is kept and the tenant can be restored for 30 days.','muted'));
    }

    if(can.staff()){const sc=card('Staff accounts');await staffPanel(sc,{tenantId:id,tenant:t,onChange:()=>tenantDetail(id)});}
  }
  function confirmStatus(t,status){
    const reason=field('Reason (optional)','text');
    dialog('Change tenant status',`Set ${t.name} to ${status}?`,[reason],'Confirm',async()=>{await api('tenants.update',{id:t._id,status,reason:reason.control.value});closeModal();toast(`Tenant ${status}`);await tenantDetail(t._id);},status!=='active');
  }
  function confirmDelete(t){
    const name=field(`Type ${t.name} to confirm`),reason=field('Reason (optional)');
    dialog('Delete tenant','The tenant data is exported to your computer first, then the tenant is soft-deleted. You can restore it for 30 days.',[name,reason],'Export and delete',async()=>{
      if(name.control.value!==t.name)throw new Error('The name you typed does not match.');
      await downloadTenant(t._id);
      await api('tenants.delete',{id:t._id,confirmName:name.control.value,reason:reason.control.value});
      closeModal();toast('Tenant deleted. Restore is available for 30 days.');location.hash='#/tenants';
    },true);
  }
  function confirmRestore(t){
    const name=field(`Type ${t.name} to confirm`);
    dialog('Restore tenant','A safety snapshot is created before the tenant is reactivated.',[name],'Restore',async()=>{await api('tenants.restore',{id:t._id,confirmName:name.control.value});closeModal();toast('Tenant restored');await tenantDetail(t._id);});
  }

  /* ================= Staff panel (per tenant, or all tenants) ================= */
  const ROLE_OPTS=[['owner','Owner'],['manager','Manager'],['cashier','Cashier']];
  async function staffPanel(parent,{tenantId='',tenant=null,onChange=null}){
    const st={page:1,limit:25,search:'',role:'',status:''},box=el('div');
    parent.append(box);
    let tenantList=[];
    if(!tenantId){try{tenantList=(await api('tenants.list&limit=100&state=all')).items;}catch(e){if(!e.handled)toast(e.message,true);}}
    const refresh=()=>{if(onChange)return onChange();return load();};
    const bar=rowIn(box),q=field('Search','search','','search'),role=field('Role','select'),status=field('Status','select'),tsel=field('Shop','select');
    q.control.placeholder='Name or username';
    options(role.control,[['','All roles'],...ROLE_OPTS],'');options(status.control,[['','Any status'],['active','Active'],['disabled','Disabled']],'');
    options(tsel.control,[['','All shops'],...tenantList.map(t=>[t._id,t.name])],'');
    const apply=()=>{st.search=q.control.value.trim();st.role=role.control.value;st.status=status.control.value;st.page=1;load();};
    q.control.addEventListener('keydown',e=>{if(e.key==='Enter')apply();});
    role.control.addEventListener('change',apply);status.control.addEventListener('change',apply);
    if(!tenantId){bar.append(tsel);tsel.control.addEventListener('change',apply);}
    bar.append(q,role,status,btn('Search',apply),btn('Add staff',()=>staffForm(null),'primary'));
    const out=el('div');box.append(out);
    const scope=()=>tenantId||tsel.control.value;
    async function load(){
      out.replaceChildren(el('p','Loading…','muted'));
      let d;
      try{d=await api(`staff.list&${qs({tenantId:scope(),page:st.page,limit:st.limit,search:st.search,role:st.role,status:st.status})}`);}
      catch(e){out.replaceChildren();if(!e.handled)out.append(el('p',e.message,'error-text'));return;}
      out.replaceChildren();
      if(!d.users.length){out.append(el('p','No staff accounts match.','empty'));return;}
      const heads=['Name','Username','Role',...(tenantId?[]:['Shop']),'Status','Created',''];
      out.append(table(heads,d.users,(tr,u)=>{
        const sp=el('td');sp.append(pill(u.active?'active':'suspended'));sp.firstChild.textContent=u.active?'active':'disabled';
        tr.append(el('td',u.name),el('td',u.username),el('td',cap(u.role)));
        if(!tenantId)tr.append(el('td',u.tenantName));
        tr.append(sp,el('td',fmtDay(u.createdAt)));
        const a=el('td',undefined,'actions');
        a.append(btn('Edit',()=>staffForm(u)),btn('Reset password',()=>resetStaff(u)),btn('Sign out',()=>signOutStaff(u)),btn(u.active?'Disable':'Enable',()=>toggleStaff(u),u.active?'danger':''),btn('Delete',()=>deleteStaff(u),'danger'));
        tr.append(a);
      }));
      pager(out,st,d.total,load);
    }
    // create / edit dialog
    function staffForm(u){
      const f={name:field('Full name','text',u?.name||''),username:field('Username','text',u?.username||''),role:field('Role','select')};
      options(f.role.control,ROLE_OPTS,u?.role||'cashier');
      const list=[f.name,f.username,f.role];let shop=null,pw=null;
      if(!u){
        if(!tenantId){shop=field('Shop','select');options(shop.control,tenantList.filter(t=>!['deleted','cancelled'].includes(t.status)).map(t=>[t._id,t.name]),tsel.control.value||'');list.unshift(shop);}
        pw=field('Password (leave empty to generate)','text','');list.push(pw);
      }
      dialog(u?`Edit ${u.username}`:'Add staff account',u?'Changing the username or role signs this person out of the POS.':(tenant?`New account for ${tenant.name}. The staff limit is checked automatically.`:'The shop staff limit is checked automatically.'),list,u?'Save':'Create',async()=>{
        if(u){
          await api('staff.update',{tenantId:u.tenantId,userId:u.id,name:f.name.control.value,username:f.username.control.value,role:f.role.control.value});
          closeModal();toast('Staff account updated');
        }else{
          const tid=tenantId||shop.control.value;if(!tid)throw new Error('Choose a shop.');
          const d=await api('staff.create',{tenantId:tid,name:f.name.control.value,username:f.username.control.value,role:f.role.control.value,password:pw.control.value});
          closeModal();secret(`Password for ${d.user.username}`,d.temporaryPassword);
        }
        await refresh();
      });
    }
    function resetStaff(u){
      const pw=field('New password (leave empty to generate)','text','');
      dialog(`Reset password for ${u.username}`,'The person is signed out everywhere and must use the new password.',[pw],'Reset password',async()=>{
        const d=await api('staff.reset',{tenantId:u.tenantId,userId:u.id,password:pw.control.value});
        closeModal();secret(`New password for ${u.username}`,d.temporaryPassword);
      });
    }
    function signOutStaff(u){
      dialog(`Sign out ${u.username}`,'Ends every active POS session for this account. They can sign in again.',[],'Sign out',async()=>{await api('staff.update',{tenantId:u.tenantId,userId:u.id,signOut:true});closeModal();toast('Signed out');});
    }
    function toggleStaff(u){
      dialog(`${u.active?'Disable':'Enable'} ${u.username}`,u.active?'A disabled account cannot sign in and no longer uses a staff slot.':'Enabling uses one staff slot of the shop plan.',[],u.active?'Disable':'Enable',async()=>{await api('staff.update',{tenantId:u.tenantId,userId:u.id,active:!u.active});closeModal();toast(u.active?'Account disabled':'Account enabled');await refresh();},u.active);
    }
    function deleteStaff(u){
      dialog(`Delete ${u.username}`,'This permanently removes the login. Sales and records created by this person stay in the shop data. This cannot be undone.',[],'Delete account',async()=>{await api('staff.delete',{tenantId:u.tenantId,userId:u.id});closeModal();toast('Staff account deleted');await refresh();},true);
    }
    await load();
  }
  async function staffPage(){
    heading('Staff');
    if(!can.staff()){card().append(el('p','Your role cannot manage staff accounts.','muted'));return;}
    const c=card('Staff accounts across all shops');
    await staffPanel(c,{});
  }

  async function licensesPage(){
    heading('Desktop licenses',btn('Refresh',()=>licensesPage()));
    if(!['root','billing','readonly'].includes(admin?.role)){card().append(el('p','Your role cannot view desktop licenses.','muted'));return;}
    const create=card('Create offline license keys');
    create.append(el('p','Keys are signed by the live server and can be activated in the desktop POS while offline. A revoked key cannot be blocked on a computer that is already offline; timed keys stop working at expiry.','muted'));
    const f={kind:field('License duration','select'),count:field('Number of keys','number','1')};
    options(f.kind.control,[['7','7 days'],['30','1 month (30 days)'],['permanent','Permanent']],'7');f.count.control.min='1';f.count.control.max='100';
    create.append(f.kind,f.count);
    const generate=btn('Generate keys',async()=>busy(generate,async()=>{
      const d=await api('licenses.generate',{kind:f.kind.control.value,count:Number(f.count.control.value)});
      secret('Copy and deliver these keys now. They will not be shown again.',d.keys.join('\n'));
      await licensesPage();
    }),'primary');
    if(admin?.role==='readonly')generate.disabled=true;
    create.append(generate);
    const inventory=card('Issued desktop licenses'),out=el('p','Loading licenses…','muted');inventory.append(out);
    let d;try{d=await api('licenses.list');}catch(e){out.textContent=e.message;out.className='error-text';return;}
    out.remove();
    if(!d.items.length){inventory.append(el('p','No desktop licenses have been issued.','empty'));return;}
    inventory.append(table(['Type','Key ending','Status','Created','Expires',''],d.items,(tr,item)=>{
      tr.append(el('td',['7','temporary'].includes(String(item.kind))?'7 days':['30','monthly'].includes(String(item.kind))?'1 month':'Permanent'),el('td',item.keyHint?`…${item.keyHint}`:'—','mono'),el('td',item.status),el('td',fmt(item.createdAt)),el('td',item.expiresAt?fmt(item.expiresAt):'Never'));
      const actions=el('td',undefined,'actions');
      if(item.status==='active'&&admin?.role!=='readonly')actions.append(btn('Revoke',()=>dialog('Revoke desktop license','The key will be blocked from future activations. An already activated offline copy cannot receive revocation until it connects; timed access ends at its expiry.',[],'Revoke',async()=>{await api('licenses.revokeDesktop',{id:item._id});closeModal();toast('Desktop license revoked');await licensesPage();},true)));
      tr.append(actions);
    }));
  }

  /* ================= Routing ================= */
  async function route(){
    if(!admin){if(authBox.hidden)showLogin();return;}
    nav.classList.remove('open');$('#menu').setAttribute('aria-expanded','false');
    const hash=location.hash||'#/dashboard',parts=hash.slice(2).split('?')[0].split('/').filter(Boolean);
    document.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')===`#/${parts[0]||'dashboard'}`));
    try{
      switch(parts[0]){
        case 'tenants':parts[1]?await tenantDetail(decodeURIComponent(parts[1])):await tenants();break;
        case 'staff':await staffPage();break;
        case 'licenses':await licensesPage();break;
        default:await dashboard();
      }
    }catch(e){if(!e.handled)toast(e.message,true);}
  }
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

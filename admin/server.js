'use strict';
// Private control plane. Deploy separately from the public POS site.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true } });
const PORT = Number(process.env.PORT || 8787);
const COOKIE = 'smartpos_admin';
const loginAttempts = new Map();
const scrypt = (password, salt) => new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (e, k) => e ? reject(e) : resolve(k.toString('hex'))));
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none'", ...headers }); res.end(JSON.stringify(body)); };
function cookie(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)))[COOKIE]; }
function body(req) { return new Promise((resolve, reject) => { let data = ''; req.on('data', c => { data += c; if (data.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(Error('Invalid JSON')); } }); req.on('error', reject); }); }
async function audit(admin, action, entity, id, req, metadata = {}) { await pool.query('INSERT INTO audit_logs(actor_id,action,entity,entity_id,ip,metadata) VALUES($1,$2,$3,$4,$5,$6)', [admin || null, action, entity || null, id || null, req.socket.remoteAddress, metadata]); }
async function session(req) {
  const sid = cookie(req); if (!sid) return null;
  const r = await pool.query('SELECT s.id,s.csrf,a.id admin_id,a.email FROM admin_sessions s JOIN super_admins a ON a.id=s.admin_id WHERE s.id=$1 AND s.expires_at>now() AND a.active', [sid]);
  return r.rows[0] || null;
}
const allowedTables = { customers: ['full_name','business_name','email','phone','whatsapp','address','country','status','notes'], plans: ['name','duration_days','price','currency','device_limit','grace_days','active','features'] };
async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (['POST','PATCH','PUT','DELETE'].includes(req.method) && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'Cross-origin request rejected' }); }
    catch { return json(res, 403, { error: 'Invalid request origin' }); }
  }
  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.resolve(__dirname, `.${requested}`);
    if (!file.startsWith(`${__dirname}${path.sep}`)) return json(res, 404, { error: 'Not found' });
    try { const ext = path.extname(file), type = ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml' })[ext] || 'application/octet-stream'; res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options':'nosniff', 'x-frame-options':'DENY', 'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'" }); return fs.createReadStream(file).pipe(res); }
    catch { return json(res, 404, { error: 'Not found' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true });
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const ip = req.socket.remoteAddress || 'unknown', recent = loginAttempts.get(ip) || [];
    const live = recent.filter(t => Date.now() - t < 15 * 60_000); if (live.length >= 8) return json(res, 429, { error: 'Try again later' });
    loginAttempts.set(ip, live);
    const b = await body(req), email = String(b.email || '').toLowerCase().trim();
    const found = await pool.query('SELECT id,email,password_hash FROM super_admins WHERE email=$1 AND active', [email]);
    let valid = false;
    if (found.rowCount) { const [salt, expected] = found.rows[0].password_hash.split('$'); if (salt && expected) { const actual = Buffer.from(await scrypt(String(b.password || ''), salt), 'hex'), target = Buffer.from(expected, 'hex'); valid = actual.length === target.length && crypto.timingSafeEqual(actual, target); } }
    if (!valid) { live.push(Date.now()); loginAttempts.set(ip, live); await audit(found.rows[0]?.id, 'login_failed', null, null, req, { email }); return json(res, 401, { error: 'Invalid credentials' }); }
    loginAttempts.delete(ip);
    const sid = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(24).toString('hex');
    await pool.query('INSERT INTO admin_sessions(id,admin_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval \'8 hours\')', [sid, found.rows[0].id, csrf]);
    await audit(found.rows[0].id, 'login', null, null, req);
    return json(res, 200, { email, csrf }, { 'set-cookie': `${COOKIE}=${encodeURIComponent(sid)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` });
  }
  const s = await session(req);
  if (req.method === 'GET' && url.pathname === '/api/session') return s ? json(res, 200, { email: s.email, csrf: s.csrf }) : json(res, 401, { error: 'Authentication required' });
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    if (s && req.headers['x-csrf-token'] !== s.csrf) return json(res, 403, { error: 'CSRF validation failed' });
    if (s) { await pool.query('DELETE FROM admin_sessions WHERE id=$1', [s.id]); await audit(s.admin_id, 'logout', null, null, req); }
    return json(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` });
  }
  if (!s) return json(res, 401, { error: 'Authentication required' });
  if (req.method !== 'GET' && req.headers['x-csrf-token'] !== s.csrf) return json(res, 403, { error: 'CSRF validation failed' });
  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    const [customers, subs, licenses, activations, payments, recent] = await Promise.all([
      pool.query('SELECT count(*)::int total,count(*) FILTER(WHERE status=\'active\')::int active FROM customers'),
      pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE status='active' AND expires_at>now())::int active,count(*) FILTER(WHERE expires_at<=now())::int expired FROM subscriptions"),
      pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE status='available')::int available FROM licenses"),
      pool.query("SELECT count(*)::int total FROM activations WHERE status='active'"),
      pool.query("SELECT coalesce(sum(amount) FILTER(WHERE status='completed' AND paid_at>=date_trunc('month',now())),0)::numeric(12,2) month, count(*) FILTER(WHERE status='pending')::int pending FROM payments"),
      pool.query('SELECT id,action,entity,entity_id,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 20')
    ]);
    return json(res, 200, { customers: customers.rows[0], subscriptions: subs.rows[0], licenses: licenses.rows[0], activations: activations.rows[0], payments: payments.rows[0], activity: recent.rows });
  }
  if (req.method === 'GET' && /^\/api\/(customers|plans|subscriptions|licenses|activations|payments|audit)$/.test(url.pathname)) {
    const table = url.pathname.split('/')[2], sql = { customers:'SELECT * FROM customers ORDER BY created_at DESC LIMIT 500', plans:'SELECT * FROM plans ORDER BY name', subscriptions:'SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 500', licenses:'SELECT id,customer_id,subscription_id,key_hint,status,device_limit,expires_at,created_at FROM licenses ORDER BY created_at DESC LIMIT 500', activations:'SELECT * FROM activations ORDER BY last_seen DESC LIMIT 500', payments:'SELECT * FROM payments ORDER BY created_at DESC LIMIT 500', audit:'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500' }[table];
    return json(res, 200, (await pool.query(sql)).rows);
  }
  if (req.method === 'GET' && url.pathname === '/api/options') {
    const [customers, plans] = await Promise.all([pool.query('SELECT id,business_name,full_name FROM customers WHERE status=\'active\' ORDER BY business_name'),pool.query('SELECT id,name,duration_days,price,currency,device_limit FROM plans WHERE active ORDER BY name')]);
    return json(res, 200, {customers:customers.rows,plans:plans.rows});
  }
  if (req.method === 'POST' && url.pathname === '/api/licenses/generate') {
    const b = await body(req), count = Number(b.count || 1), limit = Number(b.device_limit || 1);
    if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(limit) || limit < 1 || limit > 100) return json(res, 400, { error: 'Count must be 1–100 and device limit 1–100' });
    const client = await pool.connect(), issued = [];
    try {
      await client.query('BEGIN');
      for (let i=0;i<count;i++) {
        const key = `SMARTPOS-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const hash = crypto.createHash('sha256').update(key).digest('hex');
        const row = await client.query('INSERT INTO licenses(secret_hash,key_hint,status,device_limit,expires_at) VALUES($1,$2,\'available\',$3,$4) RETURNING id', [hash, key.slice(-4), limit, b.expires_at || null]);
        issued.push({ id: row.rows[0].id, key });
      }
      await client.query('COMMIT');
      await audit(s.admin_id,'license_generated','licenses',null,req,{count,device_limit:limit});
      return json(res,201,{licenses:issued});
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  if (req.method === 'POST' && url.pathname === '/api/subscriptions') {
    const b=await body(req); if(!b.customer_id||!b.plan_id)return json(res,400,{error:'Choose a customer and plan'});
    const p=await pool.query('SELECT duration_days,device_limit FROM plans WHERE id=$1 AND active',[b.plan_id]); if(!p.rowCount)return json(res,400,{error:'Plan is unavailable'});
    const duration=Number(p.rows[0].duration_days||365), days=Number.isInteger(duration)&&duration>0?duration:365;
    const out=await pool.query("INSERT INTO subscriptions(customer_id,plan_id,status,starts_at,expires_at) VALUES($1,$2,'active',now(),now()+($3||' days')::interval) RETURNING *",[b.customer_id,b.plan_id,days]);
    await audit(s.admin_id,'subscription_created','subscriptions',out.rows[0].id,req); return json(res,201,out.rows[0]);
  }
  if (req.method === 'POST' && url.pathname === '/api/payments') {
    const b=await body(req); if(!b.customer_id||!b.amount||!b.method)return json(res,400,{error:'Customer, amount and method are required'});
    const amount=Number(b.amount); if(!Number.isFinite(amount)||amount<0)return json(res,400,{error:'Invalid amount'});
    const invoice=`SP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const out=await pool.query("INSERT INTO payments(customer_id,subscription_id,invoice_number,amount,currency,method,reference,status,paid_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8='completed' THEN now() ELSE NULL END,$9) RETURNING *",[b.customer_id,b.subscription_id||null,invoice,amount,String(b.currency||'USD').toUpperCase().slice(0,3),String(b.method).slice(0,80),b.reference||null,b.status==='completed'?'completed':'pending',String(b.notes||'').slice(0,1000)]);
    await audit(s.admin_id,'payment_recorded','payments',out.rows[0].id,req,{status:out.rows[0].status}); return json(res,201,out.rows[0]);
  }
  const action=url.pathname.match(/^\/api\/(licenses|activations|subscriptions|payments)\/([0-9a-f-]{36})\/(revoke|restore|deactivate|activate|cancel|expire|complete|void)$/i);
  if(req.method==='POST'&&action){const [,entity,id,op]=action;let sql;
    if(entity==='licenses'&&['revoke','restore'].includes(op))sql=pool.query('UPDATE licenses SET status=$1 WHERE id=$2 RETURNING id,status',[op==='revoke'?'revoked':'available',id]);
    else if(entity==='activations'&&['deactivate','activate'].includes(op))sql=pool.query('UPDATE activations SET status=$1 WHERE id=$2 RETURNING id,status',[op==='deactivate'?'revoked':'active',id]);
    else if(entity==='subscriptions'&&['cancel','expire','activate'].includes(op))sql=pool.query("UPDATE subscriptions SET status=$1,expires_at=CASE WHEN $1='expired' THEN now() ELSE expires_at END WHERE id=$2 RETURNING id,status,expires_at",[({cancel:'cancelled',expire:'expired',activate:'active'})[op],id]);
    else if(entity==='payments'&&['complete','void'].includes(op))sql=pool.query("UPDATE payments SET status=$1,paid_at=CASE WHEN $1='completed' THEN now() ELSE paid_at END WHERE id=$2 RETURNING id,status",[op==='complete'?'completed':'void',id]);
    else return json(res,400,{error:'Unsupported action'});
    const out=await sql;if(!out.rowCount)return json(res,404,{error:'Record not found'});await audit(s.admin_id,`${entity}_${op}`,entity,id,req);return json(res,200,out.rows[0]);}
  const collection = url.pathname.match(/^\/api\/(customers|plans)$/);
  if (req.method === 'POST' && collection) {
    const table = collection[1], b = await body(req), cols = allowedTables[table], keys = Object.keys(b).filter(k => cols.includes(k));
    if (!keys.length || keys.some(k => typeof b[k] === 'string' && b[k].length > 2000)) return json(res, 400, { error: 'Invalid record' });
    const vals = keys.map(k => b[k]);
    const q = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`;
    const out = await pool.query(q, vals); await audit(s.admin_id, `${table}_created`, table, out.rows[0].id, req); return json(res, 201, out.rows[0]);
  }
  const idMatch = url.pathname.match(/^\/api\/(customers|plans)\/([0-9a-f-]{36})$/i);
  if (req.method === 'PATCH' && idMatch) {
    const [, table, id] = idMatch, b = await body(req), keys = Object.keys(b).filter(k => allowedTables[table].includes(k));
    if (!keys.length) return json(res, 400, { error: 'No permitted fields supplied' });
    const q = `UPDATE ${table} SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')}${table==='customers'?',updated_at=now()':''} WHERE id=$${keys.length+1} RETURNING *`;
    const out = await pool.query(q, [...keys.map(k=>b[k]), id]); if (!out.rowCount) return json(res, 404, { error: 'Not found' });
    await audit(s.admin_id, `${table}_updated`, table, id, req, { fields: keys }); return json(res, 200, out.rows[0]);
  }
  return json(res, 404, { error: 'Not found' });
}
http.createServer((req,res) => handler(req,res).catch(err => { console.error('admin api error', err.message); if (!res.headersSent) json(res, 500, { error: 'Request failed' }); })).listen(PORT, () => console.log(`Private admin API listening on ${PORT}`));

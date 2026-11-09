'use strict';
const crypto = require('node:crypto');
const COOKIE = 'smartpos_live';
const json = (res, status, body, headers = {}) => {
  const merged = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'application/json; charset=utf-8', ...headers };
  for (const [name, value] of Object.entries(merged)) res.setHeader(name, value);
  res.statusCode = status;
  res.end(JSON.stringify(body));
};
const key = () => { if (!process.env.POS_SESSION_SECRET || process.env.POS_SESSION_SECRET.length < 32) throw new Error('POS_SESSION_SECRET is not configured'); return process.env.POS_SESSION_SECRET; };
function sign(value) { return crypto.createHmac('sha256', key()).update(value).digest('base64url'); }
function cookie(req) { const item = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '=')); return item ? decodeURIComponent(item.slice(COOKIE.length + 1)) : ''; }
function session(req) {
  const [payload, signature] = cookie(req).split('.');
  if (!payload || !signature) return null;
  const supplied=Buffer.from(signature), expected=Buffer.from(sign(payload));
  if (supplied.length!==expected.length || !crypto.timingSafeEqual(supplied,expected)) return null;
  try { const s = JSON.parse(Buffer.from(payload, 'base64url').toString()); return s.exp > Date.now() ? s : null; } catch { return null; }
}
function setSession(res, userId, tenantId = 'main', sessionVersion = 0) { const p = Buffer.from(JSON.stringify({ userId, tenantId, sessionVersion, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url'); res.setHeader('Set-Cookie', `${COOKIE}=${p}.${sign(p)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`); }
function clearSession(res) { res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`); }
function sameOrigin(req) { if (!req.headers.origin) return true; try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; } }
function authorized(req, res) { if (!sameOrigin(req)) { json(res,403,{ error:'Cross-origin request rejected' }); return null; } const s = session(req); if (!s) json(res,401,{ error:'Please sign in again' }); return s; }
module.exports = { json, session, setSession, clearSession, authorized };

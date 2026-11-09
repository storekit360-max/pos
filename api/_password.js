'use strict';
const crypto = require('node:crypto');
function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve,reject) => crypto.scrypt(password,salt,64,(e,k) => e ? reject(e) : resolve(`${salt}$${k.toString('hex')}`)));
}
async function verify(password, stored) {
  const [salt, expected] = String(stored || '').split('$'); if (!salt || !expected) return false;
  const actual = Buffer.from((await hash(password,salt)).split('$')[1],'hex'), wanted = Buffer.from(expected,'hex');
  return actual.length === wanted.length && crypto.timingSafeEqual(actual,wanted);
}
module.exports = { hash, verify };

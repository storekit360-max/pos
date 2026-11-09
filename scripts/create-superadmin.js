'use strict';
const crypto=require('node:crypto');
const {MongoClient}=require('mongodb');
const {hash}=require('../api/_password');

async function main(){
 const uri=String(process.env.MONGODB_URI||'').trim(), email=String(process.env.SA_EMAIL||'').trim().toLowerCase(), password=String(process.env.SA_PASSWORD||'');
 if(!uri||!email.includes('@')||password.length<14)throw new Error('Set MONGODB_URI, SA_EMAIL and SA_PASSWORD (at least 14 characters).');
 const client=new MongoClient(uri,{serverSelectionTimeoutMS:8000});
 try{await client.connect();const database=client.db(process.env.MONGODB_DB||'the_smart_pos'),admins=database.collection('superadmins');await admins.createIndex({email:1},{unique:true});const id=crypto.randomUUID();await admins.insertOne({id,email,role:'root',active:true,passwordHash:await hash(password),totp:null,mfaEnabled:false,recoveryHashes:[],failedLogins:0,lockedUntil:null,createdAt:new Date()});process.stdout.write('Root super admin created. MFA enrollment is required at first sign-in.\n');}
 finally{await client.close();}
}
main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});

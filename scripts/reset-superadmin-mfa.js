'use strict';
const readline=require('node:readline/promises');
const {stdin,stdout}=require('node:process');
const {MongoClient}=require('mongodb');

async function main(){const uri=String(process.env.MONGODB_URI||'').trim(),email=String(process.env.SA_EMAIL||'').trim().toLowerCase();if(!uri||!email.includes('@'))throw new Error('Set MONGODB_URI and SA_EMAIL for the account to recover.');const rl=readline.createInterface({input:stdin,output:stdout});try{const answer=await rl.question(`Disable MFA for ${email} so it can be enrolled again? Type RESET-MFA: `);if(answer!=='RESET-MFA')throw new Error('Confirmation did not match.');}finally{rl.close();}const client=new MongoClient(uri,{serverSelectionTimeoutMS:8000});try{await client.connect();const c=client.db(process.env.MONGODB_DB||'the_smart_pos');const result=await c.collection('superadmins').updateOne({email,active:true},{$set:{mfaEnabled:false,totp:null,pendingTotp:null,recoveryHashes:[],updatedAt:new Date()}});if(!result.matchedCount)throw new Error('Active super admin was not found.');await c.collection('superadmin_sessions').deleteMany({adminId:(await c.collection('superadmins').findOne({email},{projection:{id:1}})).id});stdout.write('MFA was reset; sign in and enroll a new authenticator.\n');}finally{await client.close();}}
main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});

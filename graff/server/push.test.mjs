import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMessenger} from './server.mjs';

test('Push recipients, duplicate sends, private chats, retry persistence, logout, invalid tokens and account switching',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'graff-push-'));let delivered=[],reject=false,invalid=false;
 const sender=async job=>{if(reject)throw Object.assign(new Error('temporary'),{invalidToken:invalid});delivered.push(job);};
 let app=createMessenger({dataDir:dir,bootstrapCode:'PUSH-FIRST-INVITE',pushSender:sender});let base;
 const start=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;};
 const request=async(path,user,body)=>{const res=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};};
 const reg=async(login,invite)=>(await request('/auth/register',null,{login,name:login,password:'long-test-password',invite})).data;
 const device=(user,name)=>request('/push/devices',user,{token:name.repeat(40),installation:'installation-'+name.repeat(10)});
 const send=(user,chat,nonce,body='Тест 💚')=>request('/chats/'+chat+'/messages',user,{body,nonce});
 try{
 await start();const a=await reg('first','PUSH-FIRST-INVITE');
 const b=await reg('second',(await request('/invites',a,{})).data.code);
 const c=await reg('third',(await request('/invites',a,{})).data.code);
 assert.equal((await device(null,'X')).status,401);
 for(const [user,key] of [[a,'A'],[b,'B'],[c,'C']])assert.equal((await device(user,key)).status,200);
 const first=await send(a,'family','push-family-001');await app.drainPush();
 assert.equal(first.status,201);assert.equal(delivered.length,2);
 assert.deepEqual(new Set(delivered.map(j=>j.data.recipientUserId)),new Set([b.user.id,c.user.id]));
 assert.equal(delivered[0].data.title,'Наша семья');assert.match(delivered[0].data.body,/first: Тест/);
 await send(a,'family','push-family-001');await app.drainPush();assert.equal(delivered.length,2);
 const direct=(await request('/chats',a,{kind:'direct',members:[b.user.id]})).data.id;
 await send(a,direct,'push-direct-001');await app.drainPush();assert.equal(delivered.length,3);assert.equal(delivered.at(-1).data.recipientUserId,b.user.id);
 reject=true;await send(a,direct,'push-retry-001');await app.drainPush();assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_outbox').get().n,1);
 await app.close();app=createMessenger({dataDir:dir,pushSender:sender});await start();
 reject=false;app.db.exec('UPDATE push_outbox SET next_attempt=0');await app.drainPush();assert.equal(delivered.length,4);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_outbox').get().n,0);
 // Read elsewhere before retry: do not notify about a message already read.
 reject=true;const read=await send(a,direct,'push-read-001');await app.drainPush();
 await request('/chats/'+direct+'/read',b,{id:read.data.message.id});reject=false;app.db.exec('UPDATE push_outbox SET next_attempt=0');await app.drainPush();assert.equal(delivered.length,4);
 // Binding the same physical installation to another account drops old private jobs.
 reject=true;await send(a,direct,'push-switch-001');await app.drainPush();assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_outbox').get().n,1);
 await device(c,'B');reject=false;app.db.exec('UPDATE push_outbox SET next_attempt=0');await app.drainPush();assert.equal(delivered.length,4);
 await device(b,'B');reject=true;await send(a,direct,'push-logout-001');await app.drainPush();await request('/auth/logout',b,{});
 reject=false;app.db.exec('UPDATE push_outbox SET next_attempt=0');await app.drainPush();assert.equal(delivered.length,4);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_devices').get().n,2);
 // UNREGISTERED revokes only the stale token. Expired sessions cannot receive messages.
 invalid=true;reject=true;await send(a,'family','push-invalid-001');await app.drainPush();assert.equal(app.db.prepare('SELECT COUNT(*) n FROM push_devices').get().n,1);
 reject=false;invalid=false;await device(c,'C');app.db.prepare('UPDATE sessions SET expires=0 WHERE user_id=?').run(c.user.id);
 await send(a,'family','push-expiry-001');await app.drainPush();assert.equal(delivered.length,4);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

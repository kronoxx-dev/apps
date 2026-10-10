import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMessenger} from './server.mjs';

let app,base,owner,second,third;
const dir=mkdtempSync(join(tmpdir(),'ryadom-test-'));
async function request(path,{method='GET',token,body,headers={}}={}){
 const res=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:res.status,data:await res.json()};
}
const register=(login,invite)=>request('/auth/register',{method:'POST',body:{login,name:login,password:'long-test-password',invite}});
const post=(path,user,body)=>request(path,{method:'POST',token:user.token,body});
before(async()=>{
 app=createMessenger({dataDir:dir,bootstrapCode:'FIRST-FAMILY-INVITE'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
 owner=(await register('owner','FIRST-FAMILY-INVITE')).data;
 const invite=(await post('/invites',owner,{})).data.code;
 second=(await register('second',invite)).data;
 third=(await register('third',(await post('/invites',owner,{})).data.code)).data;
});
after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});

test('Invite-only onboarding, owner rights, single-use invites and private sessions',async()=>{
 assert.equal(owner.user.admin,true);assert.equal(second.user.admin,false);
 assert.equal((await register('outsider','NOT-A-VALID-INVITE')).status,400);
 assert.equal((await register('outsider','FIRST-FAMILY-INVITE')).status,400);
 assert.equal((await post('/invites',second,{})).status,403);
 assert.equal((await request('/chats')).status,401);
 assert.equal((await request('/chats',{token:'fake'})).status,401);
 const stored=app.db.prepare('SELECT * FROM users WHERE id=?').get(owner.user.id);
 assert.notEqual(stored.password,'long-test-password');assert.equal(stored.password.length,128);
 assert.equal(app.db.prepare('SELECT token FROM sessions WHERE user_id=?').get(owner.user.id).token===owner.token,false);
});
test('Family messages, unread counts, read receipts and restart persistence',async()=>{
 const sent=await post('/chats/family/messages',owner,{body:'Привет, семья! 🌲',nonce:'hello-nonce-001'});assert.equal(sent.status,201);
 const rows=await request('/chats/family/messages',{token:second.token});assert.equal(rows.data.messages.at(-1).body,'Привет, семья! 🌲');
 const chats=await request('/chats',{token:second.token});assert.equal(chats.data.chats.find(c=>c.id==='family').unread,1);
 await post('/chats/family/read',second,{id:sent.data.message.id});
 assert.equal((await request('/chats',{token:second.token})).data.chats.find(c=>c.id==='family').unread,0);
 assert.equal((await request('/chats/family/messages',{token:owner.token})).data.receipts.find(r=>r.user_id===second.user.id).last_read,sent.data.message.id);
 await app.close();app=createMessenger({dataDir:dir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
 assert.equal((await request('/chats/family/messages',{token:second.token})).data.messages.at(-1).body,'Привет, семья! 🌲');
});
test('Direct chat privacy, deterministic creation and cross-chat idempotency protection',async()=>{
 const a=await post('/chats',owner,{kind:'direct',members:[second.user.id]});assert.equal(a.status,201);
 const b=await post('/chats',second,{kind:'direct',members:[owner.user.id]});assert.equal(a.data.id,b.data.id);
 const path='/chats/'+a.data.id;
 assert.equal((await request(path+'/messages',{token:third.token})).status,404);
 assert.equal((await post(path+'/messages',third,{body:'intrude',nonce:'bad-nonce-001'})).status,404);
 assert.equal((await post(path+'/read',third,{id:100})).status,404);
 assert.equal((await request('/chats',{token:third.token})).data.chats.some(c=>c.id===a.data.id),false);
 const first=await post(path+'/messages',owner,{body:'Личное сообщение',nonce:'dedupe-nonce-01'});
 const retry=await post(path+'/messages',owner,{body:'Личное сообщение',nonce:'dedupe-nonce-01'});
 assert.equal(first.data.message.id,retry.data.message.id);
 assert.equal((await post(path+'/messages',owner,{body:'Different',nonce:'dedupe-nonce-01'})).status,409);
 assert.equal((await post('/chats/family/messages',owner,{body:'Личное сообщение',nonce:'dedupe-nonce-01'})).status,409);
 assert.equal((await request(path+'/messages',{token:second.token})).data.messages.length,1);
});
test('Groups enforce member validation and membership',async()=>{
 assert.equal((await post('/chats',owner,{kind:'group',title:'Планы',members:['missing']})).status,400);
 const group=await post('/chats',owner,{kind:'group',title:'Планы на выходные',members:[second.user.id]});assert.equal(group.status,201);
 const list=(await request('/chats',{token:second.token})).data.chats;
 assert.equal(list.find(c=>c.id===group.data.id).title,'Планы на выходные');
 assert.equal((await request('/chats/'+group.data.id+'/messages',{token:third.token})).status,404);
});
test('Pagination does not lose messages; cursor and message validation',async()=>{
 const insert=app.db.prepare('INSERT INTO messages(chat_id,user_id,body,nonce,created) VALUES(?,?,?,?,?)');
 for(let i=0;i<180;i++)insert.run('family',owner.user.id,'Сообщение '+i,'bulk-'+i,Date.now());
 const newest=(await request('/chats/family/messages',{token:second.token})).data;
 assert.equal(newest.messages.length,80);assert.equal(newest.hasMore,true);
 const older=(await request('/chats/family/messages?before='+newest.messages[0].id,{token:second.token})).data;
 assert.equal(older.messages.length,80);assert.ok(older.messages.at(-1).id<newest.messages[0].id);
 const after=(await request('/chats/family/messages?after=0',{token:second.token})).data;assert.equal(after.messages.length,80);assert.equal(after.hasMore,true);
 assert.equal((await request('/chats/family/messages?after=abc',{token:owner.token})).status,400);
 assert.equal((await post('/chats/family/messages',owner,{body:' ',nonce:'empty-msg-001'})).status,400);
 assert.equal((await post('/chats/family/messages',owner,{body:'a'.repeat(4001),nonce:'large-msg-001'})).status,400);
});
test('All three family members can send and see each other’s messages',async()=>{
 const people=[owner,second,third];
 for(const sender of people){
  const family=(await request('/chats',{token:sender.token})).data.chats.find(c=>c.id==='family');
  assert.deepEqual(family.members.map(u=>u.id).sort(),people.map(u=>u.user.id).sort());
  const sent=await post('/chats/family/messages',sender,{body:'Family delivery from '+sender.user.login,nonce:'three-way-'+sender.user.id});
  assert.equal(sent.status,201);
  for(const reader of people){
   const result=await request('/chats/family/messages?after='+(sent.data.message.id-1),{token:reader.token});
   assert.equal(result.status,200);
   assert.deepEqual(result.data.messages.find(m=>m.id===sent.data.message.id),sent.data.message);
  }
 }
});
test('Origin protection, logout revocation, expired tokens and static CSP',async()=>{
 assert.equal((await request('/me',{token:owner.token,headers:{Origin:'https://evil.example'}})).status,403);
 const login=await request('/auth/login',{method:'POST',body:{login:'owner',password:'long-test-password'}});assert.equal(login.status,200);
 assert.equal((await request('/auth/login',{method:'POST',body:{login:'owner',password:'wrong-password'}})).status,401);
 await post('/auth/logout',login.data,{});assert.equal((await request('/me',{token:login.data.token})).status,401);
 app.db.prepare('UPDATE sessions SET expires=0 WHERE user_id=?').run(third.user.id);
 assert.equal((await request('/me',{token:third.token})).status,401);
 const page=await fetch(base);assert.equal(page.status,200);assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.equal((await fetch(base+'/../package.json')).status,404);
});


test('Subdirectory deployment keeps assets and API in the configured namespace',async()=>{
 const subDir=mkdtempSync(join(tmpdir(),'ryadom-mount-'));
 const sub=createMessenger({dataDir:subDir,bootstrapCode:'SUBPATH-INVITE',basePath:'/ryadom',publicOrigin:'https://kronoxx.ru'});
 await new Promise(r=>sub.server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+sub.server.address().port;
 try {
  assert.equal((await fetch(origin+'/ryadom/api/health')).status,200);
  assert.equal((await fetch(origin+'/api/health')).status,404);
  assert.equal((await fetch(origin+'/ryadom/app.js')).status,200);
  assert.equal((await fetch(origin+'/ryadom-other/app.js')).status,404);
  const redirect=await fetch(origin+'/ryadom',{redirect:'manual'});
  assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/ryadom/');
  assert.equal((await fetch(origin+'/ryadom/data/ryadom.sqlite')).status,404);
  const register=await fetch(origin+'/ryadom/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://kronoxx.ru'},body:JSON.stringify({login:'mounted_owner',name:'Owner',password:'long-test-password',invite:'SUBPATH-INVITE'})});
  assert.equal(register.status,201);
 } finally {await sub.close();rmSync(subDir,{recursive:true,force:true});}
});


test('Graff accepts @login and rejects an incorrect password',async()=>{
 const valid=await request('/auth/login',{method:'POST',body:{login:'@OWNER',password:'long-test-password'}});
 assert.equal(valid.status,200);assert.equal(valid.data.user.id,owner.user.id);
 const invalid=await request('/auth/login',{method:'POST',body:{login:'@owner',password:'incorrect-password'}});
 assert.equal(invalid.status,401);
 await request('/auth/logout',{method:'POST',token:valid.data.token,body:{}});
});

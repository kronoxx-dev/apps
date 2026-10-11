import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {radioApi} from './radio.mjs';
import {createMessenger} from './server.mjs';

test('Radio: shared floor, PCM relay, no replay, lease expiry, removal and session revocation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'graff-radio-test-')),db=new DatabaseSync(':memory:');let time=Date.now();
 db.exec('CREATE TABLE sessions(token TEXT,expires INTEGER); CREATE TABLE members(chat_id TEXT,user_id TEXT);');
 for(const id of ['a','b','c']){db.prepare('INSERT INTO sessions VALUES(?,?)').run(id,time+60000);db.prepare('INSERT INTO members VALUES(?,?)').run('family',id);}
 const a=radioApi(db,dir,{clock:()=>time}),b=radioApi(db,dir,{clock:()=>time});
 const invoke=(api,op,id,body={})=>api.handle(op,{client:id.repeat(20),...body},{id,name:id,login:id},id);
 try{
  const joined=invoke(a,'join','a');invoke(b,'join','b');invoke(b,'join','c');
  assert.equal(joined.cursor,0);assert.equal(invoke(a,'poll','a').peers.length,3);
  invoke(a,'claim','a',{turn:'first-turn-00001a'});
  assert.throws(()=>invoke(b,'claim','b',{turn:'second-turn-0002'}),e=>e.status===409);
  assert.throws(()=>invoke(b,'frame','b',{turn:'first-turn-00001a',seq:1,pcm:Buffer.alloc(8000).toString('base64')}),e=>e.status===409);
  const frame={turn:'first-turn-00001a',seq:1,pcm:Buffer.alloc(8000,7).toString('base64')};invoke(a,'frame','a',frame);
  for(const id of ['b','c']){const got=invoke(b,'poll',id,{after:0});assert.equal(got.frames.length,1);assert.equal(got.frames[0].pcm,frame.pcm);assert.equal(got.speaker.id,'a');}
  assert.equal(invoke(a,'poll','a',{after:0}).frames.length,0);
  invoke(a,'frame','a',frame);assert.equal(invoke(b,'poll','b',{after:0}).frames.length,1,'Retry is idempotent');
  assert.throws(()=>invoke(a,'frame','a',{...frame,seq:2,pcm:'aGVsbG8='}),e=>e.status===400);
  invoke(a,'release','a',{turn:frame.turn});invoke(b,'claim','b',{turn:'second-turn-0002'});
  invoke(a,'release','a',{turn:frame.turn});assert.equal(invoke(b,'poll','c').speaker.id,'b');
  time+=12100;invoke(b,'join','c');assert.equal(invoke(b,'poll','c',{after:0}).frames.length,0);assert.equal(invoke(b,'poll','c').speaker,null);
  invoke(a,'join','a');invoke(b,'claim','c',{turn:'third-turn-00003'});db.prepare('DELETE FROM sessions WHERE token=?').run('c');assert.equal(invoke(a,'poll','a').speaker,null);
  assert.throws(()=>invoke(b,'poll','c'),e=>e.status===410);
  time+=21000;assert.throws(()=>invoke(a,'poll','a'),e=>e.status===410);assert.equal(invoke(b,'join','b').peers.length,1);
 }finally{a.close();b.close();db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Radio HTTP requires authentication and stops delivering after logout',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'graff-radio-http-')),app=createMessenger({dataDir:dir,bootstrapCode:'RADIO-TEST-INVITE'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port+'/api';
 const post=async(path,body,token)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{const body={client:'http-client-000001'};assert.equal((await post('/radio/join',body)).status,401);const login=await post('/auth/register',{login:'radio_owner',name:'Radio',password:'radio-test-password',invite:'RADIO-TEST-INVITE'});assert.equal(login.status,201);const token=login.data.token;assert.equal((await post('/radio/join',body,token)).status,200);assert.equal((await post('/radio/claim',{...body,turn:'http-turn-0000001'},token)).status,200);await post('/auth/logout',{},token);assert.equal((await post('/radio/poll',body,token)).status,401);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('Radio survives real-network delay, batches PCM and never skips a legacy page',()=>{
 const dir=mkdtempSync(join(tmpdir(),'graff-radio-delay-')),db=new DatabaseSync(':memory:');let t=Date.now();
 db.exec('CREATE TABLE sessions(token TEXT,expires INTEGER);CREATE TABLE members(chat_id TEXT,user_id TEXT)');
 for(const id of ['a','b']){db.prepare('INSERT INTO sessions VALUES(?,?)').run(id,t+60000);db.prepare('INSERT INTO members VALUES(?,?)').run('family',id);}
 const api=radioApi(db,dir,{clock:()=>t}),call=(op,id,b={})=>api.handle(op,{client:id.repeat(20),...b},{id,name:id,login:id},id),turn='delayed-turn-00001',pcm=Buffer.alloc(8000,3).toString('base64');
 try{call('join','a');call('join','b');call('claim','a',{turn});t+=3500;
  call('frame','a',{turn,seq:1,pcm});t+=3000;
  assert.equal(call('poll','b',{after:0}).frames.length,1,'Audio survives a 3-second poll delay');
  for(let seq=2;seq<=13;seq+=4)call('frame','a',{turn,frames:Array.from({length:4},(_,i)=>({seq:seq+i,pcm}))});
  const first=call('poll','b',{after:0});assert.equal(first.frames.length,8);assert.equal(first.cursor,first.frames.at(-1).id);
  const second=call('poll','b',{after:first.cursor});assert.equal(second.frames.length,5);assert.equal(new Set([...first.frames,...second.frames].map(f=>f.id)).size,13);
  assert.equal(call('poll','b',{after:0,protocol:2}).frames.length,13);
  call('frame','a',{turn,frames:[{seq:13,pcm}]});assert.equal(call('poll','b',{after:0,protocol:2}).frames.length,13);
  assert.throws(()=>call('frame','a',{turn,frames:Array(5).fill({seq:14,pcm})}),e=>e.status===400);
  assert.throws(()=>call('frame','a',{turn,frames:[{seq:14,pcm},{seq:15,pcm:'bad'}]}),e=>[400,429].includes(e.status));
  assert.equal(call('poll','b',{after:0,protocol:2}).frames.length,13,'Rejected batch is atomic');
 }finally{api.close();db.close();rmSync(dir,{recursive:true,force:true});}
});

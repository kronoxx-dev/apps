import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createMessenger} from './server.mjs';import {createVideoStore} from './video.mjs';import {jpegSize} from './images.mjs';
const execute=promisify(execFile),bin=process.env.FFMPEG_PATH||'ffmpeg';
test('Video notes: decode, square MP4+poster, authentication, membership, deduplication, changes, delete and cleanup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'graff-video-'));
 await execute(bin,['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1.2','-c:v','libvpx','-b:v','250k','-c:a','libopus','-metadata','comment=private-video-metadata',join(dir,'test.webm')]);
 const app=createMessenger({dataDir:join(dir,'db'),bootstrapCode:'VIDEO-TEST-INVITE',ffmpegPath:bin});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port+'/api';
 const req=async(path,user,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
 const reg=async(login,invite)=>(await req('/auth/register',null,{login,name:login,password:'Video-test-password',invite})).data;
 const a=await reg('owner','VIDEO-TEST-INVITE'),b=await reg('second',(await req('/invites',a,{})).data.code),c=await reg('third',(await req('/invites',a,{})).data.code);
 const chat=(await req('/chats',a,{kind:'direct',members:[b.user.id]})).data.id,path='/chats/'+chat;
 const payload={video:readFileSync(join(dir,'test.webm')).toString('base64'),mime:'video/webm;codecs=vp8,opus',nonce:'video-test-nonce'};
 assert.equal((await req(path+'/video',null,payload)).status,401);assert.equal((await req(path+'/video',c,payload)).status,404);
 assert.equal((await req(path+'/video',a,{...payload,video:Buffer.from('bad clip').toString('base64')})).status,400);
 const uploaded=await req(path+'/video',a,payload);assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));const m=uploaded.data.message;assert.equal(m.kind,'video');assert.ok(m.duration_ms>=1000&&m.duration_ms<2000);assert.ok(!('video_path' in m));
 assert.equal((await req(path+'/video',a,payload)).data.message.id,m.id);
 assert.equal((await req('/chats/family/video',a,payload)).status,409);
 assert.equal((await req(path+'/messages',a,{body:'nonce collision',nonce:payload.nonce})).status,409);
 const endpoint=path+'/messages/'+m.id;
 assert.equal((await req(endpoint+'/video',c)).status,404);assert.equal((await req(endpoint+'/video')).status,401);
 const full=await req(endpoint+'/video',b),poster=await req(endpoint+'/video?poster=1',b);assert.equal(full.status,200);assert.equal(full.data.mime,'video/mp4');const data=Buffer.from(full.data.video,'base64');assert.equal(data.subarray(4,8).toString(),'ftyp');assert.ok(!data.includes(Buffer.from('private-video-metadata')));assert.deepEqual(jpegSize(Buffer.from(poster.data.video,'base64')),{width:240,height:240});
 writeFileSync(join(dir,'result.mp4'),data);await execute(bin,['-v','error','-i',join(dir,'result.mp4'),'-f','null','-']);
 assert.equal((await req(endpoint+'/edit',a,{body:'text',revision:m.revision})).status,400);
 assert.equal((await req(endpoint+'/delete',b,{revision:m.revision})).status,403);
 const key=app.db.prepare('SELECT video_path FROM messages WHERE id=?').get(m.id).video_path;
 assert.equal((await req(endpoint+'/delete',a,{revision:m.revision})).status,200);assert.equal((await req(endpoint+'/video',b)).status,404);assert.equal(existsSync(join(dir,'db','videos',key+'.mp4')),false);assert.equal(existsSync(join(dir,'db','videos',key+'.jpg')),false);
 const listing=await req(path+'/messages?since='+m.revision,b);assert.ok(listing.data.changes.some(x=>x.id===m.id&&x.deleted_at));
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('Video notes reject excessive duration and clean rejected media',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'graff-video-limit-'));
 try{
 await execute(bin,['-v','error','-f','lavfi','-i','color=c=green:size=64x64:rate=1','-t','62','-c:v','libx264',join(dir,'long.mp4')]);
 const store=createVideoStore(join(dir,'db'),{ffmpegPath:bin});await assert.rejects(store.prepare(readFileSync(join(dir,'long.mp4')).toString('base64'),'video/mp4'),/60 секунд/);
 await assert.rejects(store.prepare('AAAA','image/jpeg'),/WebM/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createMessenger} from './server.mjs';import {jpegSize} from './images.mjs';
test('Images: private access, actual decoding, thumbnails, caption edits, nonce isolation, metadata stripping and delete',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'graff-photo-')),bin=process.env.FFMPEG_PATH||'ffmpeg';
 const pixels=Buffer.alloc(960*600*3);for(let i=0;i<pixels.length;i++)pixels[i]=i%251;
 writeFileSync(join(dir,'test.ppm'),Buffer.concat([Buffer.from('P6\n960 600\n255\n'),pixels]));
 await promisify(execFile)(bin,['-v','error','-i',join(dir,'test.ppm'),'-q:v','3',join(dir,'test.jpg')]);
 const jpg=readFileSync(join(dir,'test.jpg')),comment=Buffer.from('private-gps-metadata'),head=Buffer.from([255,254,0,comment.length+2]);const input=Buffer.concat([jpg.subarray(0,2),head,comment,jpg.subarray(2)]).toString('base64');
 const app=createMessenger({dataDir:join(dir,'db'),bootstrapCode:'IMAGE-TEST-INVITE',ffmpegPath:bin});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port+'/api';
 const req=async(path,user,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
 const reg=async(login,invite)=>(await req('/auth/register',null,{login,name:login,password:'Images-test-password',invite})).data;
 const a=await reg('owner','IMAGE-TEST-INVITE'),b=await reg('second',(await req('/invites',a,{})).data.code),c=await reg('third',(await req('/invites',a,{})).data.code);
 const chat=(await req('/chats',a,{kind:'direct',members:[b.user.id]})).data.id,path='/chats/'+chat;
 const payload={image:input,body:'Наше фото ❤️ 👨‍👩‍👦',nonce:'photo-test-nonce'};
 assert.equal((await req(path+'/image',null,payload)).status,401);assert.equal((await req(path+'/image',c,payload)).status,404);
 assert.equal((await req(path+'/image',a,{...payload,image:Buffer.from('<svg/>').toString('base64')})).status,400);
 const uploaded=await req(path+'/image',a,payload);assert.equal(uploaded.status,201);let m=uploaded.data.message;assert.equal(m.kind,'image');assert.equal(m.image_width,960);assert.ok(!('image_path' in m));
 assert.equal((await req(path+'/image',a,payload)).data.message.id,m.id);
 assert.equal((await req('/chats/family/image',a,payload)).status,409);
 assert.equal((await req(path+'/messages',a,{body:payload.body,nonce:payload.nonce})).status,409);
 const endpoint=path+'/messages/'+m.id;
 assert.equal((await req(endpoint+'/image',c)).status,404);
 const full=await req(endpoint+'/image',b),thumb=await req(endpoint+'/image?thumbnail=1',b);assert.equal(full.status,200);assert.equal(full.data.mime,'image/jpeg');assert.ok(!Buffer.from(full.data.image,'base64').includes(comment));assert.ok(jpegSize(Buffer.from(thumb.data.image,'base64')).width<=480);
 assert.equal((await req(endpoint+'/edit',b,{body:'чужое',revision:m.revision})).status,403);
 m=(await req(endpoint+'/edit',a,{body:'',revision:m.revision})).data.message;assert.equal(m.body,'');assert.equal(m.kind,'image');
 const key=app.db.prepare('SELECT image_path FROM messages WHERE id=?').get(m.id).image_path;
 await req(endpoint+'/delete',a,{revision:m.revision});assert.equal((await req(endpoint+'/image',b)).status,404);assert.equal(existsSync(join(dir,'db','images',key+'.jpg')),false);assert.equal(existsSync(join(dir,'db','images',key+'.thumb.jpg')),false);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

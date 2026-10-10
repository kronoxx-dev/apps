import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMessenger} from './server.mjs';
import {canonicalWav} from './voice.mjs';
function wav(ms=1000){const pcm=Buffer.alloc(ms*32),h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(16000,24);h.writeUInt32LE(32000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
test('Shared edits/deletions, permissions, revisions, voice access and local transcription',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'graff-voice-'));let failTranscription=false;
 const app=createMessenger({dataDir:directory,bootstrapCode:'VOICE-FIRST-INVITE',transcribe:async path=>{assert.equal(canonicalWav(readFileSync(path)),1000);if(failTranscription)throw new Error('test failure');return 'Привет, семья!';}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const req=async(path,user,body)=>{const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 const reg=async(login,invite)=>(await req('/auth/register',null,{login,name:login,password:'voice-test-password',invite})).data;
 try{
 const a=await reg('owner','VOICE-FIRST-INVITE'),b=await reg('second',(await req('/invites',a,{})).data.code),c=await reg('third',(await req('/invites',a,{})).data.code);
 const chat=(await req('/chats',a,{kind:'direct',members:[b.user.id]})).data.id,path='/chats/'+chat;
 const sent=(await req(path+'/messages',a,{body:'Первый текст',nonce:'voice-edit-nonce'})).data.message;
 const initial=(await req(path+'/messages',b)).data;
 assert.equal((await req(path+'/messages/'+sent.id+'/edit',b,{body:'Чужое',revision:sent.revision})).status,403);
 assert.equal((await req(path+'/messages/'+sent.id+'/delete',c,{revision:sent.revision})).status,404);
 const edit=(await req(path+'/messages/'+sent.id+'/edit',a,{body:'Новый текст',revision:sent.revision})).data.message;
 assert.equal(edit.body,'Новый текст');assert.ok(edit.edited_at);assert.ok(edit.revision>sent.revision);
 assert.equal((await req(path+'/messages/'+sent.id+'/edit',a,{body:'Устаревшая версия',revision:sent.revision})).status,409);
 const changes=(await req(path+'/messages?after='+sent.id+'&since='+initial.changeCursor,b)).data;
 assert.equal(changes.messages.length,0);assert.equal(changes.changes[0].body,'Новый текст');
 const deleted=(await req(path+'/messages/'+sent.id+'/delete',a,{revision:edit.revision})).data.message;
 assert.equal(deleted.body,'');assert.ok(deleted.deleted_at);
 assert.equal((await req(path+'/messages',b)).data.messages.length,0);
 assert.equal((await req(path+'/messages?since='+edit.revision,b)).data.changes[0].deleted_at,deleted.deleted_at);
 const summary=(await req('/chats',b)).data.chats.find(x=>x.id===chat);assert.equal(summary.last_message,null);assert.equal(summary.unread,0);
 assert.equal((await req(path+'/voice',null,{audio:wav().toString('base64'),mime:'audio/wav',nonce:'no-access-nonce'})).status,401);
 const voice=await req(path+'/voice',a,{audio:wav().toString('base64'),mime:'audio/wav',nonce:'voice-valid-nonce'});assert.equal(voice.status,201);const id=voice.data.message.id;
 await app.drainTranscription();const note=(await req(path+'/messages',b)).data.messages[0];assert.equal(note.kind,'voice');assert.equal(note.duration_ms,1000);assert.equal(note.transcript,'Привет, семья!');assert.equal(note.transcript_status,'done');assert.ok(!('voice_path' in note));
 const retry=await req(path+'/voice',a,{audio:wav().toString('base64'),mime:'audio/wav',nonce:'voice-valid-nonce'});assert.equal(retry.data.message.id,id);
 assert.equal((await req(path+'/messages/'+id+'/audio',c)).status,404);
 const audio=await req(path+'/messages/'+id+'/audio',b);assert.equal(audio.data.audio,wav().toString('base64'));
 assert.equal((await req(path+'/messages/'+id+'/edit',a,{body:'Не заменять аудио',revision:note.revision})).status,400);
 const filename=app.db.prepare('SELECT voice_path FROM messages WHERE id=?').get(id).voice_path;
 await req(path+'/messages/'+id+'/delete',a,{revision:note.revision});assert.equal((await req(path+'/messages/'+id+'/audio',b)).status,404);assert.equal(existsSync(join(directory,'voice',filename+'.audio')),false);
 assert.equal((await req(path+'/voice',a,{audio:wav().toString('base64'),mime:'text/html',nonce:'bad-mime-nonce'})).status,400);
 assert.equal((await req(path+'/voice',a,{audio:'not base64',mime:'audio/wav',nonce:'bad-audio-nonce'})).status,400);
 failTranscription=true;const failed=(await req(path+'/voice',a,{audio:wav().toString('base64'),mime:'audio/wav',nonce:'failed-asr-nonce'})).data.message;await app.drainTranscription();
 assert.equal(app.db.prepare('SELECT transcript_status s FROM messages WHERE id=?').get(failed.id).s,'failed');failTranscription=false;
 await req(path+'/messages/'+failed.id+'/transcribe',b,{});await app.drainTranscription();assert.equal(app.db.prepare('SELECT transcript_status s FROM messages WHERE id=?').get(failed.id).s,'done');
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});

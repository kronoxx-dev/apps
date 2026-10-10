import {mkdirSync,writeFileSync,readFileSync,unlinkSync,readdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export const MAX_VOICE_BYTES=2*1024*1024;
export function canonicalWav(buffer){
 if(buffer.length<44||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE'||buffer.toString('ascii',12,16)!=='fmt '||buffer.readUInt32LE(16)!==16||buffer.readUInt16LE(20)!==1||buffer.readUInt16LE(22)!==1||buffer.readUInt32LE(24)!==16000||buffer.readUInt32LE(28)!==32000||buffer.readUInt16LE(32)!==2||buffer.readUInt16LE(34)!==16||buffer.toString('ascii',36,40)!=='data'||buffer.readUInt32LE(40)!==buffer.length-44||buffer.readUInt32LE(4)!==buffer.length-8||(buffer.length-44)%2) return null;
 return (buffer.length-44)/32;
}
export function createVoiceStore(dataDir,{ffmpegPath=process.env.FFMPEG_PATH||'ffmpeg'}={}){
 const directory=resolve(dataDir,'voice');mkdirSync(directory,{recursive:true,mode:0o700});
 const file=(key,suffix)=>{if(!/^[a-f0-9-]{36}$/.test(key))throw new Error('Invalid audio id');return resolve(directory,key+suffix);};
 const remove=key=>{for(const suffix of ['.audio','.wav','.txt'])try{unlinkSync(file(key,suffix));}catch(e){if(e.code!=='ENOENT')throw e;}};
 return {file,remove,
  read:key=>readFileSync(file(key,'.audio')),
  async prepare(encoded,mime){
   const used=readdirSync(directory).filter(name=>/^[a-f0-9-]{36}\.(audio|wav)$/.test(name)).reduce((sum,name)=>{try{return sum+statSync(resolve(directory,name)).size;}catch{return sum;}},0);
   if(used>1024*1024*1024)throw Object.assign(new Error('Хранилище голосовых заполнено. Удалите ненужные записи.'),{status:507});
   if(!['audio/mp4','audio/webm','audio/ogg','audio/wav'].includes(mime)||typeof encoded!=='string'||encoded.length>Math.ceil(MAX_VOICE_BYTES/3)*4||(encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)))throw Object.assign(new Error('Некорректная аудиозапись'),{status:400});
   const bytes=Buffer.from(encoded,'base64');if(bytes.length<44||bytes.length>MAX_VOICE_BYTES)throw Object.assign(new Error('Запись слишком большая'),{status:413});
   const key=randomUUID();writeFileSync(file(key,'.audio'),bytes,{mode:0o600});
   try{
    let duration=canonicalWav(bytes);
    if(duration!==null){writeFileSync(file(key,'.wav'),bytes,{mode:0o600});mime='audio/wav';}
    else{
     // Decode only local media; stop after 121 seconds to bound decompression and CPU work.
     writeFileSync(file(key,'.pcm'),'',{mode:0o600});
     await execute(ffmpegPath,['-y','-nostdin','-v','error','-protocol_whitelist','file,pipe','-f',({'audio/mp4':'mov','audio/webm':'matroska','audio/ogg':'ogg','audio/wav':'wav'})[mime],'-i',file(key,'.audio'),'-t','121','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le',file(key,'.pcm')],{timeout:20000,maxBuffer:32768});
     const pcm=readFileSync(file(key,'.pcm'));duration=pcm.length/32;
     const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
     writeFileSync(file(key,'.wav'),Buffer.concat([header,pcm]),{mode:0o600});
    }
    if(duration<300||duration>120000)throw Object.assign(new Error('Голосовое сообщение: от 1 секунды до 2 минут'),{status:400});
    return {key,mime,duration:Math.round(duration)};
   }catch(e){remove(key);if(e.status)throw e;throw Object.assign(new Error('Не удалось обработать аудиозапись'),{status:400});}
   finally{try{unlinkSync(file(key,'.pcm'));}catch{}}
  }
 };
}
export function whisperTranscriber({binary=process.env.WHISPER_BINARY,model=process.env.WHISPER_MODEL}={}){
 if(!binary||!model)return null;
 return async wav=>{
  const prefix=wav+'.transcript';
  try{
   await execute(binary,['-m',model,'-f',wav,'-l','ru','-t','2','-nt','-otxt','-of',prefix],{timeout:240000,maxBuffer:1024*1024});
   return readFileSync(prefix+'.txt','utf8').trim().slice(0,12000);
  }finally{try{unlinkSync(prefix+'.txt');}catch{}}
 };
}
export function transcriptionQueue(db,store,transcribe,touch){
 db.exec(`CREATE TABLE IF NOT EXISTS transcription_lock(id INTEGER PRIMARY KEY CHECK(id=1),lease TEXT,expires INTEGER NOT NULL DEFAULT 0);
 INSERT OR IGNORE INTO transcription_lock(id) VALUES(1);`);
 let running=null,stopped=false;
 async function work(){
  if(!transcribe||stopped)return;
  const lease=randomUUID();
  if(!db.prepare('UPDATE transcription_lock SET lease=?,expires=? WHERE id=1 AND expires<?').run(lease,Date.now()+300000,Date.now()).changes)return;
  try{
   const row=db.prepare("SELECT id,voice_path FROM messages WHERE deleted_at IS NULL AND kind='voice' AND (transcript_status='queued' OR transcript_status='working') ORDER BY id LIMIT 1").get();
   if(!row)return;
   db.prepare("UPDATE messages SET transcript_status='working' WHERE id=?").run(row.id);touch(row.id);
   try{
    const text=await transcribe(store.file(row.voice_path,'.wav'));
    db.prepare("UPDATE messages SET transcript=?,transcript_status='done' WHERE id=? AND deleted_at IS NULL").run(text||'Речь не распознана',row.id);touch(row.id);
   }catch{
    db.prepare("UPDATE messages SET transcript_status='failed' WHERE id=? AND deleted_at IS NULL").run(row.id);touch(row.id);
   }
  }finally{db.prepare('UPDATE transcription_lock SET expires=0,lease=NULL WHERE id=1 AND lease=?').run(lease);}
 }
 function drain(){if(stopped)return Promise.resolve();if(!running)running=work().finally(()=>{running=null;});return running;}
 const timer=transcribe?setInterval(()=>drain().catch(()=>console.warn('Transcription worker temporarily unavailable')),3000):null;timer?.unref();
 return {enabled:Boolean(transcribe),drain,close:async()=>{stopped=true;clearInterval(timer);await running;}};
}

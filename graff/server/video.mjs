import {mkdirSync,writeFileSync,readFileSync,unlinkSync,readdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),fail=(status,text)=>Object.assign(new Error(text),{status});
export function createVideoStore(dataDir,{ffmpegPath=process.env.FFMPEG_PATH||'ffmpeg'}={}){
 const dir=resolve(dataDir,'videos');mkdirSync(dir,{recursive:true,mode:0o700});let running=false;
 const file=(key,ext)=>{if(!/^[a-f0-9-]{36}$/.test(key))throw fail(404,'Видео не найдено');return resolve(dir,key+ext);};
 const remove=key=>{for(const ext of ['.input','.mp4','.jpg'])try{unlinkSync(file(key,ext));}catch(e){if(e.code!=='ENOENT')throw e;}};
 return {remove,read:(key,poster)=>readFileSync(file(key,poster?'.jpg':'.mp4')),
 async prepare(encoded,mime){
  if(running)throw fail(429,'Видео обрабатывается. Попробуйте через несколько секунд.');
  if(!['video/webm','video/mp4'].includes(mime?.split(';')[0]))throw fail(415,'Ожидается видео WebM или MP4');
  if(typeof encoded!=='string'||encoded.length>11184812||encoded.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw fail(400,'Некорректное видео');
  const bytes=Buffer.from(encoded,'base64');if(bytes.length>8388608)throw fail(413,'Кружок больше 8 МБ');
  const webm=mime.startsWith('video/webm');if(webm?!bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])):bytes.subarray(4,8).toString()!=='ftyp')throw fail(400,'Повреждённое видео');
  const used=readdirSync(dir).reduce((n,name)=>n+(()=>{try{return statSync(resolve(dir,name)).size;}catch{return 0;}})(),0);if(used>2*1024**3)throw fail(507,'Хранилище видео заполнено');
  const key=randomUUID();running=true;
  try{
   for(const ext of ['.mp4','.jpg'])writeFileSync(file(key,ext),'',{mode:0o600});
   writeFileSync(file(key,'.input'),bytes,{mode:0o600});
   const {stdout}=await execute(ffmpegPath,['-nostdin','-y','-v','error','-threads','1','-protocol_whitelist','file,pipe','-f',webm?'matroska':'mov','-i',file(key,'.input'),'-t','61','-map','0:v:0','-map','0:a:0?','-vf',"crop='min(iw,ih)':'min(iw,ih)',scale=480:480,setsar=1,fps=24",'-c:v','libx264','-preset','veryfast','-crf','26','-maxrate','900k','-bufsize','1800k','-pix_fmt','yuv420p','-threads','1','-c:a','aac','-b:a','64k','-ac','1','-ar','44100','-map_metadata','-1','-map_chapters','-1','-movflags','+faststart','-progress','pipe:1',file(key,'.mp4')],{timeout:90000,maxBuffer:262144});
   const times=[...stdout.matchAll(/out_time_us=(\d+)/g)],duration=Math.round(Number(times.at(-1)?.[1]||0)/1000);
   if(duration<500||duration>60500)throw fail(400,'Запишите кружок от 1 до 60 секунд');
   if(statSync(file(key,'.mp4')).size>8388608)throw fail(413,'Кружок слишком большой');
   await execute(ffmpegPath,['-nostdin','-y','-v','error','-threads','1','-i',file(key,'.mp4'),'-frames:v','1','-vf','scale=240:240','-q:v','4','-threads','1',file(key,'.jpg')],{timeout:15000,maxBuffer:32768});
   return {key,duration};
  }catch(e){remove(key);if(e.status)throw e;throw fail(400,'Не удалось обработать видео. Попробуйте записать ещё раз.');}
  finally{running=false;try{unlinkSync(file(key,'.input'));}catch{}}
 }};
}

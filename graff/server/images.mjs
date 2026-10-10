import {mkdirSync,writeFileSync,readFileSync,unlinkSync,readdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const fail=(status,text)=>Object.assign(new Error(text),{status});
export function jpegSize(b){
 if(b.length<4||b[0]!==255||b[1]!==216)throw fail(400,'Ожидается фотография JPEG');
 let i=2;
 while(i+4<=b.length){
  if(b[i++]!==255)throw fail(400,'Повреждённое изображение');while(b[i]===255)i++;
  const marker=b[i++];if(marker===217||marker===218)break;
  if(i+2>b.length)break;const n=b.readUInt16BE(i);if(n<2||i+n>b.length)break;
  if([192,193,194].includes(marker)){if(n<8)break;const height=b.readUInt16BE(i+3),width=b.readUInt16BE(i+5);if(!width||!height||width>4096||height>4096||width*height>4500000)throw fail(413,'Слишком большое разрешение изображения');return {width,height};}
  i+=n;
 }
 throw fail(400,'Не удалось прочитать изображение');
}
export function createImageStore(dataDir,{ffmpegPath=process.env.FFMPEG_PATH||'ffmpeg'}={}){
 const dir=resolve(dataDir,'images');mkdirSync(dir,{recursive:true,mode:0o700});let running=0;
 const file=(key,ext)=>{if(!/^[a-f0-9-]{36}$/.test(key))throw fail(404,'Изображение не найдено');return resolve(dir,key+ext);};
 const remove=key=>{for(const ext of ['.input','.jpg','.thumb.jpg'])try{unlinkSync(file(key,ext));}catch(e){if(e.code!=='ENOENT')throw e;}};
 return {remove,file,read:(key,thumb)=>readFileSync(file(key,thumb?'.thumb.jpg':'.jpg')),
 async prepare(encoded){
  if(running>=2)throw fail(429,'Изображения обрабатываются. Попробуйте через несколько секунд.');
  if(typeof encoded!=='string'||encoded.length>2796204||encoded.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw fail(400,'Некорректное изображение');
  const bytes=Buffer.from(encoded,'base64');if(bytes.length>2097152)throw fail(413,'Фото больше 2 МБ');jpegSize(bytes);
  const used=readdirSync(dir).reduce((n,name)=>n+(()=>{try{return statSync(resolve(dir,name)).size;}catch{return 0;}})(),0);if(used>2*1024*1024*1024)throw fail(507,'Хранилище изображений заполнено');
  const key=randomUUID();running++;
  try{
   writeFileSync(file(key,'.input'),bytes,{mode:0o600});
   for(const [size,suffix] of [[1920,'.jpg'],[480,'.thumb.jpg']]){
    writeFileSync(file(key,suffix),'',{mode:0o600});
    await execute(ffmpegPath,['-nostdin','-y','-v','error','-threads','1','-protocol_whitelist','file,pipe','-f','image2pipe','-c:v','mjpeg','-i',file(key,'.input'),'-frames:v','1','-vf',`scale=w='min(${size},iw)':h='min(${size},ih)':force_original_aspect_ratio=decrease`,'-map_metadata','-1','-q:v','3','-threads','1',file(key,suffix)],{timeout:15000,maxBuffer:32768});
   }
   const output=readFileSync(file(key,'.jpg')),dimensions=jpegSize(output);if(output.length>2097152)throw fail(413,'Фото слишком большое. Выберите изображение поменьше.');return {key,...dimensions};
  }catch(e){remove(key);if(e.status)throw e;throw fail(400,'Не удалось обработать изображение');}
  finally{running--;try{unlinkSync(file(key,'.input'));}catch{}}
 }};
}

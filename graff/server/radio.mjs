import {DatabaseSync} from 'node:sqlite';
import {chmodSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
// A separate, short-lived relay. On Linux the entire database stays in shared RAM.
export function radioApi(authDb,dataDir,{clock=Date.now}={}) {
 const path=resolve(process.platform==='linux'&&existsSync('/dev/shm')?'/dev/shm':dataDir,'graff-radio-'+createHash('sha256').update(dataDir).digest('hex').slice(0,20)+'.sqlite');
 const db=new DatabaseSync(path);chmodSync(path,0o600);
 db.exec(`PRAGMA busy_timeout=3000; PRAGMA secure_delete=ON;
 CREATE TABLE IF NOT EXISTS peers(client TEXT PRIMARY KEY,user_id TEXT,session TEXT,name TEXT,login TEXT,seen INTEGER);
 CREATE TABLE IF NOT EXISTS floor(id INTEGER PRIMARY KEY,client TEXT,turn TEXT,expires INTEGER,started INTEGER,last_seq INTEGER);
 INSERT OR IGNORE INTO floor VALUES(1,'','',0,0,0);
 CREATE TABLE IF NOT EXISTS frames(id INTEGER PRIMARY KEY AUTOINCREMENT,client TEXT,turn TEXT,seq INTEGER,pcm TEXT,created INTEGER);`);
 const one=(s,...a)=>db.prepare(s).get(...a), run=(s,...a)=>db.prepare(s).run(...a);
 const fail=(status,message)=>Object.assign(new Error(message),{status});
 function purge(){const t=clock();run('DELETE FROM frames WHERE created<?',t-8000);run('DELETE FROM peers WHERE seen<?',t-20000);
  for(const p of db.prepare('SELECT client,session FROM peers').all())if(!authDb.prepare('SELECT 1 FROM sessions WHERE token=? AND expires>?').get(p.session,t))run('DELETE FROM peers WHERE client=?',p.client);
  run("UPDATE floor SET client='',turn='',expires=0 WHERE expires<? OR client NOT IN (SELECT client FROM peers)",t);
 }
 const timer=setInterval(()=>{try{purge();}catch{}},1000);timer.unref();
 function handle(op,body,user,session){
  if(!['join','poll','claim','frame','release','leave'].includes(op))throw fail(404,'Не найдено');
  if(typeof body.client!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.client))throw fail(400,'Некорректное подключение');
  if(!authDb.prepare("SELECT 1 FROM members WHERE chat_id='family' AND user_id=?").get(user.id))throw fail(403,'Канал доступен семье');
  db.exec('BEGIN IMMEDIATE');try{
   purge();const t=clock(),client=body.client;
   const p=one('SELECT * FROM peers WHERE client=?',client);
   if(p&&(p.user_id!==user.id||p.session!==session))throw fail(403,'Чужое подключение');
   if(op==='join'){
    if(!p&&one('SELECT COUNT(*) AS n FROM peers').n>=8)throw fail(409,'В канале уже 8 устройств');
    run('INSERT INTO peers VALUES(?,?,?,?,?,?) ON CONFLICT(client) DO UPDATE SET seen=excluded.seen',client,user.id,session,user.name,user.login,t);
   }else if(!p)throw fail(410,'Подключитесь к рации снова');
   else run('UPDATE peers SET seen=? WHERE client=?',t,client);
   let f=one('SELECT * FROM floor WHERE id=1');
   if(op==='claim'){
    if(typeof body.turn!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.turn))throw fail(400,'Некорректная передача');
    if(f.client&&(f.client!==client||f.turn!==body.turn))throw fail(409,'Сейчас говорит другой участник');
    if(!f.client)run('UPDATE floor SET client=?,turn=?,expires=?,started=?,last_seq=0 WHERE id=1',client,body.turn,t+12000,t);
   }
   if(op==='frame'){
    if(f.client!==client||f.turn!==body.turn)throw fail(409,'Канал уже освобождён');
    if(t-f.started>30000)throw fail(409,'Максимум 30 секунд за одно нажатие');
    const batch=body.frames===undefined?[body]:body.frames;
    if(!Array.isArray(batch)||batch.length<1||batch.length>4)throw fail(400,'Ожидается от 1 до 4 аудиопакетов');
    let last=f.last_seq;
    let recent=one('SELECT COUNT(*) AS n FROM frames WHERE client=? AND created>?',client,t-1000).n;
    for(const chunk of batch){
     if(!chunk||!Number.isSafeInteger(chunk.seq)||chunk.seq<1||chunk.seq>last+20)throw fail(400,'Некорректный порядок звука');
     if(typeof chunk.pcm!=='string'||! /^[A-Za-z0-9+/]+={0,2}$/.test(chunk.pcm))throw fail(400,'Некорректный звук');
     const bytes=Buffer.from(chunk.pcm,'base64');if(bytes.length!==8000||bytes.toString('base64')!==chunk.pcm)throw fail(400,'Ожидается 250 мс PCM16 / 16 кГц');
     // A timed-out upload may already have committed. Retrying must not replay speech.
     if(chunk.seq<=last)continue;
     if(++recent>12)throw fail(429,'Слишком быстрая передача');
     run('INSERT INTO frames(client,turn,seq,pcm,created) VALUES(?,?,?,?,?)',client,body.turn,chunk.seq,chunk.pcm,t);last=chunk.seq;
    }
    run('UPDATE floor SET expires=?,last_seq=? WHERE id=1',t+12000,last);
   }
   if(op==='release'||op==='leave'){
    if(op==='leave'||f.turn===body.turn)run("UPDATE floor SET client='',turn='',expires=0 WHERE client=?",client);
    if(op==='leave')run('DELETE FROM peers WHERE client=?',client);
   }
   f=one('SELECT * FROM floor WHERE id=1');
   const peers=db.prepare('SELECT client,user_id AS id,name,login FROM peers ORDER BY name').all();
   const cursor=one("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='frames'),0) AS n").n;
   const after=Number.isSafeInteger(body.after)&&body.after>=0?body.after:cursor;
   const limit=body.protocol===2?24:8;
   const frames=op==='poll'?db.prepare('SELECT id,client,turn,seq,pcm FROM frames WHERE id>? AND created>=? AND client!=? ORDER BY id LIMIT ?').all(after,t-6000,client,limit):[];
   db.exec('COMMIT');return {ok:true,peers,speaker:peers.find(p=>p.client===f.client)||null,turn:f.turn,cursor:frames.length===limit?frames.at(-1).id:cursor,frames};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {handle,close(){clearInterval(timer);db.close();}};
}

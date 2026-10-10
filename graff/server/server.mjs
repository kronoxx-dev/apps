import http from 'node:http';
import {createVideoStore} from './video.mjs';
import {createImageStore} from './images.mjs';
import {locationApi} from './location.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {createPushQueue, firebaseSender} from './push.mjs';
import {createVoiceStore,whisperTranscriber,transcriptionQueue} from './voice.mjs';

const scrypt = promisify(scryptCb);
const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '../android/app/src/main/assets');
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => Date.now();
const fail = (status, message) => Object.assign(new Error(message), { status });
const str = (v, min, max, label) => {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) throw fail(400, label);
  return v.trim();
};

export function createMessenger({ dataDir = resolve(here, '../data'), bootstrapCode = null, basePath = '', publicOrigin = process.env.PUBLIC_ORIGIN, firebaseServiceAccountPath=process.env.GOOGLE_APPLICATION_CREDENTIALS, pushSender=firebaseServiceAccountPath?firebaseSender(firebaseServiceAccountPath):null, transcribe=whisperTranscriber(), ffmpegPath } = {}) {
  if(basePath && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(basePath)) throw new Error('Invalid basePath');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dbPath = resolve(dataDir, 'ryadom.sqlite');
  const db = new DatabaseSync(dbPath);
  chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, admin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, direct_key TEXT UNIQUE, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members(chat_id TEXT NOT NULL REFERENCES chats(id), user_id TEXT NOT NULL REFERENCES users(id), last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(chat_id,user_id));
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL REFERENCES chats(id), user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, nonce TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(user_id,nonce));
    CREATE INDEX IF NOT EXISTS message_chat_id ON messages(chat_id,id);
    CREATE INDEX IF NOT EXISTS member_user ON members(user_id);
  `);
  db.exec('BEGIN IMMEDIATE');
  const columns=new Set(db.prepare('PRAGMA table_info(messages)').all().map(c=>c.name));
  for(const [name,definition] of Object.entries({kind:"TEXT NOT NULL DEFAULT 'text'",video_path:'TEXT',image_path:'TEXT',image_width:'INTEGER',image_height:'INTEGER',voice_path:'TEXT',voice_mime:'TEXT',duration_ms:'INTEGER',transcript:'TEXT',transcript_status:'TEXT',edited_at:'INTEGER',deleted_at:'INTEGER',revision:'INTEGER NOT NULL DEFAULT 0'})) {
    if(!columns.has(name))db.exec('ALTER TABLE messages ADD COLUMN '+name+' '+definition);
  }
  db.exec('CREATE TABLE IF NOT EXISTS message_clock(id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL DEFAULT 0); INSERT OR IGNORE INTO message_clock(id) VALUES(1);');
  db.exec('COMMIT');
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const locations=locationApi(db);
  const push=createPushQueue(db,pushSender);
  const drainPush=()=>push.drain().catch(()=>console.warn('Push queue temporarily unavailable'));
  drainPush();
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const v=fn(); db.exec('COMMIT'); return v; } catch(e) { db.exec('ROLLBACK'); throw e; } };
  const touchMessage=id=>{
    // A single SQL statement allocates the revision; callers already hold the write transaction when needed.
    const revision=one('UPDATE message_clock SET value=value+1 WHERE id=1 RETURNING value').value;
    run('UPDATE messages SET revision=? WHERE id=?',revision,id);return revision;
  };
  const videoStore=createVideoStore(dataDir,{ffmpegPath});
  const imageStore=createImageStore(dataDir,{ffmpegPath});
  const voiceStore=createVoiceStore(dataDir,{ffmpegPath});
  const transcription=transcriptionQueue(db,voiceStore,transcribe,id=>transaction(()=>touchMessage(id)));
  const drainTranscription=()=>transcription.drain().catch(()=>console.warn('Transcription worker temporarily unavailable'));
  drainTranscription();

  transaction(()=>{
  run('INSERT OR IGNORE INTO chats VALUES(?,?,?,?,?)', 'family', 'group', 'Наша семья', null, now());
  if (!one('SELECT id FROM users LIMIT 1') && !one('SELECT code FROM invites WHERE admin=1 AND used=0 AND expires>?', now())) {
    const code = bootstrapCode || randomBytes(12).toString('hex').toUpperCase();
    run('INSERT INTO invites VALUES(?,?,0,1) ON CONFLICT(code) DO UPDATE SET expires=excluded.expires,used=0', hash(code), now()+7*86400000);
    if (!bootstrapCode) writeFileSync(resolve(dataDir,'first-invite.txt'), code+'\n', { mode: 0o600 });
  }
  });
  const cleanUser = u => ({ id:u.id, login:u.login, name:u.name, admin:Boolean(u.admin) });
  const session = user => {
    run('DELETE FROM sessions WHERE expires<?', now());
    const token=randomBytes(32).toString('hex');
    run('INSERT INTO sessions VALUES(?,?,?)',hash(token),user.id,now()+30*86400000);
    return { token, user: cleanUser(user) };
  };
  const membership = (chat,user) => {
    if (!one('SELECT 1 FROM members WHERE chat_id=? AND user_id=?',chat,user.id)) throw fail(404,'Чат не найден');
  };
  const message = id => one('SELECT m.id,m.chat_id,m.user_id,m.body,m.nonce,m.created,m.kind,m.voice_mime,m.duration_ms,m.transcript,m.transcript_status,m.edited_at,m.deleted_at,m.revision,m.image_width,m.image_height,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?',id);
  const rates = new Map();
  const throttle = (key,limit,windowMs) => {
    const time=now();
    if(rates.size>10000) for(const [k,v] of rates) if(v.until<time) rates.delete(k);
    const r=rates.get(key);
    if(!r || r.until<time) { rates.set(key,{n:1,until:time+windowMs}); return; }
    if(++r.n>limit) throw fail(429,'Слишком много попыток. Попробуйте позже.');
  };
  const dummySalt=randomBytes(16).toString('hex');
  const server = http.createServer(async(req,res) => {
    const send=(status,payload) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(payload)); };
    try {
      const url=new URL(req.url,'http://localhost');
      let path=url.pathname;
      if(basePath) {
        if(path===basePath) { res.writeHead(308,{Location:basePath+'/','Cache-Control':'no-store'});res.end();return; }
        if(!path.startsWith(basePath+'/')) throw fail(404,'Не найдено');
        path=path.slice(basePath.length);
      }
      if(!path.startsWith('/api/')) {
        if(req.method!=='GET' && req.method!=='HEAD') throw fail(405,'Метод не поддерживается');
        const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/voice.js':'voice.js','/attachments.js':'attachments.js','/video.js':'video.js','/location.js':'location.js','/vendor/leaflet.js':'vendor/leaflet.js','/vendor/leaflet.css':'vendor/leaflet.css','/style.css':'style.css','/icon.svg':'icon.svg','/avatars/artur.png':'avatars/artur.png','/avatars/adel.png':'avatars/adel.png','/avatars/rezeda.png':'avatars/rezeda.png','/avatars/family.png':'avatars/family.png','/avatars/chelsey.png':'avatars/chelsey.png'};
        const file=files[path]; if(!file) throw fail(404,'Не найдено');
        const body=readFileSync(resolve(assets,file));
        res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'})[extname(file)],'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cache-Control':'no-cache'});
        res.end(req.method==='HEAD'?undefined:body); return;
      }
      if(path==='/api/health' && req.method==='GET') return send(200,{ok:true,name:'Graff',version:'0.6.0',video:true,push:push.enabled,voice:true,transcription:transcription.enabled});
      const ip=req.socket.remoteAddress || 'local';
      throttle('all:'+ip,600,60000);
      if(req.headers.origin) {
        const expected=publicOrigin || `${req.socket.encrypted?'https':'http'}://${req.headers.host}`;
        if(req.headers.origin!==expected) throw fail(403,'Недопустимый источник запроса');
      }
      let body={};
      if(['POST','PUT','PATCH'].includes(req.method)) {
        if(!(req.headers['content-type']||'').startsWith('application/json')) throw fail(415,'Ожидается JSON');
        let size=0,chunks=[];
        for await(const chunk of req) { size+=chunk.length; if(size>(/^\/api\/chats\/[a-zA-Z0-9-]+\/video$/.test(path)?11300000:/^\/api\/chats\/[a-zA-Z0-9-]+\/(voice|image)$/.test(path)?2900000:32768)) throw fail(413,'Слишком большой запрос'); chunks.push(chunk); }
        try { body=JSON.parse(Buffer.concat(chunks).toString()||'{}'); } catch { throw fail(400,'Некорректный JSON'); }
        if(!body || Array.isArray(body) || typeof body!=='object') throw fail(400,'Некорректный запрос');
      }
      if(path==='/api/auth/register' && req.method==='POST') {
        throttle('auth:'+ip,15,15*60000);
        const login=str(body.login,3,25,'Логин: от 3 до 24 символов').replace(/^@/,'').toLowerCase();
        if(!/^[a-z0-9_]{3,24}$/.test(login)) throw fail(400,'В логине допустимы a–z, цифры и _');
        const name=str(body.name,1,40,'Имя: от 1 до 40 символов');
        if(typeof body.password!=='string' || body.password.length<10 || body.password.length>128) throw fail(400,'Пароль: от 10 до 128 символов');
        const code=hash(str(body.invite,8,100,'Введите код приглашения').toUpperCase());
        if(!one('SELECT code FROM invites WHERE code=? AND used=0 AND expires>?',code,now())) throw fail(400,'Приглашение недействительно или уже использовано');
        const salt=randomBytes(16).toString('hex'), password=(await scrypt(body.password,salt,64)).toString('hex');
        const user=transaction(()=>{
          const invite=one('SELECT * FROM invites WHERE code=? AND used=0 AND expires>?',code,now());
          if(!invite) throw fail(400,'Приглашение уже использовано');
          if(one('SELECT id FROM users WHERE login=?',login)) throw fail(409,'Этот логин занят');
          const u={id:randomUUID(),login,name,salt,password,admin:invite.admin};
          run('INSERT INTO users VALUES(?,?,?,?,?,?)',u.id,login,name,salt,password,u.admin);
          run('UPDATE invites SET used=1 WHERE code=?',code);
          run('INSERT INTO members(chat_id,user_id) VALUES(?,?)','family',u.id);
          return u;
        });
        return send(201,session(user));
      }
      if(path==='/api/auth/login' && req.method==='POST') {
        throttle('auth:'+ip,15,15*60000);
        const login=str(body.login,1,25,'Введите логин').replace(/^@/,'').toLowerCase();
        if(typeof body.password!=='string' || body.password.length>128) throw fail(400,'Введите пароль');
        const u=one('SELECT * FROM users WHERE login=?',login);
        const actual=await scrypt(body.password,u?.salt||dummySalt,64);
        if(!u || !timingSafeEqual(actual,Buffer.from(u.password,'hex'))) throw fail(401,'Неверный логин или пароль');
        return send(200,session(u));
      }
      const token=(req.headers.authorization||'').replace(/^Bearer /,'');
      const user=one('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',hash(token),now());
      if(!user) throw fail(401,'Войдите в аккаунт');
      const locationResult=locations.handle(path,req.method,body,user,hash(token));
      if(locationResult)return send(200,locationResult);
      if(path==='/api/push/devices' && req.method==='POST') {
        if(!push.enabled) throw fail(503,'Уведомления ещё не подключены на сервере');
        const deviceToken=str(body.token,30,4096,'Некорректный токен устройства');
        const installation=str(body.installation,16,100,'Некорректный идентификатор устройства');
        if(!/^[A-Za-z0-9_:-]+$/.test(deviceToken)||!/^[a-zA-Z0-9-]+$/.test(installation)) throw fail(400,'Некорректное устройство');
        transaction(()=>{
          // Rebinding a token must drop queued messages from the previous account/session.
          run('DELETE FROM push_devices WHERE (token=? OR installation=?) AND session_token!=?',deviceToken,installation,hash(token));
          run('DELETE FROM push_devices WHERE installation=? AND token!=?',installation,deviceToken);
          run('INSERT INTO push_devices VALUES(?,?,?,?) ON CONFLICT(token) DO UPDATE SET installation=excluded.installation,session_token=excluded.session_token,updated=excluded.updated',deviceToken,installation,hash(token),now());
        });
        return send(200,{ok:true});
      }
      if(path==='/api/me' && req.method==='GET') return send(200,{user:cleanUser(user)});
      if(path==='/api/auth/logout' && req.method==='POST') { run('DELETE FROM sessions WHERE token=?',hash(token)); return send(200,{ok:true}); }
      if(path==='/api/users' && req.method==='GET') return send(200,{users:all('SELECT id,login,name FROM users ORDER BY name')});
      if(path==='/api/invites' && req.method==='POST') {
        if(!user.admin) throw fail(403,'Приглашения создаёт владелец семьи');
        throttle('invite:'+user.id,30,3600000);
        const code=randomBytes(8).toString('hex').toUpperCase();
        run('INSERT INTO invites VALUES(?,?,0,0)',hash(code),now()+7*86400000);
        return send(201,{code,expires:now()+7*86400000});
      }
      if(path==='/api/chats' && req.method==='GET') {
        const chats=all(`SELECT c.*, mm.last_read,
          (SELECT MAX(id) FROM messages WHERE chat_id=c.id AND deleted_at IS NULL) AS last_id,
          (SELECT COUNT(*) FROM messages WHERE chat_id=c.id AND id>mm.last_read AND deleted_at IS NULL AND user_id!=?) AS unread
          FROM chats c JOIN members mm ON mm.chat_id=c.id WHERE mm.user_id=? ORDER BY COALESCE(last_id,0) DESC,c.created DESC`,user.id,user.id);
        for(const c of chats) {
          c.members=all('SELECT u.id,u.login,u.name,m.last_read FROM members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=?',c.id);
          if(c.kind==='direct') c.title=c.members.find(u=>u.id!==user.id)?.name||'Личный чат';
          c.last_message=c.last_id?message(c.last_id):null;
          delete c.direct_key;
        }
        return send(200,{chats});
      }
      if(path==='/api/chats' && req.method==='POST') {
        const kind=body.kind;
        if(!['direct','group'].includes(kind)) throw fail(400,'Укажите тип чата');
        if(!Array.isArray(body.members) || body.members.length>50 || body.members.some(x=>typeof x!=='string')) throw fail(400,'Выберите участников');
        const ids=[...new Set([user.id,...body.members])];
        if(ids.length<2 || (kind==='direct' && ids.length!==2)) throw fail(400,'Выберите собеседника');
        for(const id of ids) if(!one('SELECT id FROM users WHERE id=?',id)) throw fail(400,'Участник не найден');
        const title=kind==='group'?str(body.title,1,60,'Введите название группы'):'';
        const directKey=kind==='direct'?[...ids].sort().join(':'):null;
        if(directKey) { const old=one('SELECT id FROM chats WHERE direct_key=?',directKey); if(old) return send(200,old); }
        const id=randomUUID();
        transaction(()=>{run('INSERT INTO chats VALUES(?,?,?,?,?)',id,kind,title,directKey,now());for(const uid of ids) run('INSERT INTO members(chat_id,user_id) VALUES(?,?)',id,uid);});
        return send(201,{id});
      }
      const mutation=path.match(/^\/api\/chats\/([a-zA-Z0-9-]+)\/messages\/(\d+)\/(edit|delete|audio|transcribe|image|video)$/);
      if(mutation){
        const [,chat,rawId,action]=mutation,id=Number(rawId);membership(chat,user);
        const current=one('SELECT * FROM messages WHERE id=? AND chat_id=?',id,chat);
        if(!current||current.deleted_at)throw fail(404,'Сообщение удалено или не найдено');
        if(action==='video' && req.method==='GET'){
          if(current.kind!=='video')throw fail(404,'Видео не найдено');
          const poster=url.searchParams.get('poster')==='1';
          return send(200,{video:videoStore.read(current.video_path,poster).toString('base64'),mime:poster?'image/jpeg':'video/mp4'});
        }
        if(action==='image' && req.method==='GET'){
          if(current.kind!=='image')throw fail(404,'Изображение не найдено');
          return send(200,{image:imageStore.read(current.image_path,url.searchParams.get('thumbnail')==='1').toString('base64'),mime:'image/jpeg'});
        }
        if(action==='audio' && req.method==='GET'){
          if(current.kind!=='voice')throw fail(404,'Аудиозапись не найдена');
          return send(200,{audio:voiceStore.read(current.voice_path).toString('base64'),mime:current.voice_mime});
        }
        if(req.method!=='POST')throw fail(405,'Метод не поддерживается');
        if(action==='transcribe'){
          if(!transcription.enabled)throw fail(503,'Расшифровка ещё не подключена');
          if(current.kind!=='voice')throw fail(400,'Это текстовое сообщение');
          throttle('transcribe:'+user.id,12,60000);
          if(current.transcript_status==='failed'||current.transcript_status==='unavailable')transaction(()=>{run("UPDATE messages SET transcript_status='queued' WHERE id=?",id);touchMessage(id);});
          send(200,{message:message(id)});drainTranscription();return;
        }
        if(current.user_id!==user.id)throw fail(403,'Можно изменять только свои сообщения');
        if(body.revision!==current.revision)throw fail(409,'Сообщение уже изменилось. Откройте его заново.');
        if(action==='edit'){
          if(!['text','image'].includes(current.kind))throw fail(400,'Можно редактировать текст или подпись');
          const text=str(body.body,current.kind==='image'?0:1,4000,'Сообщение: до 4000 символов');
          transaction(()=>{if(!run('UPDATE messages SET body=?,edited_at=? WHERE id=? AND revision=? AND deleted_at IS NULL',text,now(),id,body.revision).changes)throw fail(409,'Сообщение уже изменилось');touchMessage(id);});
        }else if(action==='delete'){
          transaction(()=>{if(!run("UPDATE messages SET body='',transcript=NULL,transcript_status=NULL,voice_path=NULL,image_path=NULL,video_path=NULL,deleted_at=? WHERE id=? AND revision=? AND deleted_at IS NULL",now(),id,body.revision).changes)throw fail(409,'Сообщение уже изменилось');touchMessage(id);run('DELETE FROM push_outbox WHERE message_id=?',id);});
          if(current.voice_path)voiceStore.remove(current.voice_path);
          if(current.image_path)imageStore.remove(current.image_path);
          if(current.video_path)videoStore.remove(current.video_path);
        }else throw fail(404,'Не найдено');
        return send(200,{message:message(id)});
      }
      const video=path.match(/^\/api\/chats\/([a-zA-Z0-9-]+)\/video$/);
      if(video&&req.method==='POST'){
        const chat=video[1];membership(chat,user);throttle('video:'+user.id,6,60000);
        const nonce=str(body.nonce,8,80,'Не задан идентификатор сообщения');
        const existing=one('SELECT id,chat_id,kind FROM messages WHERE user_id=? AND nonce=?',user.id,nonce);
        if(existing){if(existing.chat_id!==chat||existing.kind!=='video')throw fail(409,'Конфликт идентификатора сообщения');return send(200,{message:message(existing.id)});}
        const clip=await videoStore.prepare(body.video,body.mime);let id;
        try{
          if(!one('SELECT 1 FROM sessions WHERE token=? AND expires>?',hash(token),now()))throw fail(401,'Войдите в аккаунт');membership(chat,user);
          id=transaction(()=>{
            const duplicate=one('SELECT id,chat_id,kind FROM messages WHERE user_id=? AND nonce=?',user.id,nonce);
            if(duplicate){if(duplicate.chat_id!==chat||duplicate.kind!=='video')throw fail(409,'Конфликт идентификатора сообщения');videoStore.remove(clip.key);return duplicate.id;}
            const id=Number(run("INSERT INTO messages(chat_id,user_id,body,nonce,created,kind,video_path,duration_ms) VALUES(?,?,?,?,?,'video',?,?)",chat,user.id,'',nonce,now(),clip.key,clip.duration).lastInsertRowid);touchMessage(id);push.enqueue(id);return id;
          });
        }catch(e){videoStore.remove(clip.key);throw e;}
        send(201,{message:message(id)});drainPush();return;
      }
      const photo=path.match(/^\/api\/chats\/([a-zA-Z0-9-]+)\/image$/);
      if(photo&&req.method==='POST'){
        const chat=photo[1];membership(chat,user);throttle('image:'+user.id,20,60000);
        const nonce=str(body.nonce,8,80,'Не задан идентификатор сообщения'),caption=str(body.body??'',0,4000,'Подпись: до 4000 символов');
        const existing=one('SELECT id,chat_id,kind FROM messages WHERE user_id=? AND nonce=?',user.id,nonce);
        if(existing){if(existing.chat_id!==chat||existing.kind!=='image')throw fail(409,'Конфликт идентификатора сообщения');return send(200,{message:message(existing.id)});}
        const picture=await imageStore.prepare(body.image);let id;
        try{
          if(!one('SELECT 1 FROM sessions WHERE token=? AND expires>?',hash(token),now()))throw fail(401,'Войдите в аккаунт');membership(chat,user);
          id=transaction(()=>{
            const duplicate=one('SELECT id,chat_id,kind FROM messages WHERE user_id=? AND nonce=?',user.id,nonce);
            if(duplicate){if(duplicate.chat_id!==chat||duplicate.kind!=='image')throw fail(409,'Конфликт идентификатора сообщения');imageStore.remove(picture.key);return duplicate.id;}
            const id=Number(run("INSERT INTO messages(chat_id,user_id,body,nonce,created,kind,image_path,image_width,image_height) VALUES(?,?,?,?,?,'image',?,?,?)",chat,user.id,caption,nonce,now(),picture.key,picture.width,picture.height).lastInsertRowid);touchMessage(id);push.enqueue(id);return id;
          });
        }catch(e){imageStore.remove(picture.key);throw e;}
        send(201,{message:message(id)});drainPush();return;
      }
      const voice=path.match(/^\/api\/chats\/([a-zA-Z0-9-]+)\/voice$/);
      if(voice && req.method==='POST'){
        const chat=voice[1];membership(chat,user);throttle('voice:'+user.id,10,60000);
        const nonce=str(body.nonce,8,80,'Не задан идентификатор сообщения');
        const existing=one('SELECT id,chat_id,kind FROM messages WHERE user_id=? AND nonce=?',user.id,nonce);
        if(existing){if(existing.chat_id!==chat||existing.kind!=='voice')throw fail(409,'Конфликт идентификатора сообщения');return send(200,{message:message(existing.id)});}
        if(one("SELECT COUNT(*) n FROM messages WHERE transcript_status IN ('queued','working') AND deleted_at IS NULL").n>=20)throw fail(429,'Много записей ожидают обработки. Отправьте чуть позже.');
        const clip=await voiceStore.prepare(body.audio,body.mime);
        let id;
        try{
          // Recheck login after decoding; logout or expiry must invalidate a pending upload.
          if(!one('SELECT 1 FROM sessions WHERE token=? AND expires>?',hash(token),now()))throw fail(401,'Войдите в аккаунт');
          id=transaction(()=>{
            const duplicate=one('SELECT id,chat_id,kind FROM messages WHERE user_id=? AND nonce=?',user.id,nonce);
            if(duplicate){if(duplicate.chat_id!==chat||duplicate.kind!=='voice')throw fail(409,'Конфликт идентификатора сообщения');voiceStore.remove(clip.key);return duplicate.id;}
            const id=Number(run("INSERT INTO messages(chat_id,user_id,body,nonce,created,kind,voice_path,voice_mime,duration_ms,transcript_status) VALUES(?,?,?,?,?,'voice',?,?,?,?)",chat,user.id,'',nonce,now(),clip.key,clip.mime,clip.duration,transcription.enabled?'queued':'unavailable').lastInsertRowid);
            touchMessage(id);push.enqueue(id);return id;
          });
        }catch(e){voiceStore.remove(clip.key);throw e;}
        send(201,{message:message(id)});drainPush();drainTranscription();return;
      }
      const match=path.match(/^\/api\/chats\/([a-zA-Z0-9-]+)\/(messages|read)$/);
      if(match) {
        const [,chat,action]=match;
        membership(chat,user);
        if(action==='messages' && req.method==='GET') {
          const cursor=name=>{const raw=url.searchParams.get(name);if(raw===null)return null;if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw fail(400,'Некорректный курсор');return Number(raw);};
          const after=cursor('after'), before=cursor('before'), since=cursor('since');
          const ceiling=one('SELECT value FROM message_clock WHERE id=1').value;
          if(after!==null && before!==null) throw fail(400,'Укажите один курсор');
          let rows;
          if(after!==null) rows=all('SELECT id FROM messages WHERE chat_id=? AND deleted_at IS NULL AND id>? ORDER BY id ASC LIMIT 81',chat,after);
          else rows=all('SELECT id FROM messages WHERE chat_id=? AND deleted_at IS NULL AND id<? ORDER BY id DESC LIMIT 81',chat,before??Number.MAX_SAFE_INTEGER);
          const hasMore=rows.length>80; rows=rows.slice(0,80); if(after===null) rows.reverse();
          const receipts=all('SELECT user_id,last_read FROM members WHERE chat_id=? AND user_id!=?',chat,user.id);
          const changes=since===null?[]:all('SELECT id,revision FROM messages WHERE chat_id=? AND revision>? AND revision<=? ORDER BY revision LIMIT 81',chat,since,ceiling);
          const hasChanges=changes.length>80;const page=changes.slice(0,80);
          return send(200,{messages:rows.map(r=>message(r.id)),hasMore,receipts,changes:page.map(r=>message(r.id)),changeCursor:hasChanges?page.at(-1).revision:ceiling,hasChanges});
        }
        if(action==='messages' && req.method==='POST') {
          throttle('send:'+user.id,90,60000);
          const text=str(body.body,1,4000,'Сообщение: от 1 до 4000 символов');
          const nonce=str(body.nonce,8,80,'Не задан идентификатор сообщения');
          const existing=one('SELECT id,chat_id,body,kind FROM messages WHERE user_id=? AND nonce=?',user.id,nonce);
          if(existing) {
            if(existing.chat_id!==chat || existing.body!==text || existing.kind!=='text') throw fail(409,'Конфликт идентификатора сообщения');
            return send(200,{message:message(existing.id)});
          }
          const id=transaction(()=>{
            const result=run('INSERT INTO messages(chat_id,user_id,body,nonce,created) VALUES(?,?,?,?,?)',chat,user.id,text,nonce,now());
            const id=Number(result.lastInsertRowid);touchMessage(id);push.enqueue(id);return id;
          });
          send(201,{message:message(id)});
          drainPush();
          return;
        }
        if(action==='read' && req.method==='POST') {
          if(!Number.isSafeInteger(body.id) || body.id<0) throw fail(400,'Некорректный номер сообщения');
          const id=one('SELECT MAX(id) AS id FROM messages WHERE chat_id=? AND id<=?',chat,body.id).id||0;
          run('UPDATE members SET last_read=MAX(last_read,?) WHERE chat_id=? AND user_id=?',id,chat,user.id);
          return send(200,{ok:true});
        }
      }
      throw fail(404,'Не найдено');
    } catch(e) {
      if(!e.status) console.error('Request failed:',e.message);
      if(!res.headersSent) send(e.status||500,{error:e.status?e.message:'Ошибка сервера. Попробуйте ещё раз.'});
      else res.end();
    }
  });
  server.requestTimeout=60000;
  server.headersTimeout=10000;
  return { server, db, drainPush:()=>push.drain(),drainTranscription:()=>transcription.drain(), close:async()=>{locations.close();await transcription.close();await push.close();await new Promise(r=>server.close(r));db.close();} };
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createMessenger();
  const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';
  app.server.listen(port,host,()=>console.log(`Graff: http://${host}:${port}\nКод первого приглашения: data/first-invite.txt\nДля домашнего Wi-Fi запустите с HOST=0.0.0.0`));
  const stop=()=>app.close().then(()=>process.exit(0));
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

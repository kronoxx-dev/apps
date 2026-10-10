import {randomUUID} from 'node:crypto';
export function locationApi(db){
 db.exec(`CREATE TABLE IF NOT EXISTS locations(user_id TEXT PRIMARY KEY REFERENCES users(id), session_token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE, share_id TEXT NOT NULL, started INTEGER NOT NULL, lat REAL, lon REAL, accuracy REAL, recorded INTEGER, updated INTEGER);`);
 const fail=(status,message)=>Object.assign(new Error(message),{status});
 const purge=()=>db.prepare('DELETE FROM locations WHERE COALESCE(updated,started)<? OR session_token IN (SELECT token FROM sessions WHERE expires<?)').run(Date.now()-86400000,Date.now());
 const timer=setInterval(purge,300000);timer.unref();purge();
 return {close:()=>clearInterval(timer),handle(path,method,body,user,session){
  if(!['/api/locations','/api/location/share','/api/location/update'].includes(path))return null;
  if(!db.prepare("SELECT 1 FROM members WHERE chat_id='family' AND user_id=?").get(user.id))throw fail(403,'Нет доступа к семейной карте');
  purge();
  if(path==='/api/locations'&&method==='GET'){
   const members=db.prepare("SELECT u.id,u.login,u.name,l.lat,l.lon,l.accuracy,l.recorded,l.updated,l.started FROM users u JOIN members m ON m.user_id=u.id AND m.chat_id='family' LEFT JOIN locations l ON l.user_id=u.id ORDER BY u.name").all();
   return {members:members.map(u=>({id:u.id,login:u.login,name:u.name,sharing:u.started!=null,location:u.lat==null?null:{lat:u.lat,lon:u.lon,accuracy:u.accuracy,recorded:u.recorded,updated:u.updated}}))};
  }
  if(method!=='POST'||path==='/api/locations')throw fail(405,'Метод не поддерживается');
  if(path==='/api/location/share'){
   if(typeof body.enabled!=='boolean')throw fail(400,'Укажите, включить ли геолокацию');
   if(!body.enabled){
    if(body.shareId)db.prepare('DELETE FROM locations WHERE user_id=? AND session_token=? AND share_id=?').run(user.id,session,body.shareId);
    else db.prepare('DELETE FROM locations WHERE user_id=?').run(user.id);
    return {ok:true};
   }
   const id=randomUUID();
   db.prepare('INSERT INTO locations(user_id,session_token,share_id,started) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET session_token=excluded.session_token,share_id=excluded.share_id,started=excluded.started,lat=NULL,lon=NULL,accuracy=NULL,recorded=NULL,updated=NULL').run(user.id,session,id,Date.now());
   return {shareId:id};
  }
  const {lat,lon,accuracy,recorded,shareId}=body;
  if([lat,lon,accuracy,recorded].some(v=>typeof v!=='number'||!Number.isFinite(v))||Math.abs(lat)>90||Math.abs(lon)>180||accuracy<0||accuracy>100000||recorded<Date.now()-300000||recorded>Date.now()+60000)throw fail(400,'Некорректные или устаревшие координаты');
  if(typeof shareId!=='string')throw fail(400,'Передача локации не включена');
  const result=db.prepare('UPDATE locations SET lat=?,lon=?,accuracy=?,recorded=?,updated=? WHERE user_id=? AND session_token=? AND share_id=? AND (recorded IS NULL OR recorded<=?)').run(lat,lon,accuracy,recorded,Date.now(),user.id,session,shareId,recorded);
  if(!result.changes)throw fail(409,'Передача локации завершена или координаты уже обновились');
  return {ok:true};
 }};
}

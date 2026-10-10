import {readFileSync} from 'node:fs';
import {createSign, randomUUID} from 'node:crypto';

// Credentials live outside both the repository and the public web directory.
export function firebaseSender(file, transport=fetch) {
  const account=JSON.parse(readFileSync(file,'utf8'));
  if(!/^[a-z0-9-]+$/.test(account.project_id)||!account.client_email||!account.private_key) throw new Error('Invalid Firebase service account');
  let access=null, refreshing=null;
  async function authorize() {
    if(access && access.expires>Date.now()+60000) return access.token;
    if(refreshing) return refreshing;
    refreshing=(async()=>{
      const time=Math.floor(Date.now()/1000);
      const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:time,exp:time+3600});
      const signature=createSign('RSA-SHA256').update(unsigned).sign(account.private_key,'base64url');
      const response=await transport('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),signal:AbortSignal.timeout(15000)});
      const result=await response.json();
      if(!response.ok||!result.access_token) throw new Error('Firebase authorization failed');
      access={token:result.access_token,expires:Date.now()+Number(result.expires_in||3600)*1000};
      return access.token;
    })();
    try{return await refreshing;}finally{refreshing=null;}
  }
  return async ({token,data}, {validateOnly=false}={})=>{
    const response=await transport(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,{
      method:'POST',headers:{Authorization:'Bearer '+await authorize(),'Content-Type':'application/json'},
      body:JSON.stringify({validate_only:validateOnly,message:{token,data,android:{priority:'high',ttl:'86400s'}}}),signal:AbortSignal.timeout(15000)
    });
    if(response.ok) return;
    const result=await response.json().catch(()=>({}));
    if(response.status===401) access=null;
    const invalid=result.error?.details?.some(d=>d['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError'&&d.errorCode==='UNREGISTERED');
    throw Object.assign(new Error('FCM HTTP '+response.status),{invalidToken:invalid});
  };
}

export function createPushQueue(db, sender) {
  db.exec(`CREATE TABLE IF NOT EXISTS push_devices(
    token TEXT PRIMARY KEY, installation TEXT UNIQUE NOT NULL,
    session_token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
    updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS push_outbox(
    message_id INTEGER NOT NULL REFERENCES messages(id), token TEXT NOT NULL REFERENCES push_devices(token) ON DELETE CASCADE,
    recipient TEXT NOT NULL REFERENCES users(id), session_token TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL,
    lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(message_id,token));
    CREATE INDEX IF NOT EXISTS push_due ON push_outbox(next_attempt,lease_until);`);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  let running=null, stopped=false;
  const enqueue=(id)=>{
    if(!sender)return;
    run(`INSERT OR IGNORE INTO push_outbox(message_id,token,recipient,session_token,next_attempt)
      SELECT m.id,d.token,s.user_id,s.token,? FROM messages m
      JOIN members mm ON mm.chat_id=m.chat_id AND mm.user_id!=m.user_id
      JOIN sessions s ON s.user_id=mm.user_id AND s.expires>?
      JOIN push_devices d ON d.session_token=s.token WHERE m.id=?`,Date.now(),Date.now(),id);
  };
  async function dispatch() {
    if(!sender||stopped)return;
    // SQLite lease also protects against another Passenger worker draining this database.
    for(let count=0;count<100&&!stopped;count++){
      const time=Date.now(),lease=randomUUID();
      const job=db.prepare(`UPDATE push_outbox SET lease=?,lease_until=? WHERE (message_id,token)=(
        SELECT message_id,token FROM push_outbox WHERE next_attempt<=? AND lease_until<=? ORDER BY message_id LIMIT 1)
        RETURNING *`).get(lease,time+60000,time,time);
      if(!job)break;
      const remove=()=>run('DELETE FROM push_outbox WHERE message_id=? AND token=? AND lease=?',job.message_id,job.token,lease);
      const row=db.prepare(`SELECT m.*,u.name,c.kind AS chat_kind,c.title FROM messages m
        JOIN users u ON u.id=m.user_id JOIN chats c ON c.id=m.chat_id
        JOIN members mm ON mm.chat_id=m.chat_id AND mm.user_id=? AND mm.last_read<m.id
        JOIN sessions s ON s.user_id=mm.user_id AND s.token=? AND s.expires>?
        JOIN push_devices d ON d.session_token=s.token AND d.token=?
        WHERE m.id=? AND m.deleted_at IS NULL AND m.user_id!=mm.user_id`).get(job.recipient,job.session_token,time,job.token,job.message_id);
      if(!row||row.created<time-86400000){remove();continue;}
      try {
        await sender({token:job.token,data:{chatId:row.chat_id,messageId:String(row.id),recipientUserId:job.recipient,
          title:row.chat_kind==='direct'?row.name:row.title,body:(row.chat_kind==='direct'?'':row.name+': ')+(row.kind==='voice'?'🎙 Голосовое сообщение':(row.kind==='image'?'📷 Фото'+(row.body?': ':''):'')+Array.from(row.body).slice(0,180).join(''))}});
        remove();
      } catch(e) {
        if(e.invalidToken){run('DELETE FROM push_devices WHERE token=?',job.token);continue;}
        // Never log device tokens, message text, account credentials or bearer tokens.
        console.warn('Push delivery deferred');
        run('UPDATE push_outbox SET attempts=attempts+1,next_attempt=?,lease=NULL,lease_until=0 WHERE message_id=? AND token=? AND lease=?',time+Math.min(3600000,5000*2**Math.min(job.attempts,10)),job.message_id,job.token,lease);
      }
    }
  }
  function drain(){if(stopped)return Promise.resolve();if(!running)running=dispatch().finally(()=>{running=null;});return running;}
  const timer=sender?setInterval(()=>{drain().catch(()=>console.warn('Push queue temporarily unavailable'));},5000):null;
  timer?.unref();
  return {enqueue,drain,enabled:Boolean(sender),close:async()=>{stopped=true;clearInterval(timer);await running;}};
}

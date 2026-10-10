'use strict';
const durationText=ms=>Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0');
const audioPlayer=new Audio();
const audioCache=new Map();
let voiceDraft=null,voiceChat=null,voiceStream=null,voiceRecorder=null,voiceTimer=null,voiceStarted=0,voiceDiscard=false,voiceEpoch=0;
function audioUrl(encoded,mime){const raw=atob(encoded),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return URL.createObjectURL(new Blob([bytes],{type:mime}));}
function voiceBubble(m){
 const status=m.transcript_status;
 const text=status==='done'?m.transcript:status==='failed'?'Не получилось распознать запись. Попробуйте ещё раз.':status==='unavailable'?'Расшифровка пока недоступна.':'Распознаём речь на семейном сервере…';
 return `<div class="voice-player"><button type="button" class="voice-play" data-play-message="${m.id}" aria-label="${S.voicePlaying===m.id?'Пауза':'Прослушать голосовое сообщение'}">${icon(S.voicePlaying===m.id?'pause':'play')}</button><div class="voice-details"><div class="voice-wave" aria-hidden="true">${[5,9,14,8,19,11,24,15,9,17,25,12,18,8,15,22,10,16,7,12,19,9].map(h=>`<i style="height:${h}px"></i>`).join('')}</div><small>${durationText(m.duration_ms)}</small></div></div><button class="transcript-toggle" type="button" data-transcript="${m.id}">${S.transcriptOpen[m.id]?'Скрыть текст':status==='working'||status==='queued'?'Распознаём…':'Текст сообщения'}</button>${S.transcriptOpen[m.id]?`<div class="voice-transcript">${esc(text)}${status==='failed'?`<button class="text-btn" data-retry-transcript="${m.id}">Повторить расшифровку</button>`:''}</div>`:''}`;
}
function refreshPlayButtons(){document.querySelectorAll('[data-play-message]').forEach(button=>{const playing=Number(button.dataset.playMessage)===S.voicePlaying;button.innerHTML=icon(playing?'pause':'play');button.setAttribute('aria-label',playing?'Пауза':'Прослушать голосовое сообщение');});}
audioPlayer.onended=()=>{S.voicePlaying=null;refreshPlayButtons();};
window.graffPauseVoice=()=>{audioPlayer.pause();S.voicePlaying=null;refreshPlayButtons();};
window.graffClearAudio=()=>{window.graffPauseVoice();audioPlayer.removeAttribute('src');for(const url of audioCache.values())URL.revokeObjectURL(url);audioCache.clear();S.transcriptOpen={};};
async function playMessage(id){
 if(S.voicePlaying===id){window.graffPauseVoice();return;}
 window.graffPauseVoice();const current=S.messages.find(m=>m.id===id&&!m.deleted_at);if(!current)return;
 const user=config.user?.id;
 if(!audioCache.has(id)){
  const r=await api(`/chats/${current.chat_id}/messages/${id}/audio`);
  if(config.user?.id!==user||S.chatId!==current.chat_id||S.messages.find(m=>m.id===id)?.deleted_at)return;
  if(audioCache.size>=10){const [old,url]=audioCache.entries().next().value;URL.revokeObjectURL(url);audioCache.delete(old);}
  audioCache.set(id,audioUrl(r.audio,r.mime));
 }
 audioPlayer.src=audioCache.get(id);await audioPlayer.play();S.voicePlaying=id;refreshPlayButtons();
}
window.onMessageChanged=message=>{window.photoMessageChanged?.(message);if(message.deleted_at){if(S.voicePlaying===message.id)window.graffPauseVoice();if(audioCache.has(message.id)){URL.revokeObjectURL(audioCache.get(message.id));audioCache.delete(message.id);}}};
function applyMessageChange(message){window.photoMessageChanged?.(message);const i=S.messages.findIndex(m=>m.id===message.id);if(i>=0)S.messages[i]=message;if(message.deleted_at){if(S.voicePlaying===message.id)window.graffPauseVoice();if(audioCache.has(message.id)){URL.revokeObjectURL(audioCache.get(message.id));audioCache.delete(message.id);}}renderMessages();refresh();}
function messageOptions(id){const m=S.messages.find(m=>m.id===id&&!m.deleted_at);if(!m||m.user_id!==config.user?.id)return;modal('Сообщение',`${m.kind!=='voice'?`<button class="setting" data-edit-message="${id}">${icon('edit')}<div><strong>${m.kind==='image'?'Изменить подпись':'Редактировать'}</strong><small>Изменится у всех участников</small></div></button>`:''}<button class="setting destructive" data-delete-message="${id}">${icon('trash')}<div><strong>Удалить у всех</strong><small>Сообщение исчезнет из этого чата</small></div></button>`);}
function editMessage(id){const m=S.messages.find(m=>m.id===id&&!m.deleted_at);if(!m)return;modal('Редактировать сообщение',`<form class="form" id="edit-message-form" data-id="${id}" data-revision="${m.revision||0}"><label class="field">Текст<textarea name="body" rows="5" maxlength="4000" ${m.kind==='image'?'':'required'}>${esc(m.body)}</textarea></label><div class="form-error" role="alert"></div><button class="primary" type="submit">Сохранить для всех</button></form>`);}
function confirmDelete(id){const m=S.messages.find(m=>m.id===id&&!m.deleted_at);if(!m)return;modal('Удалить у всех?',`<p>Сообщение исчезнет у всех участников этого чата.</p><button class="primary danger-button" data-confirm-delete="${id}" data-revision="${m.revision||0}">Удалить сообщение</button><button class="text-btn" data-action="close-modal">Отмена</button>`);}
window.clearVoiceDraft=()=>{
 voiceEpoch++;clearInterval(voiceTimer);voiceTimer=null;voiceDiscard=true;
 if(native&&Android.cancelVoice)Android.cancelVoice();
 if(voiceRecorder?.state==='recording')voiceRecorder.stop();
 voiceStream?.getTracks().forEach(t=>t.stop());voiceStream=null;voiceRecorder=null;
 if(voiceDraft?.url)URL.revokeObjectURL(voiceDraft.url);voiceDraft=null;voiceChat=null;
};
function recordingView(){voiceStarted=Date.now();modal('Голосовое сообщение',`<div class="recording-view"><span class="recording-light"></span><strong id="recording-time">0:00</strong><p>До 2 минут · только для этого чата</p></div><button class="primary" data-action="stop-voice">Остановить запись</button><button class="text-btn" data-action="cancel-voice">Отмена</button>`);clearInterval(voiceTimer);voiceTimer=setInterval(()=>{const el=$('#recording-time');if(el)el.textContent=durationText(Date.now()-voiceStarted);},250);}
window.onVoiceEvent=event=>{
 if(event.state==='recording'){voiceDiscard=false;recordingView();return;}
 if(event.state==='ready'){
  clearInterval(voiceTimer);if(voiceDiscard||!voiceChat)return;
  voiceDraft={...event,nonce:crypto.randomUUID(),chat:voiceChat};voiceDraft.url=audioUrl(event.audio,event.mime);
  modal('Голосовое сообщение',`<div class="voice-preview"><audio controls src="${voiceDraft.url}"></audio><p>${durationText(event.duration)} · после отправки появится расшифровка</p></div><div class="form-error voice-error" role="alert"></div><button class="primary" data-action="send-voice">Отправить ${icon('send')}</button><button class="text-btn" data-action="cancel-voice">Удалить запись</button>`);return;
 }
 if(event.state==='error'){closeModal();toast(event.error||'Не удалось записать сообщение');}
 if(event.state==='cancelled'){closeModal();toast('Запись отменена');}
};
async function startVoice(){
 if(S.demo){toast('Голосовые доступны после входа в аккаунт');return;}
 window.graffPauseVoice();window.clearVoiceDraft();voiceDiscard=false;voiceChat=S.chatId;
 if(native&&Android.startVoice){modal('Микрофон','<p>Разрешите доступ к микрофону, чтобы записать голосовое сообщение.</p><button class="text-btn" data-action="cancel-voice">Отмена</button>');Android.startVoice();return;}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Запись недоступна в этом браузере. Откройте Graff на Android.');
 modal('Микрофон','<p>Разрешите доступ к микрофону, чтобы записать голосовое сообщение.</p><button class="text-btn" data-action="cancel-voice">Отмена</button>');
 const epoch=voiceEpoch,stream=await navigator.mediaDevices.getUserMedia({audio:true});
 if(voiceDiscard||epoch!==voiceEpoch){stream.getTracks().forEach(t=>t.stop());return;}voiceStream=stream;
 const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
 voiceRecorder=new MediaRecorder(voiceStream,mime?{mimeType:mime,audioBitsPerSecond:32000}:{});const recorder=voiceRecorder,chunks=[];
 voiceRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
 voiceRecorder.onstop=async()=>{
  if(epoch!==voiceEpoch)return;const duration=Date.now()-voiceStarted;voiceStream?.getTracks().forEach(t=>t.stop());voiceStream=null;
  if(voiceDiscard)return;
  const blob=new Blob(chunks,{type:recorder.mimeType}),reader=new FileReader();reader.onload=()=>{if(epoch===voiceEpoch)window.onVoiceEvent({state:'ready',audio:String(reader.result).split(',')[1],mime:blob.type.split(';')[0],duration});};reader.readAsDataURL(blob);
 };
 voiceRecorder.start(250);recordingView();setTimeout(()=>{if(epoch===voiceEpoch&&recorder.state==='recording')recorder.stop();},120000);
}
function stopVoice(){clearInterval(voiceTimer);if(native&&Android.stopVoice)Android.stopVoice();else if(voiceRecorder?.state==='recording')voiceRecorder.stop();}
async function sendVoice(){
 const draft=voiceDraft;if(!draft)return;const button=$('[data-action="send-voice"]');if(button)button.disabled=true;
 try{const r=await api('/chats/'+draft.chat+'/voice','POST',{audio:draft.audio,mime:draft.mime,nonce:draft.nonce});if(S.chatId===draft.chat&&!S.messages.some(m=>m.id===r.message.id))S.messages.push(r.message);closeModal();if(S.chatId===draft.chat)renderMessages(true);refresh();}
 catch(e){const error=$('.voice-error');if(error)error.textContent=e.message;if(button)button.disabled=false;}
}
Object.assign(actions,{'record-voice':startVoice,'stop-voice':stopVoice,'send-voice':sendVoice,'cancel-voice':()=>closeModal()});
document.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button||button.disabled)return;
 try{
  if(button.dataset.messageOptions)messageOptions(Number(button.dataset.messageOptions));
  else if(button.dataset.editMessage)editMessage(Number(button.dataset.editMessage));
  else if(button.dataset.deleteMessage)confirmDelete(Number(button.dataset.deleteMessage));
  else if(button.dataset.confirmDelete){button.disabled=true;const id=Number(button.dataset.confirmDelete),m=S.messages.find(m=>m.id===id);if(!m)return;const r=await api(`/chats/${m.chat_id}/messages/${id}/delete`,'POST',{revision:Number(button.dataset.revision)});closeModal();applyMessageChange(r.message);}
  else if(button.dataset.playMessage)await playMessage(Number(button.dataset.playMessage));
  else if(button.dataset.transcript){const id=Number(button.dataset.transcript);S.transcriptOpen[id]=!S.transcriptOpen[id];renderMessages();}
  else if(button.dataset.retryTranscript){const id=Number(button.dataset.retryTranscript),m=S.messages.find(m=>m.id===id);const r=await api(`/chats/${m.chat_id}/messages/${id}/transcribe`,'POST',{});applyMessageChange(r.message);}
 }catch(e){button.disabled=false;toast(e.message);}
});
document.addEventListener('contextmenu',event=>{const bubble=event.target.closest('[data-message-id]');if(bubble){event.preventDefault();messageOptions(Number(bubble.dataset.messageId));}});
document.addEventListener('submit',async event=>{
 const form=event.target;if(form.id!=='edit-message-form')return;event.preventDefault();const button=$('button[type="submit"]',form);button.disabled=true;
 try{const id=Number(form.dataset.id),m=S.messages.find(m=>m.id===id);const r=await api(`/chats/${m.chat_id}/messages/${id}/edit`,'POST',{body:new FormData(form).get('body'),revision:Number(form.dataset.revision)});closeModal();applyMessageChange(r.message);}catch(e){$('.form-error',form).textContent=e.message;button.disabled=false;}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){window.graffPauseVoice();if(voiceRecorder?.state==='recording'){closeModal();toast('Запись отменена');}}});

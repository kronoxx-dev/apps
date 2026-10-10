'use strict';
let videoSession=null,videoEpoch=0,videoPlayer=null,videoPlayingId=null,videoObserver=null;
const videoPosters=new Map(),videoClips=new Map(),videoPosterLoads=new Set();
function videoBubble(m){const poster=videoPosters.get(m.id);return `<div class="video-note" data-video-note="${m.id}"><button type="button" class="video-disc" data-play-video="${m.id}" aria-label="Смотреть видеосообщение">${poster?`<img src="${poster}" alt="Видеокружок">`:`<span class="video-poster" data-video-poster="${m.id}">${icon('video')}</span>`}<span class="video-play-symbol">${icon('play')}</span></button><div class="video-note-caption"><span>Видеосообщение</span><span>${durationText(m.duration_ms||0)}</span></div></div>`;}
window.pauseVideo=()=>{if(videoPlayer){videoPlayer.pause();videoPlayer.removeAttribute('src');videoPlayer.load();}videoPlayer=null;videoPlayingId=null;document.querySelectorAll('.video-disc.playing').forEach(el=>{el.classList.remove('playing');el.setAttribute('aria-label','Смотреть видеосообщение');});};
window.clearVideoDraft=()=>{videoEpoch++;const state=videoSession;videoSession=null;if(!state)return;clearInterval(state.timer);if(state.recorder?.state==='recording')state.recorder.stop();state.stream?.getTracks().forEach(t=>t.stop());if(state.url)URL.revokeObjectURL(state.url);};
window.clearVideos=()=>{window.pauseVideo();window.clearVideoDraft();videoObserver?.disconnect();for(const cache of [videoPosters,videoClips]){for(const url of cache.values())URL.revokeObjectURL(url);cache.clear();}};
window.videoMessageChanged=m=>{if(!m.deleted_at)return;if(videoPlayingId===m.id)window.pauseVideo();for(const cache of [videoPosters,videoClips]){if(cache.has(m.id))URL.revokeObjectURL(cache.get(m.id));cache.delete(m.id);}};
function cacheVideo(cache,id,encoded,mime,limit){if(cache.size>=limit){const [old,url]=cache.entries().next().value;URL.revokeObjectURL(url);cache.delete(old);}const url=audioUrl(encoded,mime);cache.set(id,url);return url;}
async function videoPoster(id){if(videoPosters.has(id)||videoPosterLoads.has(id))return;const m=S.messages.find(x=>x.id===id&&!x.deleted_at),user=config.user?.id;if(!m)return;videoPosterLoads.add(id);try{const r=await api(`/chats/${m.chat_id}/messages/${id}/video?poster=1`);if(user!==config.user?.id||!S.messages.some(x=>x.id===id&&!x.deleted_at))return;const url=cacheVideo(videoPosters,id,r.video,r.mime,40),el=$(`[data-video-poster="${id}"]`);if(el)el.outerHTML=`<img src="${url}" alt="Видеокружок">`;}catch{}finally{videoPosterLoads.delete(id);}}
window.loadVisibleVideos=()=>{videoObserver?.disconnect();videoObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){videoObserver.unobserve(entry.target);videoPoster(Number(entry.target.dataset.videoPoster));}},{root:$('#messages'),rootMargin:'200px'});document.querySelectorAll('[data-video-poster]').forEach(el=>videoObserver.observe(el));};
window.restoreVideoPlayback=()=>{if(!videoPlayer||!videoPlayingId)return;const disc=$(`[data-play-video="${videoPlayingId}"]`);if(!disc){window.pauseVideo();return;}disc.querySelector('video')?.remove();disc.prepend(videoPlayer);disc.classList.toggle('playing',!videoPlayer.paused);};
async function playVideo(id){
 if(id===videoPlayingId&&videoPlayer){if(videoPlayer.paused){await videoPlayer.play();$(`[data-play-video="${id}"]`)?.classList.add('playing');}else{videoPlayer.pause();$(`[data-play-video="${id}"]`)?.classList.remove('playing');}return;}
 window.graffPauseVoice?.();window.pauseVideo();const m=S.messages.find(x=>x.id===id&&!x.deleted_at),user=config.user?.id;if(!m)return;videoPlayingId=id;
 const button=$(`[data-play-video="${id}"]`);if(button)button.classList.add('loading');
 try{let url=videoClips.get(id);if(!url){const r=await api(`/chats/${m.chat_id}/messages/${id}/video`);if(user!==config.user?.id||S.chatId!==m.chat_id||videoPlayingId!==id||!S.messages.some(x=>x.id===id&&!x.deleted_at))return;url=cacheVideo(videoClips,id,r.video,r.mime,4);}
  videoPlayer=document.createElement('video');videoPlayer.src=url;videoPlayer.poster=videoPosters.get(id)||'';videoPlayer.playsInline=true;videoPlayer.preload='auto';videoPlayer.onended=()=>{$(`[data-play-video="${id}"]`)?.classList.remove('playing');};window.restoreVideoPlayback();await videoPlayer.play();const b=$(`[data-play-video="${id}"]`);b?.classList.add('playing');b?.setAttribute('aria-label','Пауза видеосообщения');
 }catch(e){if(videoPlayingId===id)window.pauseVideo();toast(e.message||'Не удалось открыть видео');}finally{$(`[data-play-video="${id}"]`)?.classList.remove('loading');}
}
function videoError(error){return error?.name==='NotAllowedError'?'Разрешите доступ к камере и микрофону в настройках приложения или браузера.':error?.name==='NotFoundError'?'Камера или микрофон не найдены.':error?.message||'Не удалось включить камеру';}
async function openVideoCamera(facing='user'){
 if(S.demo)return toast('Видеокружки доступны после входа');
 window.graffPauseVoice?.();window.pauseVideo();window.clearVoiceDraft?.();window.clearVideoDraft();window.clearPhotoDraft?.();
 const state={epoch:videoEpoch,chat:S.chatId,user:config.user.id,facing,nonce:crypto.randomUUID()};videoSession=state;
 modal('Видеокружок',`<div class="video-camera-disc"><video id="video-camera" autoplay muted playsinline></video><span class="video-camera-wait">Включаем камеру…</span></div><p class="video-hint">До 60 секунд · звук включён</p><div class="form-error video-error" role="alert"></div><div class="video-actions"><button class="secondary" data-action="flip-video" disabled aria-label="Переключить камеру">${icon('flip')} Камера</button><button class="primary" data-action="start-video" disabled><span class="record-dot"></span> Записать</button></div><button class="text-btn" data-action="close-modal">Отмена</button>`);
 try{
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Обновите Graff или откройте приложение в современном браузере');
  state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}},audio:{echoCancellation:true,noiseSuppression:true}});
  if(videoSession!==state){state.stream.getTracks().forEach(t=>t.stop());return;}
  const preview=$('#video-camera');preview.srcObject=state.stream;preview.classList.toggle('mirrored',facing==='user');await preview.play();$('.video-camera-wait')?.remove();document.querySelectorAll('.video-actions button').forEach(b=>b.disabled=false);
 }catch(e){if(videoSession!==state)return;state.stream?.getTracks().forEach(t=>t.stop());$('.video-camera-wait')?.remove();$('.video-error').textContent=videoError(e);}
}
function startVideoRecording(){
 const state=videoSession;if(!state?.stream||state.recorder)return;
 const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));if(!mime)return toast('Запись видео не поддерживается на этом устройстве');
 try{
  state.recorder=new MediaRecorder(state.stream,{mimeType:mime,videoBitsPerSecond:650000,audioBitsPerSecond:64000});state.parts=[];state.bytes=0;
  state.recorder.ondataavailable=e=>{if(e.data.size){state.parts.push(e.data);state.bytes+=e.data.size;if(state.bytes>8*1024*1024&&state.recorder.state==='recording')state.recorder.stop();}};
  state.recorder.onerror=()=>{if(videoSession===state){closeModal();toast('Запись прервана. Попробуйте ещё раз.');}};
  state.recorder.onstop=()=>finishVideoRecording(state);
  state.recorder.start(500);state.started=Date.now();$('.video-actions').innerHTML='<button class="primary" data-action="stop-video"><span class="stop-square"></span> Остановить</button>';
  $('.video-hint').innerHTML='<span class="recording-light"></span> <strong id="video-record-time">0:00</strong> / 1:00';
  state.timer=setInterval(()=>{if(videoSession!==state)return;const ms=Date.now()-state.started;const el=$('#video-record-time');if(el)el.textContent=durationText(ms);if(ms>=60000)stopVideoRecording();},200);
 }catch(e){state.recorder=null;toast(videoError(e));}
}
function stopVideoRecording(){const state=videoSession;if(!state)return;clearInterval(state.timer);if(state.recorder?.state==='recording')state.recorder.stop();}
async function finishVideoRecording(state){
 clearInterval(state.timer);state.stream?.getTracks().forEach(t=>t.stop());if(videoSession!==state)return;
 const duration=Date.now()-state.started;if(duration<650){closeModal();toast('Запишите хотя бы одну секунду');return;}if(state.bytes>8*1024*1024){closeModal();toast('Запись получилась слишком большой. Попробуйте покороче.');return;}
 state.blob=new Blob(state.parts,{type:state.recorder.mimeType});state.parts=[];state.url=URL.createObjectURL(state.blob);
 modal('Отправить кружок',`<div class="video-camera-disc video-preview-disc"><video src="${state.url}" id="video-preview" playsinline loop></video><button class="video-preview-play" data-action="preview-video" aria-label="Посмотреть запись">${icon('play')}</button></div><p class="video-hint">${durationText(Math.min(duration,60000))} · нажмите, чтобы посмотреть со звуком</p><div class="form-error video-error" role="alert"></div><button class="primary" data-action="send-video">Отправить кружок ${icon('send')}</button><button class="text-btn" data-action="retake-video">Перезаписать</button>`);
}
async function sendVideo(){const state=videoSession;if(!state?.blob||state.sending)return;state.sending=true;const button=$('[data-action="send-video"]');button.disabled=true;button.textContent='Отправляем…';try{
 const video=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).slice(String(reader.result).indexOf(';base64,')+8));reader.onerror=reject;reader.readAsDataURL(state.blob);});
 const r=await api(`/chats/${state.chat}/video`,'POST',{video,mime:state.blob.type,nonce:state.nonce});if(state.user!==config.user?.id)return;if(videoSession===state)closeModal();if(S.chatId===state.chat&&!S.messages.some(m=>m.id===r.message.id)){S.messages.push(r.message);renderMessages(true);}refresh();
 }catch(e){if(videoSession===state){$('.video-error').textContent=e.message;button.disabled=false;button.textContent='Повторить отправку';}state.sending=false;}}
Object.assign(actions,{
 'attach-menu':()=>modal('Прикрепить',`<button class="setting" data-action="attach-photo">${icon('image')}<div><strong>Изображение</strong><small>Фото из галереи</small></div></button><button class="setting" data-action="record-video">${icon('video')}<div><strong>Видеокружок</strong><small>Записать видео до 60 секунд</small></div></button>`),
 'record-video':()=>openVideoCamera(),'start-video':startVideoRecording,'stop-video':stopVideoRecording,'send-video':sendVideo,
 'flip-video':()=>openVideoCamera(videoSession?.facing==='user'?'environment':'user'),'retake-video':()=>openVideoCamera(videoSession?.facing||'user'),
 'preview-video':async()=>{const v=$('#video-preview');if(v.paused){await v.play();$('.video-preview-disc').classList.add('playing');}else{v.pause();$('.video-preview-disc').classList.remove('playing');}}
});
document.addEventListener('click',e=>{const b=e.target.closest('[data-play-video]');if(b)playVideo(Number(b.dataset.playVideo));});
window.videoBackground=()=>{window.pauseVideo();if(videoSession?.stream&&videoSession.recorder?.state!=='inactive'){closeModal();toast('Запись отменена при выходе из приложения');}$('#video-preview')?.pause();};
document.addEventListener('visibilitychange',()=>{if(document.hidden)window.videoBackground();});

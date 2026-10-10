'use strict';
const photoCache=new Map(),photoLoads=new Map();let photoObserver=null,photoDraft=null,photoPick=null,photoEpoch=0,viewerUrl=null,viewerMessage=null;
function imageBubble(m){const url=photoCache.get(m.id);return `<button type="button" class="photo-message" data-view-photo="${m.id}" style="aspect-ratio:${m.image_width||4}/${m.image_height||3}" aria-label="Открыть изображение">${url?`<img src="${url}" alt="Изображение в чате" decoding="async">`:`<span data-photo-load="${m.id}">${icon('image')}<small>Загружаем фото…</small></span>`}</button>${m.body?`<div class="bubble-text photo-caption">${esc(m.body)}</div>`:''}`;}
async function loadPhotoThumbnail(id){
 if(photoCache.has(id)||photoLoads.has(id))return;
 const m=S.messages.find(m=>m.id===id&&!m.deleted_at),user=config.user?.id;if(!m)return;
 const loading=api(`/chats/${m.chat_id}/messages/${id}/image?thumbnail=1`);photoLoads.set(id,loading);
 try{const r=await loading;if(config.user?.id!==user||!S.messages.some(m=>m.id===id&&!m.deleted_at))return;
  const url=audioUrl(r.image,'image/jpeg');if(photoCache.size>=40){const [old,value]=photoCache.entries().next().value;URL.revokeObjectURL(value);photoCache.delete(old);}photoCache.set(id,url);
  const button=$(`[data-view-photo="${id}"]`);if(button)button.innerHTML=`<img src="${url}" alt="Изображение в чате" decoding="async">`;
 }catch{const label=$(`[data-photo-load="${id}"] small`);if(label)label.textContent='Нажмите, чтобы открыть';}finally{photoLoads.delete(id);}
}
window.loadVisiblePhotos=()=>{photoObserver?.disconnect();photoObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){photoObserver.unobserve(entry.target);loadPhotoThumbnail(Number(entry.target.dataset.photoLoad));}},{root:$('#messages'),rootMargin:'200px'});document.querySelectorAll('[data-photo-load]').forEach(el=>photoObserver.observe(el));};
window.clearPhotoDraft=()=>{photoEpoch++;photoPick=null;if(photoDraft?.url)URL.revokeObjectURL(photoDraft.url);photoDraft=null;if(viewerUrl)URL.revokeObjectURL(viewerUrl);viewerUrl=null;viewerMessage=null;};
window.clearPhotos=()=>{window.clearPhotoDraft();photoObserver?.disconnect();for(const url of photoCache.values())URL.revokeObjectURL(url);photoCache.clear();};
window.photoMessageChanged=m=>{if(!m.deleted_at)return;if(photoCache.has(m.id)){URL.revokeObjectURL(photoCache.get(m.id));photoCache.delete(m.id);}if(viewerMessage===m.id){closeModal();toast('Изображение удалено');}};
async function viewPhoto(id){
 const m=S.messages.find(m=>m.id===id&&!m.deleted_at);if(!m)return;
 modal('Изображение','<div class="empty"><div class="spinner"></div>Загружаем…</div>');viewerMessage=id;const user=config.user?.id;
 try{const r=await api(`/chats/${m.chat_id}/messages/${id}/image`);if(viewerMessage!==id||config.user?.id!==user)return;
  viewerUrl=audioUrl(r.image,'image/jpeg');$('.modal').classList.add('photo-modal');$('.modal-body').innerHTML=`<div class="photo-viewer"><img src="${viewerUrl}" alt="Изображение из сообщения"></div>${m.body?`<p class="photo-view-caption">${esc(m.body)}</p>`:''}<button class="secondary" data-action="photo-zoom">${icon('search')} Увеличить / уменьшить</button>`;
 }catch(e){if(viewerMessage===id){closeModal();toast(e.message);}}
}
function choosePhoto(){
 if(S.demo)return toast('Изображения доступны после входа');
 window.graffPauseVoice?.();window.clearPhotoDraft();photoPick={chat:S.chatId,user:config.user.id,epoch:photoEpoch};
 if(native){modal('Выбрать изображение','<p>Выберите фото в галерее телефона.</p>');if(Android.pickImage)Android.pickImage();else{closeModal();toast('Обновите APK для отправки изображений');}return;}
 const input=$('#photo-file-input');input.value='';input.click();
}
window.onImagePicked=result=>{
 const pick=photoPick;if(!pick||pick.user!==config.user?.id||pick.chat!==S.chatId)return;
 if(result.error){closeModal();if(!result.error.includes('отменён'))toast(result.error);return;}
 photoDraft={...result,...pick,nonce:crypto.randomUUID()};photoDraft.url=audioUrl(result.image,'image/jpeg');
 modal('Отправить изображение',`<img class="photo-preview" src="${photoDraft.url}" alt="Предпросмотр изображения"><label class="field photo-caption-field">Подпись<textarea id="photo-caption" rows="2" maxlength="4000" placeholder="Добавить подпись…"></textarea></label><div class="form-error photo-error" role="alert"></div><button class="primary" data-action="send-photo">Отправить фото ${icon('send')}</button><button class="text-btn" data-action="close-modal">Отмена</button>`);
};
async function prepareBrowserPhoto(file){
 const pick=photoPick;if(!pick||!file)return;if(!file.type.startsWith('image/')||file.size>32*1024*1024){photoPick=null;return toast('Выберите изображение до 32 МБ');}
 modal('Подготовка изображения','<div class="empty"><div class="spinner"></div>Готовим фото…</div>');
 const url=URL.createObjectURL(file);try{
  const img=new Image();img.src=url;await img.decode();const ratio=Math.min(1,1920/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  let data;for(const q of [.88,.78,.68,.58,.48]){data=canvas.toDataURL('image/jpeg',q);if(data.length<2796200)break;}if(data.length>=2796200)throw new Error('Выберите изображение поменьше');
  if(photoPick===pick)window.onImagePicked({image:data.split(',')[1],width:canvas.width,height:canvas.height});
 }catch{if(photoPick===pick){closeModal();toast('Не удалось открыть изображение. Попробуйте JPG, PNG или WebP.');}}finally{URL.revokeObjectURL(url);}
}
async function sendPhoto(){
 const draft=photoDraft;if(!draft)return;const button=$('[data-action="send-photo"]');if(button.disabled)return;button.disabled=true;const caption=$('#photo-caption').value.trim();
 try{const r=await api(`/chats/${draft.chat}/image`,'POST',{image:draft.image,body:caption,nonce:draft.nonce});if(config.user?.id!==draft.user)return;
  if(photoDraft===draft)closeModal();if(S.chatId===draft.chat&&!S.messages.some(m=>m.id===r.message.id)){S.messages.push(r.message);renderMessages(true);}refresh();
 }catch(e){const error=$('.photo-error');if(error)error.textContent=e.message;button.disabled=false;}
}
Object.assign(actions,{'attach-photo':choosePhoto,'send-photo':sendPhoto,'photo-zoom':()=>$('.photo-viewer')?.classList.toggle('zoomed')});
document.addEventListener('change',e=>{if(e.target.id==='photo-file-input')prepareBrowserPhoto(e.target.files[0]);});
document.addEventListener('click',e=>{const b=e.target.closest('[data-view-photo]');if(b)viewPhoto(Number(b.dataset.viewPhoto));});

const emojiGroups={
 'Частые':'❤️ 😂 🥰 👍 🔥 😍 😘 😊 🙏 💚 🎉 🤗 😎 😁 🫶 👋',
 'Лица':'😀 😃 😄 😁 😆 😅 😂 🤣 😊 🙂 🙃 😉 😌 😍 🥰 😘 😋 😛 🤪 😎 🤩 🥳 😏 😔 😢 😭 🥺 😤 😡 🤯 😱 😴 🤔 🤫 🤭 🫠 🥹',
 'Жесты':'👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👋 🤚 👏 🙌 👐 🤲 🙏 💪 🤝 🫶 ✊ 👊 ☝️ 👆 👇 👉 👈',
 'Любовь':'❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 🩶 💔 ❤️‍🔥 💕 💞 💓 💗 💖 💘 💝 💌 💋 🫂 👨‍👩‍👦',
 'Дом':'🏠 🏡 👨‍👩‍👦 👪 🐈 🐱 🐶 🐾 🌷 🌹 🌻 🌸 🌿 🌳 ☀️ 🌤️ 🌧️ ❄️ 🌈 🌙 ⭐ ✨ 🔥 💧',
 'Еда':'🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🥑 🥦 🥕 🍞 🥐 🧀 🍳 🥞 🍗 🥩 🍔 🍟 🍕 🌮 🍣 🍜 🍝 🥗 🍰 🎂 🍦 🍫 ☕ 🍵 🥤 🧃',
 'Планы':'🎉 🎊 🎁 🎈 🎂 🥳 🎵 🎶 🎧 🎬 🎮 ⚽ 🏀 🏆 🚗 🚕 🚌 🚆 ✈️ 🚀 🏖️ 🏕️ ⛰️ 🏃 🚴 🛍️ 📷 📍 📅 ⏰ ✅ ❌ ❗ ❓ 💯'
};
let emojiCategory='Частые',emojiSelection=[0,0],emojiRecent=[];
try{const recent=JSON.parse(localStorage.getItem('graff.emoji-recent')||'[]');if(Array.isArray(recent))emojiRecent=recent.filter(v=>typeof v==='string'&&v.length<=20).slice(0,24);}catch{}
function renderEmoji(){const panel=$('#emoji-panel');if(!panel)return;const list=emojiCategory==='Частые'?[...new Set([...emojiRecent,...emojiGroups['Частые'].split(' ')])]:emojiGroups[emojiCategory].split(' ');panel.innerHTML=`<div class="emoji-tabs" role="group" aria-label="Категории эмодзи">${Object.keys(emojiGroups).map(k=>`<button type="button" data-emoji-category="${k}" class="${k===emojiCategory?'active':''}">${k}</button>`).join('')}<button type="button" data-action="emoji-toggle" aria-label="Закрыть эмодзи">${icon('close')}</button></div><div class="emoji-grid">${list.map(e=>`<button type="button" data-emoji="${esc(e)}" aria-label="Вставить ${esc(e)}">${esc(e)}</button>`).join('')}</div>`;}
actions['emoji-toggle']=()=>{const panel=$('#emoji-panel'),input=$('#message-input');if(!panel||!input)return;if(panel.hidden){emojiSelection=[input.selectionStart,input.selectionEnd];input.blur();panel.hidden=false;renderEmoji();$('#emoji-toggle').setAttribute('aria-expanded','true');}else{panel.hidden=true;$('#emoji-toggle').setAttribute('aria-expanded','false');}};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.emojiCategory){emojiCategory=b.dataset.emojiCategory;renderEmoji();}if(b.dataset.emoji){const input=$('#message-input');if(!input)return;const value=b.dataset.emoji,[start,end]=emojiSelection;if(input.value.length-(end-start)+value.length>4000)return toast('Сообщение слишком длинное');input.setRangeText(value,start,end,'end');emojiSelection=[input.selectionStart,input.selectionEnd];input.dispatchEvent(new Event('input',{bubbles:true}));emojiRecent=[value,...emojiRecent.filter(e=>e!==value)].slice(0,24);try{localStorage.setItem('graff.emoji-recent',JSON.stringify(emojiRecent));}catch{}}});
document.addEventListener('focusin',e=>{if(e.target.id==='message-input'&&$('#emoji-panel')){$('#emoji-panel').hidden=true;$('#emoji-toggle').setAttribute('aria-expanded','false');}});

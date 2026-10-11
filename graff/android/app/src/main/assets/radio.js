'use strict';
let radioSelected='online',radioPointer=null,radioHolding=false,radioUiKey='';
function radioAvailable(){return native&&typeof Android.radioStart==='function'&&!S.demo;}
function radioSnapshot(){try{return radioAvailable()?JSON.parse(Android.radioStatus()):{active:false};}catch{return {active:false};}}
function radioPage(){
 S.route='radio';S.tab='radio';S.epoch++;window.graffPauseVoice?.();window.pauseVideo?.();radioUiKey='';
 screen(`${demoBar()}<header class="header"><div class="header-main"><div class="eyebrow">Живой голос</div><h1>Рация<span class="accent">.</span></h1></div><span class="radio-header-icon">${icon('radio')}</span></header><div class="page-content grow radio-page"><div class="radio-mode" role="group" aria-label="Режим рации"><button data-action="radio-online" class="${radioSelected==='online'?'selected':''}">${icon('server')} Онлайн</button><button data-action="radio-nearby" class="${radioSelected==='nearby'?'selected':''}">${icon('radio')} Рядом</button></div><div id="radio-content"></div></div>${nav()}`,'radio-screen');
 drawRadio();
}
function drawRadio(){
 if(S.route!=='radio')return;const r=radioSnapshot(),key=JSON.stringify([r.active,r.mode,radioSelected]);
 if(key!==radioUiKey){radioUiKey=key;$('#radio-content').innerHTML=r.active?`
 <div class="radio-channel"><span class="radio-live-dot"></span>${r.mode==='online'?'Семейный канал · онлайн':'Локальный канал · Wi-Fi'}</div>
 <div id="radio-people" class="radio-people"></div><div class="radio-stage"><div class="radio-ring ring-outer"></div><div class="radio-ring ring-inner"></div><button id="radio-ptt" class="radio-ptt" aria-label="Удерживайте, чтобы говорить" aria-pressed="false">${icon('mic')}<span>Нажмите<br>и держите</span></button></div>
 <h2 id="radio-speaking" class="radio-speaking" aria-live="polite"></h2><p class="radio-caption">Говорит один участник · до 30 секунд</p><p id="radio-error" class="radio-error" role="status"></p><div class="radio-controls"><div id="radio-codes"></div><button class="secondary radio-exit" data-action="radio-leave">Выйти из канала</button></div><p class="radio-footnote">Слушайте с выключенным экраном · сеанс до 2 ч</p>`:
 `<div class="radio-idle-art">${icon('radio')}<span></span><span></span></div><h2 class="radio-speaking">${radioSelected==='online'?'Слышать своих':'Рядом, даже без интернета'}</h2><p class="radio-intro">${radioSelected==='online'?'Подключитесь всей семьёй. Удерживайте кнопку и говорите — остальные сразу услышат.':'Подключите телефоны к одной Wi-Fi-сети или точке доступа. На одном создайте канал, на остальных введите его код.'}</p>${!radioAvailable()?'<div class="info-box">Рация доступна в Android-приложении Graff 0.7.1. Установите обновление на телефоны участников.</div>':radioSelected==='online'?'<button class="primary" data-action="radio-connect">Подключиться к рации</button>':'<button class="primary" data-action="radio-host">Создать канал рядом</button><button class="secondary" data-action="radio-join-dialog">Подключиться по коду</button>'}<p id="radio-error" class="radio-error" role="status"></p><p class="radio-footnote">${radioSelected==='online'?'Микрофон включается только при удержании кнопки.':'Создатель канала должен оставаться подключённым. Интернет и сервер для этого режима не нужны.'}</p>`;
 }
 $('#radio-error').textContent=r.error||'';
 document.querySelectorAll('.radio-mode button').forEach(b=>{b.disabled=!!r.active;b.classList.toggle('selected',r.active?(r.mode==='online'?b.dataset.action==='radio-online':b.dataset.action==='radio-nearby'):(radioSelected==='online'?b.dataset.action==='radio-online':b.dataset.action==='radio-nearby'));});
 if(!r.active)return;
 const peers=r.peers||[],peopleKey=JSON.stringify(peers);if($('#radio-people').dataset.key!==peopleKey){$('#radio-people').dataset.key=peopleKey;$('#radio-people').innerHTML=peers.length?peers.map(p=>`<div class="radio-person" data-client="${esc(p.client)}">${(['artur','adel','rezeda'].includes(p.login)?`<div class="avatar portrait"><img src="avatars/${p.login}.png" alt=""></div>`:avatar(p.name,p.id,'medium'))}<span>${esc(p.name.split(' ')[0])}</span></div>`).join(''):'<p>Подключаемся к каналу…</p>';}
 const speaker=r.speaker;
 document.querySelectorAll('.radio-person').forEach(el=>el.classList.toggle('speaking',el.dataset.client===speaker?.client));
 const ptt=$('#radio-ptt');ptt.classList.toggle('transmitting',!!r.talking);ptt.classList.toggle('waiting',!!r.claiming);ptt.setAttribute('aria-pressed',String(!!r.talking));
 ptt.disabled=!r.connected||!!(speaker&&speaker.client!==r.client&&!r.talking);
 ptt.querySelector('span').innerHTML=r.talking?'Вы в эфире':r.claiming?'Подключаем<br>микрофон':!r.connected?'Подключаемся':speaker&&speaker.client!==r.client?'Слушаем':'Нажмите<br>и держите';
 $('#radio-speaking').textContent=r.talking?'Вас слышат близкие':speaker?'Говорит '+speaker.name.split(' ')[0]:r.connected?'Канал свободен':'Устанавливаем связь';
 const codes=r.codes||[],codesKey=JSON.stringify(codes);if($('#radio-codes').dataset.key!==codesKey){$('#radio-codes').dataset.key=codesKey;$('#radio-codes').innerHTML=codes.length?'<button class="secondary" data-action="radio-invite">Пригласить</button>':'';}

}
function startRadio(mode,code=''){if(!radioAvailable())return;window.graffPauseVoice?.();window.pauseVideo?.();Android.radioStart(mode,code);setTimeout(drawRadio,150);}
actions['radio-online']=()=>{radioSelected='online';radioPage();};actions['radio-nearby']=()=>{radioSelected='nearby';radioPage();};
actions['radio-connect']=()=>startRadio('online');actions['radio-host']=()=>startRadio('host');actions['radio-join']=()=>{const code=$('#radio-code').value.trim();if(!/^graff1\|[0-9.]+\|\d+\|[\w-]{43}$/.test(code))return toast('Вставьте полный код с телефона, создавшего канал');closeModal();startRadio('join',code);};
actions['radio-join-dialog']=()=>modal('Подключиться рядом','<div class="radio-pair"><p>Подключитесь к той же Wi-Fi-сети и вставьте код с телефона близкого.</p><label class="field">Код канала<textarea id="radio-code" rows="3" placeholder="graff1|…" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></label><button class="primary" data-action="radio-join">Подключиться</button></div>');
actions['radio-invite']=()=>{const codes=radioSnapshot().codes||[];if(!codes.length)return;releaseRadio();modal('Пригласить в рацию',`<div class="radio-pair"><p>Передайте код близким через Quick Share, Bluetooth или скопируйте. Нужна общая Wi-Fi-сеть.</p>${codes.length>1?`<label class="field">Адрес подключения<select id="radio-address">${codes.map((c,i)=>`<option value="${i}">${esc(c.split('|')[1])}</option>`).join('')}</select></label>`:''}<label class="field">Код канала<textarea id="radio-invite-code" readonly rows="3">${esc(codes[0])}</textarea></label><div class="radio-pair-actions"><button class="secondary" id="radio-copy-code" data-radio-copy="0">${icon('copy')} Скопировать</button><button class="secondary" id="radio-share-code" data-radio-share="0">Передать</button></div></div>`);};
document.addEventListener('change',e=>{if(e.target.id!=='radio-address')return;const index=Number(e.target.value),code=radioSnapshot().codes?.[index];if(!code)return;$('#radio-invite-code').value=code;$('#radio-copy-code').dataset.radioCopy=String(index);$('#radio-share-code').dataset.radioShare=String(index);});
actions['radio-leave']=()=>{releaseRadio();Android.radioStop();setTimeout(drawRadio,150);};
window.releaseRadio=function(){radioHolding=false;radioPointer=null;if(radioAvailable())Android.radioTalk(false);};
document.addEventListener('pointerdown',e=>{const b=e.target.closest('#radio-ptt');if(!b||b.disabled||e.button!==0||!radioAvailable())return;e.preventDefault();radioPointer=e.pointerId;radioHolding=true;b.setPointerCapture(e.pointerId);Android.radioTalk(true);});
document.addEventListener('pointerup',e=>{if(e.pointerId===radioPointer)releaseRadio();});document.addEventListener('pointercancel',e=>{if(e.pointerId===radioPointer)releaseRadio();});
document.addEventListener('lostpointercapture',e=>{if(e.pointerId===radioPointer)releaseRadio();});
document.addEventListener('contextmenu',e=>{if(e.target.closest('#radio-ptt'))e.preventDefault();});
document.addEventListener('keydown',e=>{if(e.target.id==='radio-ptt'&&[' ','Enter'].includes(e.key)&&!e.repeat&&!e.target.disabled){e.preventDefault();radioHolding=true;Android.radioTalk(true);}});
document.addEventListener('keyup',e=>{if(radioHolding&&[' ','Enter'].includes(e.key)){e.preventDefault();releaseRadio();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseRadio();});window.addEventListener('blur',releaseRadio);
document.addEventListener('click',e=>{const share=e.target.closest('[data-radio-share]');if(share){const code=radioSnapshot().codes?.[Number(share.dataset.radioShare)];if(code&&native&&Android.radioShare)Android.radioShare(code);return;}const b=e.target.closest('[data-radio-copy]');if(b){const code=radioSnapshot().codes?.[Number(b.dataset.radioCopy)];if(code){if(native)Android.copy(code);toast('Код канала скопирован');}}});
setInterval(()=>{if(native&&config.user&&Android.consumeRadio?.())radioPage();if(S.route==='radio')drawRadio();},250);

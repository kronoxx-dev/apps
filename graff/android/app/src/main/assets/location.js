'use strict';
icons.location='<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>';
icons.target='<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>';
let familyMap=null,mapLayer=null,mapTimer=null,mapLoading=false,mapGeneration=0,mapFitted=false,mapMembers=[],watchId=null,webShare=null,webSending=false,webEpoch=0,lastWebSend=0;
window.clearLocationMap=()=>{mapGeneration++;clearInterval(mapTimer);mapTimer=null;if(familyMap)familyMap.remove();familyMap=null;mapLayer=null;mapLoading=false;};
function myLocationState(){if(native&&Android.locationStatus){try{return JSON.parse(Android.locationStatus());}catch{}}return {active:watchId!==null,error:''};}
function freshness(loc){if(!loc)return 'Локация пока не передаётся';const age=Math.max(0,Date.now()-loc.recorded);return age<90000?'Только что':age<3600000?Math.floor(age/60000)+' мин назад':Math.floor(age/3600000)+' ч назад';}
function paintLocation(){
 if(S.route!=='location'||!familyMap)return;
 const state=myLocationState(),enabled=state.active;
 $('#location-share').textContent=enabled?'Остановить передачу':'Поделиться локацией';$('#location-share').dataset.action=enabled?'location-stop':'location-consent';
 $('#location-status').textContent=state.error||(enabled?(native?'Вы видны семье · обновляем в фоне':'Вы видны семье · пока открыта страница'):S.demo?'Деморежим · реальные координаты не используются':'Ваше место видно только после разрешения');
 $('#location-people').innerHTML=mapMembers.map(u=>`<button class="location-person ${u.location?'has-location':''}" data-location-person="${esc(u.id)}" aria-label="${esc(u.name)}, ${esc(freshness(u.location))}">${avatar(u.name,u.id,'small')}<strong>${esc(u.name.split(' ')[0])}${u.id===config.user.id?' · вы':''}</strong><small>${u.location?esc(freshness(u.location)):u.sharing?'Ищем GPS…':'Не делится'}</small></button>`).join('');
 mapLayer.clearLayers();const points=[];
 const groups=[];
 for(const u of mapMembers){if(!u.location)continue;const p=u.location;points.push([p.lat,p.lon]);
  const point=familyMap.latLngToContainerPoint([p.lat,p.lon]);let group=groups.find(g=>g.point.distanceTo(point)<46);
  if(!group){group={point,lat:p.lat,lon:p.lon,users:[]};groups.push(group);}group.users.push(u);
  L.circle([p.lat,p.lon],{radius:Math.max(5,Math.min(p.accuracy,5000)),color:'#31ee88',weight:1,fillOpacity:.08,interactive:false}).addTo(mapLayer);
 }
 for(const g of groups){const width=52*g.users.length;
  L.marker([g.lat,g.lon],{icon:L.divIcon({className:'family-map-marker',html:'<div class="map-avatar-group">'+g.users.map(u=>`<div class="map-avatar-person ${Date.now()-u.location.recorded>300000?'stale':''}">${avatar(u.name,u.id,'small')}<span>${esc(u.name.split(' ')[0])}</span></div>`).join('')+'</div>',iconSize:[width,70],iconAnchor:[width/2,26]}),title:g.users.map(u=>u.name).join(', ')}).addTo(mapLayer).bindPopup(g.users.map(u=>`<strong>${esc(u.name)}</strong><br>${esc(freshness(u.location))} · ±${Math.round(u.location.accuracy)} м`).join('<br>'));
 }
 $('#map-empty').hidden=points.length>0;
 if(points.length&&!mapFitted){mapFitted=true;familyMap.fitBounds(L.latLngBounds(points).pad(.3),{maxZoom:15,padding:[48,48]});}
}
async function loadLocations(){
 if(S.route!=='location'||mapLoading)return;mapLoading=true;const generation=mapGeneration;
 try{const result=S.demo?{members:S.users.map(u=>({...u,sharing:false,location:null}))}:await api('/locations');if(generation!==mapGeneration)return;mapMembers=result.members;S.users=result.members;paintLocation();}
 catch(e){if(generation===mapGeneration&&$('#location-status'))$('#location-status').textContent='Не удалось обновить карту. '+e.message;}
 finally{if(generation===mapGeneration)mapLoading=false;}
}
function locationPage(){
 S.route='location';S.tab='location';S.chatId=null;S.epoch++;
 screen(`${demoBar()}<header class="header location-header"><div><div class="eyebrow">Семья на карте</div><h1>Локация<span class="accent">.</span></h1></div><button class="icon-btn" data-action="location-fit" aria-label="Показать всех на карте">${icon('target')}</button></header><div class="location-map-wrap"><div id="family-map" aria-label="Карта местоположения семьи"></div><div id="map-empty"><span>${icon('location')}</span><strong>Пока без координат</strong><p>Когда близкие включат передачу,<br>их аватарки появятся на карте.</p></div><div id="map-network" hidden>Карта не загрузилась. Проверьте интернет.</div></div><div class="location-panel"><div id="location-people" class="location-people"><div class="spinner"></div></div><p id="location-status" role="status">Загружаем участников…</p><button id="location-share" class="primary" data-action="location-consent">Поделиться локацией</button></div>${nav()}`,'location-screen');
 mapFitted=false;familyMap=L.map('family-map',{zoomControl:false,attributionControl:true}).setView([22,0],2);mapLayer=L.layerGroup().addTo(familyMap);
 familyMap.attributionControl.setPrefix(false);
 L.control.zoom({position:'topright'}).addTo(familyMap);
 const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(familyMap);
 tiles.on('tileerror',()=>{if($('#map-network'))$('#map-network').hidden=false;});tiles.on('load',()=>{if($('#map-network')&&document.querySelector('#family-map .leaflet-tile-loaded'))$('#map-network').hidden=true;});
 familyMap.on('zoomend',()=>{if(mapFitted)paintLocation();});
 loadLocations();mapTimer=setInterval(loadLocations,10000);
}
function locationConsent(){
 if(S.demo)return toast('Передача локации доступна после входа');
 modal('Быть на семейной карте',`<p>Все участники семьи увидят ваше текущее место и время обновления. ${native?'Передача продолжится в фоне, пока вы её не остановите. На телефоне будет постоянное уведомление.':'В браузере координаты обновляются, пока страница открыта и активна.'}</p><div class="info-box">Храним только последнюю точку, без истории маршрутов. Остановить передачу можно в любой момент; точка исчезнет с карты после связи с сервером.</div><button class="primary" data-action="location-start">Разрешить и включить</button>`);
}
async function startLocation(){
 closeModal();if(native){if(Android.startLocation)Android.startLocation();else toast('Установите свежую APK для геолокации');return;}
 if(!navigator.geolocation)return toast('Геолокация недоступна в этом браузере');
 const epoch=++webEpoch;lastWebSend=0;
 watchId=navigator.geolocation.watchPosition(async position=>{
  if(epoch!==webEpoch||webSending||Date.now()-lastWebSend<15000)return;webSending=true;
  try{
   if(!webShare){const share=await api('/location/share','POST',{enabled:true});if(epoch!==webEpoch){await api('/location/share','POST',{enabled:false,shareId:share.shareId});return;}webShare=share.shareId;}
   await api('/location/update','POST',{shareId:webShare,lat:position.coords.latitude,lon:position.coords.longitude,accuracy:position.coords.accuracy,recorded:position.timestamp});lastWebSend=Date.now();loadLocations();
  }catch(e){toast(e.message);}finally{webSending=false;}
 },e=>{toast(e.code===1?'Разрешите геолокацию в настройках браузера':'Не удалось определить место. Проверьте GPS.');if(e.code===1)stopLocation();},{enableHighAccuracy:true,maximumAge:30000,timeout:20000});paintLocation();
}
async function stopLocation(){
 webEpoch++;if(watchId!==null)navigator.geolocation.clearWatch(watchId);watchId=null;webShare=null;
 if(native&&Android.stopLocation)Android.stopLocation();
 try{await api('/location/share','POST',{enabled:false});toast('Передача остановлена. Вы скрыты с карты.');}catch(e){toast('Передача остановлена на телефоне. Последняя точка исчезнет после связи с сервером.');}loadLocations();
}
window.onLocationPermission=error=>{if(error)toast(error);else toast('Передача включена. Определяем ваше место…');setTimeout(loadLocations,800);};
window.stopLocationOnLogout=()=>{webEpoch++;if(watchId!==null)navigator.geolocation.clearWatch(watchId);watchId=null;webShare=null;if(native&&Android.stopLocation)Android.stopLocation();};
Object.assign(actions,{'location-consent':locationConsent,'location-start':startLocation,'location-stop':stopLocation,'location-fit':()=>{mapFitted=false;loadLocations();}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-location-person]');if(!b)return;const u=mapMembers.find(u=>u.id===b.dataset.locationPerson);if(u?.location)familyMap.setView([u.location.lat,u.location.lon],16,{animate:true});else toast('Участник ещё не передаёт местоположение');});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.route==='location')loadLocations();});

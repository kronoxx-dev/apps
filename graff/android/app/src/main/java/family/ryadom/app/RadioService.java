package family.ryadom.app;

import android.app.*;
import android.content.*;
import android.media.*;
import android.net.wifi.WifiManager;
import android.os.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** User-joined, foreground, half-duplex audio. Microphone opens only while PTT is held. */
public class RadioService extends Service {
 static volatile RadioService instance;
 static volatile String lastError="";
 private volatile boolean running,connected,held,talking,claiming;
 private volatile String error="",mode="online";
 private volatile JSONObject room=new JSONObject();
 private final ExecutorService poller=Executors.newSingleThreadExecutor(),sender=Executors.newSingleThreadExecutor(),player=Executors.newSingleThreadExecutor();
 private final ArrayBlockingQueue<byte[]> playback=new ArrayBlockingQueue<>(12);
 private volatile int sentFrames,receivedFrames,micLevel;
 private volatile long networkMs;
 private final Handler main=new Handler(Looper.getMainLooper());
 private final String client=UUID.randomUUID().toString();
 private String token,base,code="";
 private JSONObject user;
 private RadioLan host;
 private AudioTrack track;
 private volatile AudioRecord liveRecorder;
 private PowerManager.WakeLock wake;
 private WifiManager.WifiLock wifi;
 private AudioManager audio;
 private AudioFocusRequest focus;
 private long cursor;
 static boolean active(){RadioService s=instance;return s!=null&&s.running;}
 static String status(){RadioService s=instance;if(s==null)return "{\"active\":false,\"error\":"+JSONObject.quote(lastError)+"}";return s.snapshot().toString();}
 private JSONObject snapshot(){try{return new JSONObject().put("active",running).put("connected",connected).put("talking",talking).put("claiming",claiming).put("mode",mode).put("error",error).put("client",client).put("sent",sentFrames).put("received",receivedFrames).put("micLevel",micLevel).put("networkMs",networkMs).put("muted",audio!=null&&audio.getStreamVolume(AudioManager.STREAM_MUSIC)==0).put("peers",room.optJSONArray("peers")).put("speaker",room.opt("speaker")).put("codes",host==null?new JSONArray():host.codes);}catch(Exception e){return new JSONObject();}}
 @Override public IBinder onBind(Intent i){return null;}
 @Override public int onStartCommand(Intent intent,int flags,int id){
  if(intent==null||"STOP".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
  if(running)return START_NOT_STICKY;
  try{
   JSONObject session=new JSONObject(SessionStore.load(this));token=session.optString("token");base=session.optString("base");user=session.getJSONObject("user");if(token.isEmpty())throw new IOException("Сначала войдите в Graff");
   mode=intent.getStringExtra("mode");if(!Arrays.asList("online","host","join").contains(mode))throw new IOException("Неверный режим");code=intent.getStringExtra("code");if(code==null)code="";
   NotificationManager nm=getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("graff_radio","Семейная рация",NotificationManager.IMPORTANCE_LOW));
   PendingIntent open=PendingIntent.getActivity(this,60,new Intent(this,MainActivity.class).setAction("GRAFF_RADIO"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
   PendingIntent stop=PendingIntent.getService(this,61,new Intent(this,RadioService.class).setAction("STOP"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
   startForeground(60,new Notification.Builder(this,"graff_radio").setSmallIcon(R.drawable.ic_notification).setColor(0xff21eb88).setContentTitle("Graff · семейная рация").setContentText("Вы слушаете канал. Микрофон — только при нажатии.").setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null,"Выйти из канала",stop).build()).build());
   running=true;instance=this;lastError="";
   wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Graff:Radio");wake.acquire(2*60*60*1000L);
   wifi=((WifiManager)getApplicationContext().getSystemService(Context.WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF,"Graff:Radio");wifi.acquire();
   main.postDelayed(()->{lastError="Сеанс завершён через 2 часа. Можно подключиться снова.";stopSelf();},2*60*60*1000L);
   audio=getSystemService(AudioManager.class);
   AudioAttributes attributes=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
   focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).setOnAudioFocusChangeListener(change->{if(change<0){lastError="Рация отключена на время звонка или другого аудио.";stopSelf();}},main).build();
   if(audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED)throw new IOException("Звук сейчас занят другим приложением");
   track=new AudioTrack.Builder().setAudioAttributes(attributes).setAudioFormat(new AudioFormat.Builder().setSampleRate(16000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build()).setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(Math.max(16000,AudioTrack.getMinBufferSize(16000,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_16BIT))).build();track.play();
   player.execute(()->playAudio());poller.execute(()->listen());
  }catch(Exception e){lastError=e.getMessage()==null?"Не удалось включить рацию":e.getMessage();stopSelf();}
  return START_NOT_STICKY;
 }
 private JSONObject request(String op,JSONObject b)throws Exception{
  long requestStarted=SystemClock.elapsedRealtime();b.put("client",client).put("protocol",2);JSONObject result;
  if(host!=null)result=host.handle(op,b,user);
  else if(!mode.equals("online"))result=RadioLan.request(this,code,op,b,user);
  else{
   URL origin=new URL(base);if(origin.getUserInfo()!=null||origin.getQuery()!=null||origin.getRef()!=null||!origin.getPath().matches("(/[a-zA-Z0-9_-]+)*/?"))throw new IOException("Неверный адрес сервера");
   if(!origin.getProtocol().equals("https")){if(!origin.getProtocol().equals("http")||!(origin.getHost().equals("localhost")||origin.getHost().matches("[0-9.]+")))throw new IOException("Нужен HTTPS");InetAddress a=InetAddress.getByName(origin.getHost());if(!a.isLoopbackAddress()&&!a.isSiteLocalAddress())throw new IOException("Нужен HTTPS");}
   HttpURLConnection c=(HttpURLConnection)new URL(base.replaceAll("/$","")+"/api/radio/"+op).openConnection();
   boolean consumed=false;
   try{c.setConnectTimeout(8000);c.setReadTimeout(8000);c.setRequestMethod("POST");c.setInstanceFollowRedirects(false);c.setRequestProperty("Authorization","Bearer "+token);c.setRequestProperty("Content-Type","application/json");c.setDoOutput(true);byte[] bytes=b.toString().getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}int status=c.getResponseCode();
    if(status==401||status==403){lastError="Войдите в Graff заново для подключения к рации";main.post(()->stopSelf());}
    InputStream stream=status<400?c.getInputStream():c.getErrorStream();if(stream==null)throw new IOException("Сервер недоступен");try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){out.write(buffer,0,n);if(out.size()>300000)throw new IOException("Неверный ответ");}result=new JSONObject(out.toString("UTF-8"));consumed=true;}
   // Fully consumed responses return the socket to Android's keep-alive pool.
   }finally{if(!consumed)c.disconnect();}
  }
  networkMs=SystemClock.elapsedRealtime()-requestStarted;if(result.has("error"))throw new IOException(result.optString("error"));return result;
 }
 private void listen(){
  try{
   if(mode.equals("host")){host=new RadioLan();}
   while(running){
    long start=SystemClock.elapsedRealtime();
    try{
     JSONObject session=new JSONObject(SessionStore.load(this));if(!token.equals(session.optString("token"))||!base.equals(session.optString("base"))){main.post(()->stopSelf());break;}
     if(!connected){room=request("join",new JSONObject());cursor=room.getLong("cursor");connected=true;error="";}
     JSONObject next=request("poll",new JSONObject().put("after",cursor));cursor=next.getLong("cursor");room=next;
     JSONArray frames=next.getJSONArray("frames");if(!talking&&!held)for(int i=0;i<frames.length()&&running;i++){
      byte[] pcm=Base64.decode(frames.getJSONObject(i).getString("pcm"),Base64.NO_WRAP);if(pcm.length!=8000)throw new IOException("Неверный звук");receivedFrames++;if(!playback.offer(pcm)){playback.poll();playback.offer(pcm);}
     }
    }catch(Exception e){connected=false;talk(false);playback.clear();error=mode.equals("online")?"Нет связи с сервером. Подключаемся…":"Нет связи с каналом. Проверьте Wi-Fi, код и время на телефонах.";sleep(1000);}
    sleep(Math.max(20,250-(SystemClock.elapsedRealtime()-start)));
   }
  }catch(Exception e){lastError=e.getMessage()==null?"Не удалось создать канал":e.getMessage();main.post(()->stopSelf());}
  finally{try{request("leave",new JSONObject());}catch(Exception ignored){}if(host!=null){host.close();host=null;}}
 }
 private void playAudio(){try{while(running){byte[] pcm=playback.poll(500,TimeUnit.MILLISECONDS);if(pcm==null)continue;if(held||talking){playback.clear();track.pause();track.flush();track.play();continue;}int offset=0;while(offset<pcm.length&&running&&!held){int n=track.write(pcm,offset,pcm.length-offset,AudioTrack.WRITE_BLOCKING);if(n<0)throw new IOException("Не удалось воспроизвести звук");offset+=n;}}}catch(Exception e){if(running){lastError="Не удалось включить динамик. Переподключитесь к рации.";main.post(()->stopSelf());}}finally{if(track!=null){try{track.stop();track.release();}catch(Exception ignored){}track=null;}}
 }
 void talk(boolean press){
  if(!press){held=false;micLevel=0;AudioRecord source=liveRecorder;if(source!=null)try{source.stop();}catch(Exception ignored){}return;}
  if(!running||!connected||claiming||talking)return;held=true;claiming=true;error="";
  sender.execute(()->transmit());
 }
 private void transmit(){
  String turn=UUID.randomUUID().toString();AudioRecord recorder=null;Thread capture=null;ArrayBlockingQueue<byte[]> queue=new ArrayBlockingQueue<>(12);
  try{
   request("claim",new JSONObject().put("turn",turn));if(!held||!running)return;
   recorder=new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(32000,AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT)));
   if(recorder.getState()!=AudioRecord.STATE_INITIALIZED)throw new IOException("Микрофон недоступен");liveRecorder=recorder;recorder.startRecording();if(!held){recorder.stop();return;}if(recorder.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IOException("Микрофон занят");talking=true;claiming=false;
   AudioRecord source=recorder;long deadline=SystemClock.elapsedRealtime()+30000;
   capture=new Thread(()->{while(running&&held&&SystemClock.elapsedRealtime()<deadline){byte[] pcm=new byte[8000];int total=0;while(total<pcm.length&&held&&running){int n=source.read(pcm,total,pcm.length-total);if(n<=0){held=false;break;}total+=n;}if(total==pcm.length){int peak=0;for(int j=0;j<pcm.length;j+=2){int value=(short)((pcm[j]&255)|(pcm[j+1]<<8));peak=Math.max(peak,Math.abs(value));}micLevel=Math.min(100,peak*100/12000);if(!queue.offer(pcm)){queue.poll();queue.offer(pcm);}}}held=false;},"graff-radio-mic");capture.start();
   long seq=0,finishBy=Long.MAX_VALUE;while(running&&(held||!queue.isEmpty())){if(!held&&finishBy==Long.MAX_VALUE)finishBy=SystemClock.elapsedRealtime()+3000;if(SystemClock.elapsedRealtime()>finishBy)break;byte[] pcm=queue.poll(400,TimeUnit.MILLISECONDS);if(pcm==null)continue;
    if(mode.equals("online")){
     JSONArray chunks=new JSONArray();do{chunks.put(new JSONObject().put("seq",++seq).put("pcm",Base64.encodeToString(pcm,Base64.NO_WRAP)));pcm=chunks.length()<4?queue.poll():null;}while(pcm!=null);
     request("frame",new JSONObject().put("turn",turn).put("frames",chunks));sentFrames+=chunks.length();
    }else{request("frame",new JSONObject().put("turn",turn).put("seq",++seq).put("pcm",Base64.encodeToString(pcm,Base64.NO_WRAP)));sentFrames++;}
   }
  }catch(Exception e){error=e.getMessage()==null?"Передача прервана":e.getMessage();}
  finally{held=false;micLevel=0;liveRecorder=null;if(recorder!=null){try{recorder.stop();}catch(Exception ignored){}if(capture!=null)try{capture.join(700);}catch(Exception ignored){}recorder.release();}talking=false;claiming=false;try{request("release",new JSONObject().put("turn",turn));}catch(Exception ignored){}}
 }
 private static void sleep(long ms){try{Thread.sleep(ms);}catch(InterruptedException e){Thread.currentThread().interrupt();}}
 @Override public void onDestroy(){running=false;talk(false);connected=false;if(instance==this)instance=null;main.removeCallbacksAndMessages(null);sender.shutdown();poller.shutdown();player.shutdown();playback.clear();if(audio!=null&&focus!=null)audio.abandonAudioFocusRequest(focus);if(wake!=null&&wake.isHeld())wake.release();if(wifi!=null&&wifi.isHeld())wifi.release();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
}

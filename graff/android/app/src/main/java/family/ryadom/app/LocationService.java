package family.ryadom.app;

import android.app.*;
import android.content.*;
import android.location.*;
import android.os.*;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

public class LocationService extends Service implements LocationListener {
    static volatile boolean active=false;
    static volatile String error="";
    private static final String CHANNEL="graff_location";
    private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
    private volatile boolean stopped=false;
    private volatile Location latest;
    private LocationManager manager;
    private String bearer="",base="",shareId="";
    private boolean started=false;
    private long sentAt=0;
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null&&"STOP".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        if(started)return START_NOT_STICKY;started=true;error="";
        try{
            JSONObject session=new JSONObject(SessionStore.load(this));bearer=session.optString("token");base=session.optString("base");
            if(bearer.isEmpty())throw new Exception();
            NotificationManager nm=getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel(CHANNEL,"Передача локации",NotificationManager.IMPORTANCE_LOW));
            PendingIntent open=PendingIntent.getActivity(this,40,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            PendingIntent stop=PendingIntent.getService(this,41,new Intent(this,LocationService.class).setAction("STOP"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            Notification n=new Notification.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle("Вы делитесь локацией с семьёй")
                .setContentText("Graff обновляет ваше место на карте").setOngoing(true).setContentIntent(open).addAction(new Notification.Action.Builder(null,"Остановить",stop).build()).build();
            startForeground(40,n);active=true;
            manager=getSystemService(LocationManager.class);
            for(String provider:new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER}){
                try{if(manager.isProviderEnabled(provider)){manager.requestLocationUpdates(provider,30000,0,this);Location last=manager.getLastKnownLocation(provider);if(last!=null)onLocationChanged(last);}}catch(SecurityException ignored){}
            }
            worker.scheduleWithFixedDelay(()->upload(),0,30,TimeUnit.SECONDS);
        }catch(Exception e){error="Не удалось включить локацию. Проверьте разрешение и GPS.";stopSelf();}
        return START_NOT_STICKY;
    }
    private JSONObject request(String path,JSONObject body)throws Exception{
        URL origin=new URL(base);
        if(origin.getUserInfo()!=null||origin.getQuery()!=null||origin.getRef()!=null||!origin.getPath().matches("(/[a-zA-Z0-9_-]+)*/?"))throw new IOException();
        if(!origin.getProtocol().equals("https")){
            if(!origin.getProtocol().equals("http")||!(origin.getHost().equals("localhost")||origin.getHost().matches("[0-9.]+")))throw new IOException();
            InetAddress a=InetAddress.getByName(origin.getHost());if(!a.isLoopbackAddress()&&!a.isSiteLocalAddress())throw new IOException();
        }
        HttpURLConnection c=(HttpURLConnection)new URL(base.replaceAll("/$","")+"/api"+path).openConnection();
        try{c.setRequestMethod("POST");c.setConnectTimeout(8000);c.setReadTimeout(10000);c.setInstanceFollowRedirects(false);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");c.setRequestProperty("Authorization","Bearer "+bearer);
            byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}
            int status=c.getResponseCode();if(status==401||status==409){stopped=true;error="Передача завершена. Включите её заново.";new Handler(getMainLooper()).post(()->stopSelf());throw new IOException();}
            if(status!=200)throw new IOException();
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buf=new byte[2048];int n;while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>8192)throw new IOException();}return new JSONObject(out.toString("UTF-8"));}
        }finally{c.disconnect();}
    }
    private void upload(){
        if(stopped)return;
        try{
            JSONObject current=new JSONObject(SessionStore.load(this));
            if(!bearer.equals(current.optString("token"))||!base.equals(current.optString("base"))){new Handler(getMainLooper()).post(()->stopSelf());return;}
            if(shareId.isEmpty())shareId=request("/location/share",new JSONObject().put("enabled",true)).getString("shareId");
            if(stopped)return;
            Location loc=latest;
            if(loc==null||SystemClock.elapsedRealtimeNanos()-loc.getElapsedRealtimeNanos()>300000000000L){error="Ищем GPS. Проверьте, включена ли геолокация.";return;}
            if(loc.getTime()<=sentAt)return;
            request("/location/update",new JSONObject().put("shareId",shareId).put("lat",loc.getLatitude()).put("lon",loc.getLongitude()).put("accuracy",loc.getAccuracy()).put("recorded",loc.getTime()));
            sentAt=loc.getTime();error="";
        }catch(Exception e){if(!stopped)error="Нет связи. Повторяем передачу локации…";}
    }
    @Override public void onLocationChanged(Location loc){if(loc.hasAccuracy()&&(latest==null||loc.getTime()>latest.getTime()))latest=new Location(loc);}
    @Override public void onProviderDisabled(String p){error="Геолокация выключена на телефоне";}
    @Override public void onProviderEnabled(String p){error="";}
    @Override public void onStatusChanged(String p,int s,Bundle b){}
    @Override public void onDestroy(){
        stopped=true;active=false;if(manager!=null)manager.removeUpdates(this);
        worker.execute(()->{if(!shareId.isEmpty())try{request("/location/share",new JSONObject().put("enabled",false).put("shareId",shareId));}catch(Exception ignored){}});
        worker.shutdown();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();
    }
}

package family.ryadom.app;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.graphics.Color;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.*;

final class PushController {
    static final String CHANNEL="graff_messages";
    static volatile boolean foreground=false;
    static volatile String visibleChat="";
    private static final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
    private static int retry=0;
    private static volatile boolean fetching=false;
    private static volatile String registered="";
    static void channel(Context context){
        NotificationChannel channel=new NotificationChannel(CHANNEL,"Сообщения Graff",NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Новые сообщения в семейных и личных чатах");
        channel.enableVibration(true);channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    static boolean configured(Context context){return !com.google.firebase.FirebaseApp.getApps(context).isEmpty();}
    static String status(Context context){
        if(!configured(context))return "Пуши ещё не подключены";
        NotificationManager nm=context.getSystemService(NotificationManager.class);
        NotificationChannel ch=nm.getNotificationChannel(CHANNEL);
        if(!nm.areNotificationsEnabled()||(ch!=null&&ch.getImportance()==NotificationManager.IMPORTANCE_NONE))return "Выключены — нажмите, чтобы разрешить";
        return context.getSharedPreferences("graff.push",Context.MODE_PRIVATE).getBoolean("registered",false)?"Включены · сообщения приходят в фоне":"Подключаем уведомления…";
    }
    static void sync(Context context){
        Context app=context.getApplicationContext();
        if(!configured(app))return;
        try{
            JSONObject session=new JSONObject(SessionStore.load(app));
            if(session.optString("token").isEmpty()){
                registered="";app.getSharedPreferences("graff.push",Context.MODE_PRIVATE).edit().putBoolean("registered",false).apply();
                app.getSystemService(NotificationManager.class).cancelAll();return;
            }
            if(fetching)return;fetching=true;
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task->{
                fetching=false;
                if(task.isSuccessful())register(app,task.getResult());else retry(app);
            });
        }catch(Exception ignored){fetching=false;}
    }
    private static synchronized void retry(Context app){if(retry<8)worker.schedule(()->sync(app),Math.min(300,5L<<retry++),TimeUnit.SECONDS);}
    static void register(Context context,String token){
        Context app=context.getApplicationContext();
        worker.execute(()->{
            HttpURLConnection conn=null;
            try{
                JSONObject session=new JSONObject(SessionStore.load(app));
                String bearer=session.optString("token"),base=session.optString("base");
                if(bearer.isEmpty()||token==null||token.isEmpty())return;
                String fingerprint=base+"|"+bearer+"|"+token;
                if(fingerprint.equals(registered))return;
                URL origin=new URL(base);
                if(origin.getUserInfo()!=null||origin.getQuery()!=null||origin.getRef()!=null||!origin.getPath().matches("(/[a-zA-Z0-9_-]+)*/?"))return;
                if(!origin.getProtocol().equals("https")){
                    if(!origin.getProtocol().equals("http")||!(origin.getHost().equals("localhost")||origin.getHost().matches("[0-9.]+")))return;
                    InetAddress address=InetAddress.getByName(origin.getHost());if(!address.isLoopbackAddress()&&!address.isSiteLocalAddress())return;
                }
                SharedPreferences p=app.getSharedPreferences("graff.push",Context.MODE_PRIVATE);
                p.edit().putBoolean("registered",false).apply();
                String installation=p.getString("installation","");
                if(installation.isEmpty()){installation=UUID.randomUUID().toString();p.edit().putString("installation",installation).commit();}
                JSONObject body=new JSONObject();body.put("token",token);body.put("installation",installation);
                conn=(HttpURLConnection)new URL(base.replaceAll("/$","")+"/api/push/devices").openConnection();
                conn.setConnectTimeout(8000);conn.setReadTimeout(12000);conn.setInstanceFollowRedirects(false);conn.setRequestMethod("POST");
                conn.setRequestProperty("Authorization","Bearer "+bearer);conn.setRequestProperty("Content-Type","application/json");conn.setDoOutput(true);
                byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);conn.setFixedLengthStreamingMode(bytes.length);
                try(OutputStream out=conn.getOutputStream()){out.write(bytes);}
                int status=conn.getResponseCode();JSONObject current=new JSONObject(SessionStore.load(app));
                if(status==200 && bearer.equals(current.optString("token")) && base.equals(current.optString("base"))){
                    registered=fingerprint;retry=0;p.edit().putBoolean("registered",true).apply();
                }else if(status!=401)retry(app);
            }catch(Exception ignored){retry(app);}finally{if(conn!=null)conn.disconnect();}
        });
    }
    static void show(Context context,java.util.Map<String,String> data){
        try{
            JSONObject session=new JSONObject(SessionStore.load(context));
            JSONObject user=session.optJSONObject("user");
            String uid=data.get("recipientUserId"),chat=data.get("chatId"),id=data.get("messageId");
            if(session.optString("token").isEmpty()||user==null||!user.optString("id").equals(uid)||chat==null||!chat.matches("[a-zA-Z0-9-]+")||id==null||!id.matches("[0-9]+"))return;
            if(foreground&&chat.equals(visibleChat))return;
            NotificationManager nm=context.getSystemService(NotificationManager.class);channel(context);
            if(!nm.areNotificationsEnabled())return;
            SharedPreferences seen=context.getSharedPreferences("graff.push.seen",Context.MODE_PRIVATE);
            String key=uid+":"+chat;long messageId=Long.parseLong(id);
            if(seen.getLong(key,0)>=messageId)return;
            Intent intent=new Intent(context,MainActivity.class).setAction("GRAFF_CHAT")
                .setData(Uri.parse("graff://chat/"+chat+"?user="+uid)).putExtra("chatId",chat).putExtra("userId",uid)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent tap=PendingIntent.getActivity(context,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            Notification hidden=new Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle("Graff").setContentText("Новое сообщение").build();
            String title=data.get("title"),body=data.get("body");
            Notification notification=new Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_notification)
                .setColor(Color.rgb(49,238,136)).setContentTitle(title==null?"Graff":title).setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body)).setCategory(Notification.CATEGORY_MESSAGE)
                .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(hidden).setContentIntent(tap).setAutoCancel(true).build();
            nm.notify(key,1,notification);seen.edit().putLong(key,messageId).apply();
        }catch(Exception ignored){}
    }
}

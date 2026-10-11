package family.ryadom.app;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.webkit.*;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.net.URL;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends Activity {
    private WebView web;
    private VoiceRecorder voice;
    private PermissionRequest cameraPermission;
    private boolean voiceRequested=false;
    private String radioMode="online",radioCode="";
    private SharedPreferences prefs;
    private final ExecutorService network = new ThreadPoolExecutor(3,3,30,TimeUnit.SECONDS,new ArrayBlockingQueue<Runnable>(30));
    private static final String ORIGIN = "https://app.ryadom.local";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs=getSharedPreferences("ryadom",MODE_PRIVATE);
        PushController.channel(this);captureNotification(getIntent());voice=new VoiceRecorder(this);
        FrameLayout root=new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(20,30,42));
        web=new WebView(this);
        web.setBackgroundColor(Color.rgb(20,30,42));
        root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        if(Build.VERSION.SDK_INT>=30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v,insets)->{
                Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
                Insets keyboard=insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,keyboard.bottom));
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(root);
        WebSettings s=web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setSafeBrowsingEnabled(true);
        s.setUserAgentString(s.getUserAgentString()+" Graff/0.7.0 (+https://kronoxx.ru/graff/)");
        s.setTextZoom(100);s.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.addJavascriptInterface(new Bridge(),"Android");
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onPermissionRequest(PermissionRequest request){runOnUiThread(()->{
                if(RadioService.active()){request.deny();return;}
                if(!ORIGIN.equals(request.getOrigin().toString().replaceAll("/$",""))){request.deny();return;}
                for(String resource:request.getResources())if(!PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)&&!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)){request.deny();return;}
                if(cameraPermission!=null)cameraPermission.deny();cameraPermission=request;
                ArrayList<String> missing=new ArrayList<>();
                for(String p:new String[]{android.Manifest.permission.CAMERA,android.Manifest.permission.RECORD_AUDIO})if(checkSelfPermission(p)!=android.content.pm.PackageManager.PERMISSION_GRANTED)missing.add(p);
                if(missing.isEmpty())grantCamera();else requestPermissions(missing.toArray(new String[0]),105);
            });}
            @Override public void onPermissionRequestCanceled(PermissionRequest request){if(cameraPermission==request)cameraPermission=null;}
        });
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                String file=uri.getPath();
                if("https".equals(uri.getScheme())&&"tile.openstreetmap.org".equals(uri.getHost())&&file!=null&&file.matches("/[0-9]{1,2}/[0-9]+/[0-9]+\\.png"))return null;
                if(!"https".equals(uri.getScheme())||!"app.ryadom.local".equals(uri.getHost()))return blocked();
                if(file==null||file.equals("/"))file="/index.html";
                if(!Arrays.asList("/index.html","/app.js","/voice.js","/attachments.js","/video.js","/video-poster.svg","/radio.js","/location.js","/vendor/leaflet.js","/vendor/leaflet.css","/style.css","/icon.svg","/avatars/artur.png","/avatars/adel.png","/avatars/rezeda.png","/avatars/family.png","/avatars/chelsey.png").contains(file))return blocked();
                String mime=file.endsWith(".png")?"image/png":file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":file.endsWith(".svg")?"image/svg+xml":"text/html";
                try {
                    Map<String,String> headers=new HashMap<>();
                    headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'none'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'");
                    headers.put("X-Content-Type-Options","nosniff");
                    return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open(file.substring(1)));
                } catch(IOException ex){return blocked();}
            }
        });
        web.loadUrl(ORIGIN+"/index.html");
    }
    private WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    private String loadSession(){return SessionStore.load(this);}
    private void saveSession(String raw) throws Exception {if(!new JSONObject(loadSession()).optString("token").equals(new JSONObject(raw).optString("token")))stopService(new android.content.Intent(this,RadioService.class));if(!new JSONObject(loadSession()).optString("token").equals(new JSONObject(raw).optString("token")))stopService(new android.content.Intent(this,LocationService.class));SessionStore.save(this,raw);runOnUiThread(()->{PushController.sync(this);promptNotifications(false);});}
    private volatile String pendingChat="{}";
    private volatile boolean pendingRadio=false;
    private void captureNotification(android.content.Intent intent){
        if(intent!=null&&"GRAFF_RADIO".equals(intent.getAction()))pendingRadio=true;
        if(intent!=null && "GRAFF_CHAT".equals(intent.getAction()))try{
            JSONObject item=new JSONObject();item.put("chatId",intent.getStringExtra("chatId"));item.put("userId",intent.getStringExtra("userId"));pendingChat=item.toString();
        }catch(Exception ignored){}
    }
    @Override protected void onNewIntent(android.content.Intent intent){super.onNewIntent(intent);setIntent(intent);captureNotification(intent);if(web!=null)web.evaluateJavascript("window.onNotificationOpen && window.onNotificationOpen()",null);}
    private void promptNotifications(boolean explicit){
        if(!PushController.configured(this))return;
        try{if(new JSONObject(loadSession()).optString("token").isEmpty())return;}catch(Exception e){return;}
        if(explicit){
            android.content.Intent intent=new android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName());startActivity(intent);return;
        }
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED && !prefs.getBoolean("notificationAsked",false)){
            prefs.edit().putBoolean("notificationAsked",true).apply();
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},101);
        }
    }

    private void grantCamera(){
        PermissionRequest request=cameraPermission;cameraPermission=null;if(request==null)return;
        if(checkSelfPermission(android.Manifest.permission.CAMERA)==android.content.pm.PackageManager.PERMISSION_GRANTED&&checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED)request.grant(request.getResources());else request.deny();
    }
    void voiceEvent(JSONObject event){runOnUiThread(()->{if(web!=null&&!isFinishing())web.evaluateJavascript("window.onVoiceEvent && window.onVoiceEvent("+event.toString()+")",null);});}
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){
        super.onRequestPermissionsResult(code,permissions,results);
        if(code==105)grantCamera();
        if(code==106){if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED)beginRadio();else RadioService.lastError="Разрешите микрофон в настройках Android";}
        if(code==103){if(checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)==android.content.pm.PackageManager.PERMISSION_GRANTED)beginLocation();else locationEvent("Разрешите доступ к геолокации, чтобы появиться на карте");}
        if(code==102){if(results.length>0&&results[0]==android.content.pm.PackageManager.PERMISSION_GRANTED){if(voiceRequested)voice.start();}else{JSONObject error=error("Для записи разрешите доступ к микрофону в настройках телефона");try{error.put("state","error");}catch(Exception ignored){}voiceEvent(error);}}
    }
    private void locationEvent(String error){runOnUiThread(()->web.evaluateJavascript("window.onLocationPermission && window.onLocationPermission("+JSONObject.quote(error)+")",null));}
    private void beginLocation(){try{startForegroundService(new android.content.Intent(this,LocationService.class));locationEvent("");}catch(Exception e){locationEvent("Не удалось включить передачу локации");}}
    private void imageEvent(JSONObject result){runOnUiThread(()->{if(web!=null&&!isFinishing())web.evaluateJavascript("window.onImagePicked && window.onImagePicked("+result.toString()+")",null);});}
    @Override protected void onActivityResult(int requestCode,int resultCode,android.content.Intent data){
        super.onActivityResult(requestCode,resultCode,data);if(requestCode!=104)return;
        if(resultCode!=RESULT_OK||data==null){imageEvent(error("Выбор изображения отменён"));return;}
        final Uri uri=data.getData();
        try{network.execute(()->{try{imageEvent(ImageAttachment.read(this,uri));}catch(Exception|OutOfMemoryError e){imageEvent(error("Не удалось открыть изображение. Выберите JPG, PNG или другое фото до 32 МБ."));}});}catch(Exception e){imageEvent(error("Попробуйте выбрать изображение ещё раз"));}
    }
    private void beginRadio(){try{voiceRequested=false;voice.cancel(false);startForegroundService(new android.content.Intent(this,RadioService.class).putExtra("mode",radioMode).putExtra("code",radioCode));}catch(Exception e){RadioService.lastError="Не удалось включить рацию. Откройте приложение и попробуйте снова.";}}
    public class Bridge {
        @JavascriptInterface public String radioStatus(){return RadioService.status();}
        @JavascriptInterface public void radioStart(String mode,String code){runOnUiThread(()->{if(RadioService.active())return;radioMode=mode;radioCode=code;RadioService.lastError="";if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO},106);else beginRadio();});}
        @JavascriptInterface public void radioShare(String code){if(code.length()>150||!code.startsWith("graff1|"))return;runOnUiThread(()->{android.content.Intent share=new android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT,code);startActivity(android.content.Intent.createChooser(share,"Передать код рации"));});}
        @JavascriptInterface public void radioStop(){runOnUiThread(()->stopService(new android.content.Intent(MainActivity.this,RadioService.class)));}
        @JavascriptInterface public void radioTalk(boolean pressed){runOnUiThread(()->{RadioService r=RadioService.instance;if(r!=null)r.talk(pressed);});}

        @JavascriptInterface public void pickImage(){runOnUiThread(()->{try{android.content.Intent i=new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);i.addCategory(android.content.Intent.CATEGORY_OPENABLE);i.setType("image/*");startActivityForResult(i,104);}catch(Exception e){imageEvent(error("Галерея недоступна"));}});}

        @JavascriptInterface public void startLocation(){runOnUiThread(()->{if(checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.ACCESS_FINE_LOCATION,android.Manifest.permission.ACCESS_COARSE_LOCATION},103);else beginLocation();});}
        @JavascriptInterface public void stopLocation(){runOnUiThread(()->stopService(new android.content.Intent(MainActivity.this,LocationService.class)));}
        @JavascriptInterface public String locationStatus(){try{return new JSONObject().put("active",LocationService.active).put("error",LocationService.error).toString();}catch(Exception e){return "{}";}}

        @JavascriptInterface public void startVoice(){runOnUiThread(()->{if(RadioService.active()){JSONObject event=error("Сначала выйдите из канала рации");try{event.put("state","error");}catch(Exception ignored){}voiceEvent(event);return;}voiceRequested=true;if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO},102);else voice.start();});}
        @JavascriptInterface public void stopVoice(){runOnUiThread(()->voice.stop());}
        @JavascriptInterface public void cancelVoice(){runOnUiThread(()->{voiceRequested=false;voice.cancel(false);});}

        @JavascriptInterface public void notifications(){runOnUiThread(()->promptNotifications(true));}
        @JavascriptInterface public String notificationStatus(){return PushController.status(MainActivity.this);}
        @JavascriptInterface public boolean consumeRadio(){boolean value=pendingRadio;pendingRadio=false;return value;}
        @JavascriptInterface public String consumeNotification(){String result=pendingChat;pendingChat="{}";return result;}
        @JavascriptInterface public void visibleChat(String id){PushController.visibleChat=id;try{JSONObject user=new JSONObject(loadSession()).optJSONObject("user");if(user!=null&&!id.isEmpty())getSystemService(android.app.NotificationManager.class).cancel(user.optString("id")+":"+id,1);}catch(Exception ignored){}}

        @JavascriptInterface public String load(){return loadSession();}
        @JavascriptInterface public void save(String raw){try{saveSession(raw);}catch(Exception e){throw new IllegalStateException("Не удалось сохранить настройки",e);}}
        @JavascriptInterface public void copy(String text){runOnUiThread(()->{ClipboardManager cm=(ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE);ClipData clip=ClipData.newPlainText("Приглашение в Graff",text);if(Build.VERSION.SDK_INT>=33){android.os.PersistableBundle extras=new android.os.PersistableBundle();extras.putBoolean("android.content.extra.IS_SENSITIVE",true);clip.getDescription().setExtras(extras);}cm.setPrimaryClip(clip);});}
        @JavascriptInterface public void request(String id,String method,String path,String body){
            try{network.execute(()->performRequest(id,method,path,body));}catch(RejectedExecutionException e){respond(id,0,error("Слишком много запросов. Попробуйте ещё раз."));}
        }
    }
    private JSONObject error(String text){JSONObject obj=new JSONObject();try{obj.put("error",text);}catch(Exception ignored){}return obj;}
    private void performRequest(String id,String method,String path,String body){
        HttpURLConnection conn=null;
        try{
            if(!Arrays.asList("GET","POST").contains(method)||!path.matches("/[a-zA-Z0-9/_?=&-]+")||path.contains(".."))throw new IOException("Некорректный запрос");
            JSONObject session=new JSONObject(loadSession());
            String base=session.optString("base","");
            URL origin=new URL(base);
            if(origin.getUserInfo()!=null||origin.getQuery()!=null||origin.getRef()!=null||!origin.getPath().matches("(/[a-zA-Z0-9_-]+)*/?"))throw new IOException("Некорректный адрес сервера");
            if(!origin.getProtocol().equals("https")){
                String host=origin.getHost();
                if(!origin.getProtocol().equals("http")||!(host.equals("localhost")||host.matches("[0-9.]+")))throw new IOException("Для интернет-сервера нужен HTTPS");
                InetAddress address=InetAddress.getByName(host);
                if(!address.isLoopbackAddress()&&!address.isSiteLocalAddress())throw new IOException("HTTP доступен только в домашней сети");
            }
            URL endpoint=new URL(base.replaceAll("/$","")+"/api"+path);
            conn=(HttpURLConnection)endpoint.openConnection();
            conn.setConnectTimeout(8000);conn.setReadTimeout(path.contains("/video")?115000:path.endsWith("/voice")||path.endsWith("/audio")||path.contains("/image")?60000:12000);conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod(method);conn.setRequestProperty("Accept","application/json");
            String token=session.optString("token","");if(!token.isEmpty())conn.setRequestProperty("Authorization","Bearer "+token);
            if(method.equals("POST")){
                byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
                if(bytes.length>(path.endsWith("/video")?11300000:(path.endsWith("/voice")||path.endsWith("/image"))?2900000:32768))throw new IOException("Слишком большой запрос");
                conn.setDoOutput(true);conn.setRequestProperty("Content-Type","application/json");conn.setFixedLengthStreamingMode(bytes.length);
                try(OutputStream out=conn.getOutputStream()){out.write(bytes);}
            }
            int status=conn.getResponseCode();
            InputStream stream=status>=400?conn.getErrorStream():conn.getInputStream();
            if(stream==null)throw new IOException("Пустой ответ сервера");
            ByteArrayOutputStream output=new ByteArrayOutputStream();
            try(InputStream input=stream){byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1){if(output.size()+n>(path.contains("/video")?12000000:6000000))throw new IOException("Слишком большой ответ");output.write(buffer,0,n);}}
            JSONObject result;try{result=new JSONObject(output.toString("UTF-8"));}catch(Exception e){throw new IOException("Сервер вернул неверный ответ");}
            respond(id,status,result);
        }catch(Exception e){respond(id,0,error(e instanceof javax.net.ssl.SSLException?"Не удалось проверить HTTPS-сертификат сервера":"Нет связи с сервером. Проверьте адрес и подключение."));}
        finally{if(conn!=null)conn.disconnect();}
    }
    private void respond(String id,int status,JSONObject data){
        try{JSONObject payload=new JSONObject();payload.put("status",status);payload.put("data",data);String script="window.onNativeResponse("+JSONObject.quote(id)+","+payload.toString()+")";runOnUiThread(()->{if(web!=null&&!isFinishing())web.evaluateJavascript(script,null);});}catch(Exception ignored){}
    }
    @Override public void onBackPressed(){web.evaluateJavascript("window.appBack ? window.appBack() : false",result->{if(!"true".equals(result))finish();});}
    @Override protected void onPause(){if(RadioService.instance!=null)RadioService.instance.talk(false);PushController.foreground=false;if(voice!=null)voice.cancel(true);if(web!=null&&cameraPermission==null)web.evaluateJavascript("window.videoBackground && window.videoBackground()",null);if(web!=null)web.evaluateJavascript("window.graffPauseVoice && window.graffPauseVoice()",null);super.onPause();web.onPause();}
    @Override protected void onResume(){super.onResume();PushController.foreground=true;PushController.sync(this);if(web!=null){web.onResume();web.evaluateJavascript("window.onNotificationOpen && window.onNotificationOpen()",null);}}
    @Override protected void onDestroy(){if(cameraPermission!=null){cameraPermission.deny();cameraPermission=null;}if(voice!=null)voice.cancel(false);network.shutdownNow();if(web!=null){web.removeJavascriptInterface("Android");web.destroy();web=null;}super.onDestroy();}
}

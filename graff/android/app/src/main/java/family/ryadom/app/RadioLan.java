package family.ryadom.app;

import android.content.Context;
import android.net.*;
import android.util.Base64;
import org.json.*;
import javax.crypto.Cipher;
import javax.crypto.spec.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;

/** Ephemeral LAN relay; the pairing code contains a fresh AES-256 room key. */
final class RadioLan implements AutoCloseable {
 private final byte[] key;
 private final ServerSocket server;
 private final ExecutorService clients=new ThreadPoolExecutor(2,4,20,TimeUnit.SECONDS,new ArrayBlockingQueue<>(8));
 private volatile boolean closed;
 private final Map<String,JSONObject> peers=new LinkedHashMap<>();
 private final Map<String,Long> seen=new HashMap<>(),replays=new HashMap<>();
 private final ArrayDeque<JSONObject> frames=new ArrayDeque<>();
 private String speaker="",turn="";
 private long expiry,started,cursor,lastSeq;
 final JSONArray codes=new JSONArray();
 RadioLan()throws Exception{
  key=new byte[32];new SecureRandom().nextBytes(key);server=new ServerSocket(0,8);
  for(NetworkInterface face:Collections.list(NetworkInterface.getNetworkInterfaces())){
   String name=face.getName();if(name.startsWith("rmnet")||name.startsWith("ccmni")||name.startsWith("tun"))continue;
   for(InetAddress address:Collections.list(face.getInetAddresses()))if(address instanceof Inet4Address&&address.isSiteLocalAddress())codes.put("graff1|"+address.getHostAddress()+"|"+server.getLocalPort()+"|"+encode(key));
  }
  if(codes.length()==0){server.close();clients.shutdownNow();throw new IOException("Подключитесь к Wi-Fi или включите точку доступа");}
  new Thread(()->{while(!closed)try{Socket socket=server.accept();socket.setSoTimeout(3000);if(!socket.getInetAddress().isSiteLocalAddress()&&!socket.getInetAddress().isLoopbackAddress()){socket.close();continue;}try{clients.execute(()->serve(socket));}catch(RejectedExecutionException e){socket.close();}}catch(IOException e){if(!closed)close();}},"graff-radio-lan").start();
 }
 static String encode(byte[] data){return Base64.encodeToString(data,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);}
 static byte[] crypt(boolean encrypt,byte[] key,byte[] bytes,String direction)throws Exception{
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");byte[] iv;
  if(encrypt){iv=new byte[12];new SecureRandom().nextBytes(iv);}else{if(bytes.length<28)throw new IOException();iv=Arrays.copyOf(bytes,12);bytes=Arrays.copyOfRange(bytes,12,bytes.length);}
  cipher.init(encrypt?Cipher.ENCRYPT_MODE:Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));cipher.updateAAD(("graff-radio-v1:"+direction).getBytes(StandardCharsets.UTF_8));byte[] result=cipher.doFinal(bytes);
  if(!encrypt)return result;byte[] out=new byte[result.length+12];System.arraycopy(iv,0,out,0,12);System.arraycopy(result,0,out,12,result.length);return out;
 }
 private void serve(Socket socket){try(Socket s=socket){
  DataInputStream in=new DataInputStream(s.getInputStream());int n=in.readInt();if(n<28||n>18000)return;byte[] bytes=new byte[n];in.readFully(bytes);
  JSONObject q=new JSONObject(new String(crypt(false,key,bytes,"request"),StandardCharsets.UTF_8));String nonce=q.getString("request");
  synchronized(this){long t=System.currentTimeMillis();replays.entrySet().removeIf(e->e.getValue()<t-120000);if(Math.abs(t-q.getLong("time"))>60000||replays.containsKey(nonce)||replays.size()>4000)return;replays.put(nonce,t);}
  JSONObject result;try{result=handle(q.getString("op"),q.getJSONObject("body"),q.getJSONObject("user"));}catch(Exception e){result=new JSONObject().put("error",e.getMessage()==null?"Ошибка канала":e.getMessage());}
  result.put("request",nonce);byte[] reply=crypt(true,key,result.toString().getBytes(StandardCharsets.UTF_8),"response");DataOutputStream out=new DataOutputStream(s.getOutputStream());out.writeInt(reply.length);out.write(reply);out.flush();
 }catch(Exception ignored){}}
 synchronized JSONObject handle(String op,JSONObject b,JSONObject user)throws Exception{
  long t=System.currentTimeMillis();seen.entrySet().removeIf(e->e.getValue()<t-6000);peers.keySet().retainAll(seen.keySet());
  while(!frames.isEmpty()&&frames.peek().getLong("created")<t-2000)frames.remove();
  if(expiry<t||!peers.containsKey(speaker)){speaker="";turn="";}
  String client=b.getString("client");if(!client.matches("[a-zA-Z0-9-]{16,80}"))throw new IOException("Неверное подключение");
  if(op.equals("join")){
   if(!peers.containsKey(client)&&peers.size()>=8)throw new IOException("В канале уже 8 устройств");
   String name=user.optString("name"),login=user.optString("login");if(name.isEmpty()||name.length()>40||login.length()>24)throw new IOException("Неверное имя");
   peers.put(client,new JSONObject().put("client",client).put("id",user.optString("id")).put("name",name).put("login",login));
  }else if(!peers.containsKey(client))throw new IOException("Подключитесь к рации снова");
  seen.put(client,t);
  if(op.equals("claim")){
   String next=b.getString("turn");if(!next.matches("[a-zA-Z0-9-]{16,80}"))throw new IOException("Неверная передача");
   if(!speaker.isEmpty()&&(!speaker.equals(client)||!turn.equals(next)))throw new IOException("Сейчас говорит другой участник");
   if(speaker.isEmpty()){speaker=client;turn=next;expiry=t+2500;started=t;lastSeq=0;}
  }else if(op.equals("frame")){
   if(!speaker.equals(client)||!turn.equals(b.optString("turn"))||t-started>30000)throw new IOException("Передача завершена");
   long seq=b.getLong("seq");byte[] pcm=Base64.decode(b.getString("pcm"),Base64.NO_WRAP);if(pcm.length!=8000||seq<=lastSeq||seq>lastSeq+20)throw new IOException("Неверный звук");
   int recent=0;for(JSONObject f:frames)if(f.getLong("created")>t-1000)recent++;if(recent>=8)throw new IOException("Слишком быстрая передача");
   frames.add(new JSONObject().put("id",++cursor).put("client",client).put("turn",turn).put("seq",seq).put("pcm",Base64.encodeToString(pcm,Base64.NO_WRAP)).put("created",t));expiry=t+2500;lastSeq=seq;
  }else if(op.equals("release")||op.equals("leave")){
   if(speaker.equals(client)&&(op.equals("leave")||turn.equals(b.optString("turn")))){speaker="";turn="";expiry=0;}
   if(op.equals("leave")){peers.remove(client);seen.remove(client);}
  }else if(!op.equals("poll")&&!op.equals("join"))throw new IOException("Неизвестное действие");
  JSONArray sound=new JSONArray();if(op.equals("poll"))for(JSONObject f:frames)if(f.getLong("id")>b.optLong("after",cursor)&&f.getLong("created")>=t-1000&&!f.getString("client").equals(client))sound.put(f);
  return new JSONObject().put("ok",true).put("peers",new JSONArray(peers.values())).put("speaker",peers.containsKey(speaker)?peers.get(speaker):JSONObject.NULL).put("turn",turn).put("cursor",cursor).put("frames",sound);
 }
 static JSONObject request(Context context,String code,String op,JSONObject body,JSONObject user)throws Exception{
  String[] parts=code.trim().split("\\|");if(parts.length!=4||!parts[0].equals("graff1")||!parts[1].matches("[0-9.]{7,15}"))throw new IOException("Неверный код канала");
  InetAddress address=InetAddress.getByName(parts[1]);if(!address.isSiteLocalAddress()&&!address.isLoopbackAddress())throw new IOException("Нужен адрес локальной сети");
  int port=Integer.parseInt(parts[2]);if(port<1024||port>65535)throw new IOException("Неверный порт");byte[] key=Base64.decode(parts[3],Base64.URL_SAFE|Base64.NO_WRAP);if(key.length!=32)throw new IOException("Неверный ключ канала");
  Socket socket=null;ConnectivityManager cm=context.getSystemService(ConnectivityManager.class);
  for(Network network:cm.getAllNetworks()){NetworkCapabilities caps=cm.getNetworkCapabilities(network);if(caps!=null&&caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)){socket=network.getSocketFactory().createSocket();break;}}
  if(socket==null)socket=new Socket();
  try(Socket s=socket){s.connect(new InetSocketAddress(address,port),2500);s.setSoTimeout(3000);String nonce=UUID.randomUUID().toString();JSONObject q=new JSONObject().put("op",op).put("body",body).put("user",user).put("request",nonce).put("time",System.currentTimeMillis());
   byte[] bytes=crypt(true,key,q.toString().getBytes(StandardCharsets.UTF_8),"request");DataOutputStream out=new DataOutputStream(s.getOutputStream());out.writeInt(bytes.length);out.write(bytes);out.flush();
   DataInputStream in=new DataInputStream(s.getInputStream());int n=in.readInt();if(n<28||n>150000)throw new IOException("Неверный ответ");byte[] reply=new byte[n];in.readFully(reply);JSONObject result=new JSONObject(new String(crypt(false,key,reply,"response"),StandardCharsets.UTF_8));if(!nonce.equals(result.optString("request")))throw new IOException("Неверный ответ");return result;
  }
 }
 @Override public void close(){closed=true;try{server.close();}catch(Exception ignored){}clients.shutdownNow();synchronized(this){frames.clear();peers.clear();seen.clear();replays.clear();Arrays.fill(key,(byte)0);}}
}

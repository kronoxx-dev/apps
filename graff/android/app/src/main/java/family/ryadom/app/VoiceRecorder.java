package family.ryadom.app;
import android.media.MediaRecorder;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import android.util.Base64;
import org.json.JSONObject;
import java.io.File;
import java.nio.file.Files;
final class VoiceRecorder {
    private final MainActivity activity;
    private MediaRecorder recorder;
    private File file;
    VoiceRecorder(MainActivity activity){this.activity=activity;}
    private void event(String state,String error){try{JSONObject obj=new JSONObject();obj.put("state",state);if(error!=null)obj.put("error",error);activity.voiceEvent(obj);}catch(Exception ignored){}}
    void start(){
        if(recorder!=null)return;
        try{
            file=File.createTempFile("graff-voice-",".m4a",activity.getCacheDir());
            recorder=Build.VERSION.SDK_INT>=31?new MediaRecorder(activity):new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);recorder.setAudioChannels(1);recorder.setAudioSamplingRate(16000);recorder.setAudioEncodingBitRate(32000);
            recorder.setOutputFile(file.getAbsolutePath());recorder.setMaxDuration(120000);recorder.setMaxFileSize(2*1024*1024);
            recorder.setOnInfoListener((r,what,extra)->{if(what==MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED||what==MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED)stop();});
            recorder.prepare();recorder.start();event("recording",null);
        }catch(Exception e){cancel(false);event("error","Не удалось включить микрофон. Проверьте разрешение.");}
    }
    void stop(){
        if(recorder==null)return;
        try{
            recorder.stop();recorder.release();recorder=null;
            MediaMetadataRetriever meta=new MediaMetadataRetriever();meta.setDataSource(file.getAbsolutePath());long duration=Long.parseLong(meta.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));meta.release();
            if(duration<300)throw new IllegalStateException();
            JSONObject result=new JSONObject();result.put("state","ready");result.put("audio",Base64.encodeToString(Files.readAllBytes(file.toPath()),Base64.NO_WRAP));result.put("mime","audio/mp4");result.put("duration",duration);activity.voiceEvent(result);
        }catch(Exception e){event("error","Запись слишком короткая. Попробуйте ещё раз.");}
        finally{cancel(false);}
    }
    void cancel(boolean notify){
        boolean active=recorder!=null;
        if(recorder!=null){try{recorder.reset();recorder.release();}catch(Exception ignored){}recorder=null;}
        if(file!=null){file.delete();file=null;}
        if(active&&notify)event("cancelled",null);
    }
}

package family.ryadom.app;
import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
final class SessionStore {
    private static SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias("ryadom.session")){
            KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder("ryadom.session",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            gen.generateKey();
        }
        return (SecretKey)store.getKey("ryadom.session",null);
    }
    static synchronized String load(Context context){
        try{
            String raw=context.getSharedPreferences("ryadom",Context.MODE_PRIVATE).getString("encrypted",null);if(raw==null)return "{}";
            String[] parts=raw.split(":");
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
        }catch(Exception ex){return "{}";}
    }
    static synchronized void save(Context context,String raw) throws Exception {
        new JSONObject(raw);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        String encrypted=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(raw.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
        if(!context.getSharedPreferences("ryadom",Context.MODE_PRIVATE).edit().putString("encrypted",encrypted).commit())throw new IOException("Не удалось сохранить вход");
    }
}

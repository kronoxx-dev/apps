package family.ryadom.app;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
public final class GraffMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token){PushController.register(this,token);}
    @Override public void onMessageReceived(RemoteMessage message){PushController.show(this,message.getData());}
}

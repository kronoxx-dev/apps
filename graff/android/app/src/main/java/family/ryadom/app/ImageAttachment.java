package family.ryadom.app;
import android.content.Context;
import android.graphics.*;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import org.json.JSONObject;
import java.io.*;
import java.nio.ByteBuffer;
final class ImageAttachment {
 static JSONObject read(Context context,Uri uri)throws Exception{
  if(uri==null||!"content".equals(uri.getScheme()))throw new IOException();
  byte[] data;
  try(InputStream in=context.getContentResolver().openInputStream(uri);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
   byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){bytes.write(buffer,0,n);if(bytes.size()>32*1024*1024)throw new IOException("Изображение больше 32 МБ");}data=bytes.toByteArray();
  }
  Bitmap bitmap;
  if(Build.VERSION.SDK_INT>=28){
   bitmap=ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(data)),(decoder,info,source)->{
    int w=info.getSize().getWidth(),h=info.getSize().getHeight();float factor=Math.min(1f,1920f/Math.max(w,h));
    decoder.setTargetSize(Math.max(1,Math.round(w*factor)),Math.max(1,Math.round(h*factor)));decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
   });
  }else{
   BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(data,0,data.length,options);
   if(options.outWidth<1||options.outHeight<1)throw new IOException();options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>1920)options.inSampleSize*=2;options.inJustDecodeBounds=false;
   bitmap=BitmapFactory.decodeByteArray(data,0,data.length,options);if(bitmap==null)throw new IOException();
   try{android.media.ExifInterface exif=new android.media.ExifInterface(new ByteArrayInputStream(data));int o=exif.getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION,1);Matrix m=new Matrix();switch(o){case 2:m.setScale(-1,1);break;case 3:m.setRotate(180);break;case 4:m.setScale(1,-1);break;case 5:m.setRotate(90);m.postScale(-1,1);break;case 6:m.setRotate(90);break;case 7:m.setRotate(-90);m.postScale(-1,1);break;case 8:m.setRotate(-90);break;}Bitmap rotated=Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),m,true);if(rotated!=bitmap){bitmap.recycle();bitmap=rotated;}}catch(IOException ignored){}
  }
  Bitmap flattened=Bitmap.createBitmap(bitmap.getWidth(),bitmap.getHeight(),Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(flattened);canvas.drawColor(Color.WHITE);canvas.drawBitmap(bitmap,0,0,null);bitmap.recycle();
  try{ByteArrayOutputStream encoded=new ByteArrayOutputStream();for(int quality=88;quality>=48;quality-=10){encoded.reset();flattened.compress(Bitmap.CompressFormat.JPEG,quality,encoded);if(encoded.size()<=2*1024*1024)break;}
   if(encoded.size()>2*1024*1024)throw new IOException("Выберите фото поменьше");
   return new JSONObject().put("image",Base64.encodeToString(encoded.toByteArray(),Base64.NO_WRAP)).put("width",flattened.getWidth()).put("height",flattened.getHeight());
  }finally{flattened.recycle();}
 }
}

'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const dataDir=path.resolve(root,'../data');
const config=JSON.parse(fs.readFileSync(path.resolve(root,'../config.json'),'utf8'));
process.env.WHISPER_BINARY=path.resolve(root,'../runtime/whisper-build/bin/whisper-cli');
process.env.WHISPER_MODEL=path.resolve(root,'../runtime/ggml-base.bin');
process.env.FFMPEG_PATH='/usr/local/bin/ffmpeg';
import('./server/server.mjs').then(({createMessenger})=>{
  const app=createMessenger({dataDir,basePath:'/graff',publicOrigin:'https://kronoxx.ru',bootstrapCode:config.bootstrapCode,firebaseServiceAccountPath:fs.existsSync(path.resolve(root,'../firebase-service-account.json'))?path.resolve(root,'../firebase-service-account.json'):undefined});
  app.server.listen(3000);
}).catch(error=>{console.error('Graff startup failed:',error.message);process.exit(1);});

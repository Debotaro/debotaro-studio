import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { createStudioServer } from './app';
if(existsSync('.env'))process.loadEnvFile('.env');
const port=Number(process.env.PORT||4173);
const production=process.argv.includes('--production');
const studio=createStudioServer({directory:resolve(process.env.STUDIO_DATA_DIR||'.studio-data'),origin:process.env.STUDIO_ORIGIN,allowDevSocket:!production});
let stopVite=async()=>{};
studio.app.use('/screenshots',express.static(resolve('docs/screenshots')));
if(process.argv.includes('--production')){
  // Catalog preview has an opaque sandbox origin. Built assets are public;
  // document/auth endpoints never receive this CORS header.
  studio.app.use('/assets',express.static(resolve('dist/assets'),{setHeaders:res=>res.setHeader('Access-Control-Allow-Origin','*')}));
  studio.app.use(express.static(resolve('dist')));
  studio.app.get('/',(_req,res)=>res.sendFile(resolve('dist/index.html')));
  studio.app.get('/case-study',(_req,res)=>res.sendFile(resolve('dist/index.html')));
}else{
  const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true,ws:{server:studio.server,path:'/__vite/'},forwardConsole:false},appType:'spa'});stopVite=()=>vite.close();studio.app.use(vite.middlewares);
}
studio.server.listen(port,process.env.STUDIO_HOST||'127.0.0.1',()=>process.stdout.write(`Debotaro Studio: http://localhost:${port}\n`));
for(const event of ['SIGINT','SIGTERM']as const)process.once(event,()=>{void stopVite().then(()=>studio.close()).then(()=>process.exit(0));});

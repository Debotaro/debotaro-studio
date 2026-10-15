import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { createStudioServer } from './app';
import { limitsFromEnv } from './limits';
if(existsSync('.env'))process.loadEnvFile('.env');
const port=Number(process.env.PORT||4173);
const production=process.argv.includes('--production');
const host=process.env.STUDIO_HOST||'127.0.0.1';
const origin=process.env.STUDIO_ORIGIN;
if(!['127.0.0.1','localhost','::1'].includes(host)&&!origin)throw new Error('Set STUDIO_ORIGIN to the exact public HTTP(S) origin before binding Studio outside loopback.');
if(origin){const parsed=new URL(origin);if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)throw new Error('STUDIO_ORIGIN must be an exact HTTP(S) origin without credentials, path, query or trailing slash.');}
const studio=createStudioServer({directory:resolve(process.env.STUDIO_DATA_DIR||'.studio-data'),origin,allowDevSocket:!production,limits:limitsFromEnv(process.env)});
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
studio.server.listen(port,host,()=>process.stdout.write(`Debotaro Studio: http://localhost:${port}\n`));
for(const event of ['SIGINT','SIGTERM']as const)process.once(event,()=>{void stopVite().then(()=>studio.close()).then(()=>process.exit(0));});

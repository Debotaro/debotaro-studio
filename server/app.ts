import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { zipSync, strToU8 } from 'fflate';
import { z } from 'zod';
import { createStarterDocument } from '../src/core/starter';
import { generateProject } from '../src/export/project';
import type { OperationEnvelope, User } from '../src/core/types';
import { Store } from './store';
import { SyncEngine, type Submission } from './sync';
import { aiStatus, proposeChanges, selectedOperations } from './ai';

const identity = z.object({name:z.string().trim().min(1).max(60)}).strict();
const invitation = z.object({token:z.string().regex(/^[a-f0-9]{48}$/),name:z.string().trim().min(1).max(60)}).strict();
const submissionSchema = z.object({envelope:z.object({id:z.string().uuid(),projectId:z.string().min(1).max(100),baseRevision:z.number().int().min(0),label:z.string().min(1).max(160),operations:z.array(z.unknown()).min(1).max(100)}).strict(),expected:z.record(z.string().max(200),z.string().max(100000)).optional(),strict:z.boolean().optional()}).strict();
export function createStudioServer(options:{directory:string;origin?:string;allowDevSocket?:boolean}) {
  const store=new Store(options.directory), engine=new SyncEngine(store);
  const app=express();app.disable('x-powered-by');app.use(express.json({limit:'2mb'}));
  const server=createServer(app);const wss=new WebSocketServer({noServer:true,maxPayload:2*1024*1024});
  const peers=new Map<WebSocket,{user:User;projectId:string;selection:string|null;sessionToken:string}>();
  const tokenFrom=(req:Request|{headers:Record<string,string|string[]|undefined>})=>String(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith('studio_session='))?.slice(15)??'';
  const session=(req:Request)=>store.userForSession(tokenFrom(req));
  const originFor=(req:Request)=>options.origin??`${req.protocol}://${req.get('host')}`;
  const auth=(req:Request)=>{const user=session(req);if(!user)throw Object.assign(new Error('Sign in to access this project'),{status:401});return user;};
  const access=(req:Request,edit=false,owner=false)=>{const user=auth(req),role=store.role(String(req.params.id),user.id);if(!role||(edit&&role==='viewer')||(owner&&role!=='owner'))throw Object.assign(new Error('Project permission denied'),{status:403});return user;};
  const cookie=(res:Response,token:string)=>res.cookie('studio_session',token,{httpOnly:true,sameSite:'strict',secure:options.origin?.startsWith('https://')??false,maxAge:30*86400000,path:'/'});
  app.use('/api',(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD'].includes(req.method)&&((req.get('origin')&&req.get('origin')!==originFor(req))||req.get('sec-fetch-site')==='cross-site'||req.get('x-studio-request')!=='1')){res.status(403).json({error:'Request origin denied'});return;}next();
  });
  const send=(ws:WebSocket,payload:unknown)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(payload));};
  const authorized=(peer:{user:User;projectId:string;sessionToken:string})=>store.userForSession(peer.sessionToken)?.id===peer.user.id&&Boolean(store.role(peer.projectId,peer.user.id));
  const presence=(projectId:string)=>{const live=[...peers].filter(([ws,peer])=>{if(peer.projectId!==projectId)return false;if(!authorized(peer)){ws.close(4003,'Access revoked or session expired');return false;}return true;});const people=live.map(([,p])=>({id:p.user.id,name:p.user.name,selection:p.selection,role:store.role(projectId,p.user.id)}));for(const [ws]of live)send(ws,{type:'presence',people});};
  const broadcast=(projectId:string,opId?:string)=>{const state=engine.state(projectId);for(const[ws,p]of peers)if(p.projectId===projectId){if(authorized(p))send(ws,{type:'state',state,opId});else ws.close(4003,'Access revoked or session expired');}};
  app.get('/api/health',(_req,res)=>res.json({ok:true}));
  app.get('/api/session',(req,res)=>{const user=session(req);res.json({user,projects:user?store.projects(user.id):[]});});
  app.post('/api/demo',(req,res)=>{const body=identity.parse(req.body);const user=session(req)??store.createUser(body.name);if(!session(req))cookie(res,store.createSession(user));const document=createStarterDocument(randomUUID());store.createProject(document,user);res.status(201).json({user,document,role:'owner'});});
  app.post('/api/join',(req,res)=>{const body=invitation.parse(req.body),user=session(req)??store.createUser(body.name);const projectId=store.join(body.token,user);if(!session(req))cookie(res,store.createSession(user));res.json({user,document:store.readDocument(projectId),role:store.role(projectId,user.id)});});
  app.get('/api/projects/:id',(req,res)=>{const user=access(req);res.json({document:store.readDocument(String(req.params.id)),role:store.role(String(req.params.id),user.id)});});
  app.post('/api/projects/:id/operations',(req,res)=>{const user=access(req,true),input=submissionSchema.parse(req.body)as Submission;const doc=engine.submit(user,String(req.params.id),input);broadcast(doc.id,input.envelope.id);res.json({document:doc});});
  app.post('/api/projects/:id/undo',(req,res)=>{const result=engine.undo(access(req,true),String(req.params.id));broadcast(result.document.id);res.json(result);});
  app.post('/api/projects/:id/invitations',(req,res)=>{access(req,false,true);const {role}=z.object({role:z.enum(['editor','viewer'])}).strict().parse(req.body);res.json({token:store.invitation(String(req.params.id),role)});});
  app.get('/api/projects/:id/members',(req,res)=>{access(req);res.json(store.members(String(req.params.id)));});
  app.patch('/api/projects/:id/members/:userId',(req,res)=>{access(req,false,true);const{role}=z.object({role:z.enum(['editor','viewer']).nullable()}).strict().parse(req.body);const id=String(req.params.id);store.setRole(id,String(req.params.userId),role);for(const[ws,p]of peers)if(p.projectId===id&&p.user.id===req.params.userId)ws.close(4003,'Permissions changed; reconnect to refresh access');presence(id);res.json({ok:true});});
  app.get('/api/projects/:id/versions',(req,res)=>{access(req);res.json(store.versions(String(req.params.id)));});
  app.post('/api/projects/:id/versions',(req,res)=>{const user=access(req,true),{label}=z.object({label:z.string().trim().min(1).max(120)}).strict().parse(req.body);res.status(201).json(store.saveVersion(store.readDocument(String(req.params.id)),user.name,label));});
  app.post('/api/projects/:id/restore',(req,res)=>{const user=access(req,true);const{versionId,baseRevision}=z.object({versionId:z.string().uuid(),baseRevision:z.number().int().min(0)}).strict().parse(req.body);const id=String(req.params.id);const version=store.versions(id).find(v=>v.id===versionId);if(!version)throw new Error('Version not found');const envelope:OperationEnvelope={id:randomUUID(),projectId:id,baseRevision,label:`Restore: ${version.label}`,operations:[{type:'replace',document:{...version.document,revision:baseRevision}}]};const doc=engine.submit(user,id,{envelope,strict:true});broadcast(id);res.json({document:doc});});
  app.get('/api/projects/:id/history',(req,res)=>{access(req);res.json(store.db.prepare('SELECT h.id,h.label,h.revision,h.created,u.name AS actor FROM history h JOIN users u ON h.user_id=u.id WHERE project_id=? ORDER BY revision DESC LIMIT 100').all(String(req.params.id)));});
  app.post('/api/projects/:id/export',async(req,res)=>{access(req);const{code,baseRevision}=z.object({code:z.string().max(2000000).optional(),baseRevision:z.number().int().min(0)}).strict().parse(req.body);const doc=store.readDocument(String(req.params.id));if(doc.revision!==baseRevision)throw new Error('Export revision changed; refresh before exporting');const files=await generateProject(doc,code);const zip=zipSync(Object.fromEntries(Object.entries(files).map(([path,text])=>[path,strToU8(text)])));res.setHeader('Content-Disposition','attachment; filename="debotaro-workspace.zip"');res.type('application/zip').send(Buffer.from(zip));});
  app.get('/api/ai/status',(_req,res)=>res.json(aiStatus()));
  app.post('/api/projects/:id/ai/propose',async(req,res)=>{
    const user=access(req,true),id=String(req.params.id);const{prompt,baseRevision}=z.object({prompt:z.string().trim().min(1).max(4000),baseRevision:z.number().int().min(0)}).strict().parse(req.body);
    const doc=store.readDocument(id);if(doc.revision!==baseRevision)throw new Error('Project changed. Request a proposal using the current design.');
    const controller=new AbortController();const cancelled=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancelled);
    try{const proposal=await proposeChanges({document:doc,prompt,signal:controller.signal,role:store.role(id,user.id)!});access(req,true);if(store.readDocument(id).revision!==baseRevision)throw new Error('Project changed while the model was responding. Request a new proposal.');res.json(proposal);}
    finally{res.off('close',cancelled);}
  });
  app.post('/api/projects/:id/ai/apply',(req,res)=>{
    const user=access(req,true),id=String(req.params.id);const{proposal,groups}=z.object({proposal:z.unknown(),groups:z.array(z.string().max(80)).min(1).max(12)}).strict().parse(req.body);
    const doc=store.readDocument(id);const operations=selectedOperations(proposal as Parameters<typeof selectedOperations>[0],groups,doc,store.role(id,user.id)!);
    const result=engine.submit(user,id,{envelope:{id:randomUUID(),projectId:id,baseRevision:doc.revision,label:'Reviewed AI proposal',operations},strict:true});broadcast(id);res.json({document:result});
  });
  app.use('/api',(_req,res)=>res.status(404).json({error:'API resource not found'}));
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{const e=error as Error&{status?:number};res.status(e.status??400).json({error:e instanceof z.ZodError?'Request does not match the allowed schema':e.message||'Request failed'});});
  server.on('upgrade',(req,socket,head)=>{
    const url=new URL(req.url??'/',`http://${req.headers.host}`),user=store.userForSession(tokenFrom(req));const projectId=url.searchParams.get('projectId')??'';
    const allowedOrigin=options.origin??`http://${req.headers.host}`;
    if(options.allowDevSocket&&url.pathname==='/__vite/'&&['vite-hmr','vite-ping'].includes(String(req.headers['sec-websocket-protocol'])))return;
    if(url.pathname!=='/collaborate'||req.headers.origin!==allowedOrigin||!user||!store.role(projectId,user.id)){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
    let initialState:string;
    try{initialState=engine.state(projectId);}catch{socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>{
      peers.set(ws,{user,projectId,selection:null,sessionToken:tokenFrom(req)});send(ws,{type:'state',state:initialState});presence(projectId);
      ws.on('message',raw=>{
        try{
          if(!store.userForSession(tokenFrom(req))||!store.role(projectId,user.id)){ws.close(4003,'Access revoked or session expired');return;}
          const message=z.object({type:z.enum(['operation','presence','sync']),payload:z.unknown().optional()}).strict().parse(JSON.parse(raw.toString()));
          if(message.type==='operation'){const input=submissionSchema.parse(message.payload)as Submission;engine.submit(user,projectId,input);broadcast(projectId,input.envelope.id);}
          if(message.type==='sync')send(ws,{type:'state',state:engine.state(projectId)});
          if(message.type==='presence'){const {selection}=z.object({selection:z.string().max(100).nullable()}).strict().parse(message.payload);peers.get(ws)!.selection=selection;presence(projectId);}
        }catch(error){let opId:string|undefined;try{opId=JSON.parse(raw.toString()).payload?.envelope?.id;}catch{/* invalid input carries no operation id */}send(ws,{type:'error',opId,error:error instanceof Error?error.message:'Invalid message'});}
      });ws.on('close',()=>{peers.delete(ws);presence(projectId);});
    });
  });
  const close=async()=>{for(const ws of peers.keys())ws.terminate();peers.clear();await new Promise<void>(resolve=>wss.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));engine.destroy();store.close();};
  return {app,server,store,engine,broadcast,access,close};
}

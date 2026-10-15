import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { validateDocument, applyOperations } from '../core/document';
import { touchedValues } from '../core/preconditions';
import type { StudioDocument, Operation, Role, User } from '../core/types';
import { api } from './api';
import { readRecovery, writeRecovery, type PendingEdit } from './persistence';
import { validateRecoveryQueue } from './recovery';
export interface Presence {id:string;name:string;selection:string|null;role:Role}
export function useProject(projectId:string,user:User){
  const [document,setDocument]=useState<StudioDocument|null>(null),[role,setRole]=useState<Role>('viewer');
  const [status,setStatus]=useState('Connecting'),[error,setError]=useState(''),[people,setPeople]=useState<Presence[]>([]),[pending,setPending]=useState(0);
  const socket=useRef<WebSocket|null>(null),authoritative=useRef<StudioDocument|null>(null),queue=useRef<PendingEdit[]>([]),inflight=useRef<string|null>(null),blocked=useRef(false),draftFields=useRef({}),recoveryInput=useRef<unknown>(null);
  const key=`${user.id}:${projectId}`;
  useEffect(()=>{
    let cancelled=false,retry:ReturnType<typeof setTimeout>|undefined;let ydoc=new Y.Doc();
    const persist=()=>{const doc=authoritative.current;if(doc)void writeRecovery(key,{document:doc,queue:queue.current,...draftFields.current}).catch(()=>setError('Browser recovery could not be saved. Download recovery before closing.'));};
    const show=()=>{
      let doc=authoritative.current;if(!doc)return;
      for(const edit of queue.current){try{doc=applyOperations(doc,{...edit.envelope,baseRevision:doc.revision});}catch{break;}}
      setDocument(doc);setPending(queue.current.length);persist();
    };
    const flush=()=>{if(!blocked.current&&socket.current?.readyState===WebSocket.OPEN&&!inflight.current&&queue.current[0]){inflight.current=queue.current[0].envelope.id;socket.current.send(JSON.stringify({type:'operation',payload:queue.current[0]}));}};
    const connect=()=>{
      if(cancelled)return;if(!navigator.onLine){setStatus('Offline · edits saved');retry=setTimeout(connect,1500);return;}const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/collaborate?projectId=${encodeURIComponent(projectId)}`);socket.current=ws;
      ws.onopen=()=>{setStatus('Live');inflight.current=null;};
      ws.onmessage=event=>{
        try{
          if(typeof event.data!=='string'||event.data.length>6000000)throw new Error('Invalid synchronization payload');
          const message=JSON.parse(event.data);
          if(message.type==='state'){
            if(typeof message.state!=='string')throw new Error('Invalid synchronized state');
            const bytes=Uint8Array.from(atob(message.state),(c)=>c.charCodeAt(0));Y.applyUpdate(ydoc,bytes);
            const value=ydoc.getMap('studio').get('document');if(typeof value!=='string')throw new Error('Missing synchronized document');
            authoritative.current=validateDocument(JSON.parse(value));
            if(message.opId){queue.current=queue.current.filter(edit=>edit.envelope.id!==message.opId);if(inflight.current===message.opId)inflight.current=null;}
            show();flush();
          }else if(message.type==='presence'&&Array.isArray(message.people))setPeople(message.people.filter((person:Presence)=>typeof person.id==='string'&&typeof person.name==='string'));
          else if(message.type==='error'){blocked.current=true;inflight.current=null;setError(String(message.error));setStatus('Needs review');persist();}
        }catch(e){setError(e instanceof Error?e.message:'Synchronization failed');}
      };
      ws.onclose=event=>{inflight.current=null;if(cancelled)return;if(event.code===4003){setStatus('Access changed');setRole('viewer');setError('Your permissions changed. Refresh to check current access.');return;}setStatus('Offline · edits saved');retry=setTimeout(connect,1500);};
      ws.onerror=()=>setStatus('Offline · edits saved');
    };
    setDocument(null);setError('');blocked.current=false;queue.current=[];authoritative.current=null;setStatus('Connecting');
    void(async()=>{
      try{
        try {
          const saved=await readRecovery(key);if(cancelled)return;recoveryInput.current=saved;
          if(saved){
            draftFields.current={draft:saved.draft,draftBase:saved.draftBase,draftDirty:saved.draftDirty,lastDiscardedDraft:saved.lastDiscardedDraft,archivedRecovery:saved.archivedRecovery};
            try{const snapshot=validateDocument(saved.document);const recoveredQueue=validateRecoveryQueue(saved.queue??[],snapshot);authoritative.current=snapshot;queue.current=recoveredQueue;show();}
            catch{authoritative.current=null;queue.current=[];draftFields.current={...draftFields.current,archivedRecovery:saved};setError('Browser recovery is corrupt or incompatible. Its original record is retained for download; loading the saved server workspace.');}
          }
        } catch { if(cancelled)return;setError('Browser recovery could not be read. Loading the saved server workspace; preserve browser data before resetting.'); }
        const value=await api<{document:StudioDocument;role:Role}>(`/api/projects/${projectId}`);if(cancelled)return;authoritative.current=validateDocument(value.document);setRole(value.role);show();connect();
      }catch(e){setError(e instanceof Error?e.message:'Project unavailable');setStatus('Unavailable');if(authoritative.current)connect();}
    })();
    const onOnline=()=>{if(socket.current?.readyState===WebSocket.CLOSED){clearTimeout(retry);ydoc.destroy();ydoc=new Y.Doc();connect();}};window.addEventListener('online',onOnline);
    const onOffline=()=>{socket.current?.close(1000,'Offline');setStatus('Offline · edits saved');};window.addEventListener('offline',onOffline);
    const heartbeat=setInterval(flush,500);
    return()=>{cancelled=true;clearTimeout(retry);clearInterval(heartbeat);window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline);socket.current?.close();socket.current=null;ydoc.destroy();};
  },[projectId,key]);
  const propose=(operations:Operation[],label:string,strict=false,base?:StudioDocument)=>{
    if(role==='viewer')throw new Error('Viewers cannot edit');if(blocked.current)throw new Error('Resolve the pending conflict before editing');if(!document)throw new Error('Project not ready');
    const doc=base??document;const edit:PendingEdit={envelope:{id:crypto.randomUUID(),projectId,baseRevision:doc.revision,label,operations},expected:touchedValues(doc,operations),strict};
    const next=applyOperations(document,{...edit.envelope,baseRevision:document.revision});queue.current.push(edit);setDocument(next);setPending(queue.current.length);
    if(authoritative.current)void writeRecovery(key,{document:authoritative.current,queue:queue.current,...draftFields.current}).catch(()=>setError('Recovery save failed'));
    if(socket.current?.readyState===WebSocket.OPEN&&!inflight.current){inflight.current=edit.envelope.id;socket.current.send(JSON.stringify({type:'operation',payload:edit}));}
  };
  const discardPending=()=>{queue.current=[];inflight.current=null;blocked.current=false;setError('');setPending(0);setStatus(socket.current?.readyState===WebSocket.OPEN?'Live':'Offline · edits saved');if(authoritative.current){setDocument(authoritative.current);void writeRecovery(key,{document:authoritative.current,queue:[],...draftFields.current});}};
  const saveDraft=useCallback((fields:object)=>{draftFields.current={...draftFields.current,...fields};if(authoritative.current)void writeRecovery(key,{document:authoritative.current,queue:queue.current,...draftFields.current}).catch(()=>setError('Draft recovery save failed'));},[key]);
  const select=(selection:string|null)=>{if(socket.current?.readyState===WebSocket.OPEN)socket.current.send(JSON.stringify({type:'presence',payload:{selection}}));};
  return {document,role,status,error,setError,people,pending,propose,discardPending,saveDraft,select,recoveryKey:key,refresh:async()=>{const data=await api<{document:StudioDocument;role:Role}>(`/api/projects/${projectId}`);authoritative.current=data.document;setDocument(data.document);setRole(data.role);},getRecovery:()=>({document,queue:queue.current,...draftFields.current,storedRecovery:recoveryInput.current})};
}

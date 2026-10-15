import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioRuntime } from './runtime/StudioRuntime';
import { validateDocument } from './core/document';
import type { StudioDocument, Breakpoint } from './core/types';
import './runtime/runtime.css';
const nonce=location.hash.slice(1);
function PreviewApp(){
  const [config,setConfig]=useState<{document:StudioDocument;breakpoint:Breakpoint;selectedId:string;designMode:boolean}|null>(null);
  useEffect(()=>{const listen=(event:MessageEvent)=>{if(event.source!==parent||event.data?.nonce!==nonce||event.data.type!=='document')return;try{const document=validateDocument(event.data.document);if(!['desktop','tablet','phone'].includes(event.data.breakpoint))return;setConfig({document,breakpoint:event.data.breakpoint,selectedId:typeof event.data.selectedId==='string'?event.data.selectedId:'',designMode:event.data.designMode===true});}catch{/* Refuse invalid preview payload; retain last valid view. */}};window.addEventListener('message',listen);parent.postMessage({type:'ready',nonce},'*');return()=>window.removeEventListener('message',listen);},[]);
  if(!config)return <p style={{fontFamily:'system-ui',padding:24}}>Preparing workspace…</p>;
  return <StudioRuntime {...config} onSelect={nodeId=>parent.postMessage({type:'select',nonce,nodeId},'*')}/>;
}
createRoot(document.getElementById('root')!).render(<PreviewApp/>);

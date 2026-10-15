import { useEffect, useRef, useState } from 'react';
import type { StudioDocument, Breakpoint } from '../core/types';
export function Preview({document,breakpoint,selectedId,onSelect,designMode}:{document:StudioDocument;breakpoint:Breakpoint;selectedId:string;onSelect:(id:string)=>void;designMode:boolean}){
  const frame=useRef<HTMLIFrameElement>(null);const[nonce]=useState(()=>crypto.randomUUID());const[ready,setReady]=useState(0);
  useEffect(()=>{
    const listen=(event:MessageEvent)=>{if(event.source!==frame.current?.contentWindow||event.data?.nonce!==nonce)return;if(event.data.type==='ready')setReady(value=>value+1);if(event.data.type==='select'&&typeof event.data.nodeId==='string'&&document.nodes[event.data.nodeId])onSelect(event.data.nodeId);};window.addEventListener('message',listen);return()=>window.removeEventListener('message',listen);
  },[nonce,onSelect,document.nodes]);
  useEffect(()=>{if(ready)frame.current?.contentWindow?.postMessage({type:'document',nonce,document,breakpoint,selectedId,designMode},'*');},[document,breakpoint,selectedId,designMode,nonce,ready]);
  return <iframe ref={frame} title="Support workspace preview" className="preview-frame" sandbox="allow-scripts" src={`/preview.html#${nonce}`} onLoad={()=>{setReady(value=>value+1);}}/>;
}

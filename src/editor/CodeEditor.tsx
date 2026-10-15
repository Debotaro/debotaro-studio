import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
export function CodeEditor({value,onChange,readOnly=false}:{value:string;onChange:(value:string)=>void;readOnly?:boolean}){
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),callback=useRef(onChange),updating=useRef(false);callback.current=onChange;
  useEffect(()=>{
    if(!host.current)return;
    const editor=new EditorView({parent:host.current,state:EditorState.create({doc:value,extensions:[lineNumbers(),highlightActiveLineGutter(),history(),keymap.of([...defaultKeymap,...historyKeymap]),javascript({jsx:true,typescript:true}),EditorState.readOnly.of(readOnly),EditorView.contentAttributes.of({'aria-label':'React TypeScript code editor'}),EditorView.updateListener.of(update=>{if(update.docChanged&&!updating.current)callback.current(update.state.doc.toString());}),EditorView.theme({'&':{height:'100%',fontSize:'12px'},'.cm-scroller':{overflow:'auto',fontFamily:'Consolas, monospace'},'.cm-content':{padding:'18px 0'},'.cm-gutters':{background:'#f5f5f8',border:'0',color:'#999'}})]})});view.current=editor;return()=>{editor.destroy();view.current=null;};
  // Initial value updates are dispatched below; remount only for permission changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[readOnly]);
  useEffect(()=>{const editor=view.current;if(editor&&editor.state.doc.toString()!==value){updating.current=true;editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:value}});updating.current=false;}},[value]);
  return <div className="code-editor" ref={host}/>;
}

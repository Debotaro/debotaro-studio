import { useEffect,useState } from 'react';
import { catalog,type PropRule } from '../core/document';
import type { StudioNode,JsonValue } from '../core/types';
export function ComponentProperties({node,onChange}:{node:StudioNode;onChange:(props:StudioNode['props'])=>void}){
  const set=(name:string,value:JsonValue|undefined)=>{const props={...node.props};if(value===undefined)delete props[name];else props[name]=value;onChange(props);};
  return <>{Object.entries(catalog[node.type].props).map(([name,rule])=><PropertyInput key={`${node.id}:${name}`} name={name} rule={rule} value={node.props[name]} onChange={value=>set(name,value)}/>)}</>;
}
function PropertyInput({name,rule,value,onChange}:{name:string;rule:PropRule;value:JsonValue|undefined;onChange:(value:JsonValue|undefined)=>void}){
  const json=rule.kind==='options'||rule.kind==='columns';const source=json?JSON.stringify(value??[],null,2):String(value??'');
  const [draft,setDraft]=useState(source),[error,setError]=useState('');useEffect(()=>{setDraft(source);setError('');},[source]);
  if(rule.kind==='boolean')return <label className="check-field"><input type="checkbox" checked={value===true} onChange={event=>onChange(event.target.checked)}/>{name}</label>;
  if(rule.kind==='enum')return <label className="edit-field"><span>{name}</span><select aria-label={name} value={String(value??'')} onChange={event=>onChange(event.target.value||undefined)}><option value="">Default</option>{rule.values?.map(option=><option key={option}>{option}</option>)}</select></label>;
  const commit=()=>{if(source===draft)return;try{onChange(draft===''?undefined:json?JSON.parse(draft) as JsonValue:rule.kind==='number'&&!draft.startsWith('$')?Number(draft):draft);setDraft(source);setError('');}catch{setError(json?'Enter valid JSON for this property.':'Enter a number or a numeric token reference.');}};
  return <div><label className={json?'stacked-field':'edit-field'}><span>{name}{json?' (JSON)':''}</span>{json?<textarea aria-label={`${name} JSON`} value={draft} rows={4} onChange={event=>setDraft(event.target.value)} onBlur={commit}/>:<input aria-label={name} value={draft} placeholder="Default" onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/>}</label>{error&&<p className="error" role="alert">{error}</p>}</div>;
}

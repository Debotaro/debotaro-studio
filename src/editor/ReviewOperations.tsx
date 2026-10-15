import type { Operation,StudioDocument } from '../core/types';
export function describeOperation(op:Operation,document:StudioDocument):string{
  const name=(id:string)=>document.nodes[id]?.name??id;
  switch(op.type){
    case 'insert':return `Add ${op.node.type} “${op.node.name}” inside ${name(op.parentId)}`;
    case 'update':return `Change ${name(op.nodeId)}: ${Object.entries(op.patch).map(([key,value])=>key==='props'&&value&&typeof value==='object'?Object.keys(value).join(', '):key).join(', ')}`;
    case 'move':return `Move ${name(op.nodeId)} into ${name(op.parentId)}, position ${op.index+1}`;
    case 'delete':return `Delete ${name(op.nodeId)} and its nested layers`;
    case 'token':return `Set ${op.category} token ${op.name} to ${op.value}`;
    case 'theme':return `Use the ${op.theme} application theme`;
    case 'replace':return 'Replace the document with the inspected version';
  }
}
export function ReviewOperations({operations,document}:{operations:Operation[];document:StudioDocument}){
  return <ol className="operation-review">{operations.map((operation,index)=><li key={index}>{describeOperation(operation,document)}</li>)}</ol>;
}

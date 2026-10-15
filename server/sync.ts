import * as Y from 'yjs';
import { randomUUID } from 'node:crypto';
import { applyOperations, serializeDocument } from '../src/core/document';
import type { StudioDocument, Operation, OperationEnvelope, User } from '../src/core/types';
import type { Store } from './store';

export interface Submission { envelope: OperationEnvelope; expected?: Record<string,string>; strict?: boolean }
import { touchedValues } from '../src/core/preconditions';
export { touchedValues } from '../src/core/preconditions';
export class SyncEngine {
  private rooms = new Map<string,Y.Doc>();
  constructor(readonly store: Store){}
  room(projectId:string){
    let room=this.rooms.get(projectId);
    if(!room){
      const canonical=serializeDocument(this.store.readDocument(projectId));
      const row=this.store.db.prepare('SELECT ystate FROM projects WHERE id=?').get(projectId);
      room=new Y.Doc();
      if(row?.ystate instanceof Uint8Array){
        try{Y.applyUpdate(room,row.ystate);if(room.getMap('studio').get('document')!==canonical)throw new Error('Snapshot mismatch');}
        catch{room.destroy();throw new Error('Saved collaboration state is corrupt or incompatible. Original data retained; restore a verified backup.');}
      }else{
        room.getMap('studio').set('document',canonical);
        this.store.db.prepare('UPDATE projects SET ystate=? WHERE id=?').run(Y.encodeStateAsUpdate(room),projectId);
      }
      this.rooms.set(projectId,room);
    }return room;
  }
  state(projectId:string){return Buffer.from(Y.encodeStateAsUpdate(this.room(projectId))).toString('base64');}
  submit(user:User,projectId:string,input:Submission){
    const role=this.store.role(projectId,user.id); if(role!=='owner'&&role!=='editor') throw new Error('Editing permission required');
    const envelope=input.envelope;
    if(envelope.projectId!==projectId) throw new Error('Project identity mismatch');
    const existing=this.store.db.prepare('SELECT project_id,user_id FROM history WHERE id=?').get(envelope.id);
    if(existing){if(existing.project_id!==projectId||existing.user_id!==user.id)throw new Error('Operation identity collision');return this.store.readDocument(projectId);}
    const before=this.store.readDocument(projectId);
    if(envelope.baseRevision!==before.revision){
      const eligible=envelope.baseRevision<before.revision&&!input.strict&&envelope.operations.length>0&&envelope.operations.every(op=>['update','token','theme'].includes(op.type));
      const actual=touchedValues(before,envelope.operations);
      if(!eligible||!input.expected||Object.keys(actual).length===0||Object.keys(actual).some(key=>input.expected?.[key]!==actual[key])) throw new Error('Conflict: project changed since this edit. Review current changes before retrying.');
    }
    const applied={...envelope,baseRevision:before.revision};
    const after=applyOperations(before,applied);
    // Persist first using a candidate CRDT; no room mutation if SQLite fails.
    const candidate=new Y.Doc();Y.applyUpdate(candidate,Y.encodeStateAsUpdate(this.room(projectId)));
    candidate.transact(()=>candidate.getMap('studio').set('document',serializeDocument(after)),user.id);
    const state=Y.encodeStateAsUpdate(candidate);this.store.writeDocument(after,state,user,applied,before);
    Y.applyUpdate(this.room(projectId),state);candidate.destroy();return after;
  }
  undo(user:User,projectId:string){
    const row=this.store.db.prepare('SELECT * FROM history WHERE project_id=? AND user_id=? AND undone=0 ORDER BY revision DESC LIMIT 1').get(projectId,user.id);
    if(!row)throw new Error('No change to undo');
    const before=JSON.parse(String(row.before_doc)) as StudioDocument, after=JSON.parse(String(row.after_doc)) as StudioDocument;
    const original=JSON.parse(String(row.envelope)) as OperationEnvelope;
    const current=this.store.readDocument(projectId);const inverses:Operation[]=[];
    const fieldOnly=original.operations.every(op=>['update','token','theme'].includes(op.type));
    if(fieldOnly){
      const expected=touchedValues(after,original.operations),actual=touchedValues(current,original.operations);
      if(Object.keys(expected).some(key=>expected[key]!==actual[key]))throw new Error('Undo conflict: another edit changed these fields. Other people’s work was retained.');
      for(const op of [...original.operations].reverse()){
        if(op.type==='update') inverses.push({type:'update',nodeId:op.nodeId,patch:Object.fromEntries(Object.keys(op.patch).map(key=>[key,before.nodes[op.nodeId][key as keyof typeof op.patch]]))});
        if(op.type==='token'&&Object.hasOwn(before.tokens[op.category],op.name)) inverses.push({type:'token',category:op.category,name:op.name,value:before.tokens[op.category][op.name]});
        if(op.type==='theme')inverses.push({type:'theme',theme:before.theme});
      }
      const newTokens=original.operations.filter(op=>op.type==='token'&&!Object.hasOwn(before.tokens[op.category],op.name));
      if(newTokens.length){
        const adjusted=structuredClone(current);
        for(const inverse of inverses){if(inverse.type==='update')Object.assign(adjusted.nodes[inverse.nodeId],inverse.patch);if(inverse.type==='token')adjusted.tokens[inverse.category][inverse.name]=inverse.value;if(inverse.type==='theme')adjusted.theme=inverse.theme;}
        for(const token of newTokens)if(token.type==='token')delete adjusted.tokens[token.category][token.name];
        inverses.splice(0,inverses.length,{type:'replace',document:adjusted});
      }
    }else{
      if(current.revision!==after.revision)throw new Error('Undo conflict: a structural change followed this edit. Inspect history before restoring.');
      inverses.push({type:'replace',document:{...before,revision:current.revision}});
    }
    const doc=this.submit(user,projectId,{envelope:{id:randomUUID(),projectId,baseRevision:current.revision,label:`Undo: ${row.label}`,operations:inverses},strict:true});
    this.store.db.prepare('UPDATE history SET undone=1 WHERE id=? OR (project_id=? AND revision=?)').run(row.id,projectId,doc.revision);
    return {document:doc,redoOperations:original.operations};
  }
  destroy(){for(const room of this.rooms.values())room.destroy();this.rooms.clear();}
}

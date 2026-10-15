import { openDB } from 'idb';
import type { StudioDocument, OperationEnvelope } from '../core/types';
export interface PendingEdit { envelope:OperationEnvelope;expected:Record<string,string>;strict:boolean }
export interface RecoveryRecord { document:StudioDocument; queue:PendingEdit[]; draft?:string; draftBase?:StudioDocument; draftDirty?:boolean;lastDiscardedDraft?:string;archivedRecovery?:unknown }
const database=openDB('debotaro-studio',1,{upgrade(db){db.createObjectStore('projects');}});
export async function readRecovery(key:string):Promise<RecoveryRecord|undefined>{return (await database).get('projects',key);}
export async function writeRecovery(key:string,value:RecoveryRecord){return(await database).put('projects',value,key);}

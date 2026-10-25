import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getDb } from '../db';
import { personas, messages, memories, chatSummaries } from '../../drizzle/schema';
import { chatContextStates as states, chatDeletionBackups as backups } from '../../drizzle/chat-context-schema';
import { memoryReviewProvenance as provenance } from '../../drizzle/memory-review-schema';
export type ContextState = typeof states.$inferSelect;
const scope = (userId: number, personaId: number) => and(eq(states.userId,userId),eq(states.personaId,personaId));
export function isIncluded(state: Pick<ContextState,'overrides'|'startAfterMessageId'>, id: number) { return state.overrides[String(id)] ?? id > state.startAfterMessageId; }
async function database(userId: number, personaId: number) {
  const db=await getDb();
  if (!db) throw new TRPCError({code:'INTERNAL_SERVER_ERROR',message:'数据库暂不可用。'});
  const owner=await db.select({id:personas.id}).from(personas).where(and(eq(personas.id,personaId),eq(personas.userId,userId))).limit(1);
  if (!owner.length) throw new TRPCError({code:'NOT_FOUND',message:'角色不存在。'});
  await db.insert(states).values({userId,personaId}).onConflictDoNothing();
  return db;
}
export async function getContextState(userId:number,personaId:number) {
  const db=await database(userId,personaId);
  return (await db.select().from(states).where(scope(userId,personaId)).limit(1))[0];
}
export async function getContextHistory(userId:number,personaId:number,limit=200) {
  const db=await database(userId,personaId);
  return db.transaction(async tx=>{
    const state=(await tx.select().from(states).where(scope(userId,personaId)).for('share'))[0];
    // Filter before the limit so excluded rows do not consume the context window.
    const included=sql`COALESCE((${JSON.stringify(state.overrides)}::jsonb ->> ${messages.id}::text)::boolean, ${messages.id} > ${state.startAfterMessageId})`;
    const rows=await tx.select().from(messages).where(and(eq(messages.userId,userId),eq(messages.personaId,personaId),included)).orderBy(desc(messages.id)).limit(limit);
    return {state,history:rows.reverse()};
  });
}
export async function withContextRevision<T>(userId:number,personaId:number,revision:number,work:(tx:any)=>Promise<T>):Promise<T> {
  const db=await database(userId,personaId);
  return db.transaction(async tx=>{
    const state=(await tx.select().from(states).where(scope(userId,personaId)).for('share'))[0];
    if(state.revision!==revision) throw new TRPCError({code:'CONFLICT',message:'对话上下文已变化，请重新发送。'});
    return work(tx);
  });
}
export async function contextOverview(userId:number,personaId:number,limit:number) {
  const db=await database(userId,personaId);const state=await getContextState(userId,personaId);
  const rows=await db.select().from(messages).where(and(eq(messages.userId,userId),eq(messages.personaId,personaId))).orderBy(desc(messages.id)).limit(limit);
  return {...state,messages:rows.map(row=>({...row,contextOverride:state.overrides[String(row.id)]??null,effectiveInContext:isIncluded(state,row.id)}))};
}
export async function changeContext(userId:number,personaId:number,action:'start'|'restore'|'include'|'delete'|'clear',input:{messageIds?:number[];included?:boolean|null;deleteLinkedMemories?:boolean}={}) {
  const db=await database(userId,personaId);
  return db.transaction(async tx=>{
    const state=(await tx.select().from(states).where(scope(userId,personaId)).for('update'))[0];
    const ids=Array.from(new Set(input.messageIds??[]));
    const rows=await tx.select().from(messages).where(and(eq(messages.userId,userId),eq(messages.personaId,personaId),action==='clear'?undefined:ids.length?inArray(messages.id,ids):eq(messages.id,-1))).orderBy(messages.id).for('update');
    if(ids.length!==rows.length&&action!=='clear') throw new TRPCError({code:'NOT_FOUND',message:'部分消息不存在或不属于当前角色。'});
    let start=state.startAfterMessageId;let overrides={...state.overrides};let deletedMemories=0;let backupId:number|null=null;
    if(action==='start') { const latest=await tx.select({id:messages.id}).from(messages).where(and(eq(messages.userId,userId),eq(messages.personaId,personaId))).orderBy(desc(messages.id)).limit(1);start=latest[0]?.id??0;overrides={}; }
    if(action==='restore'||action==='clear') {start=0;overrides={};}
    if(action==='include') for(const id of ids){ if(input.included==null)delete overrides[String(id)];else overrides[String(id)]=input.included; }
    if((action==='delete'||action==='clear')&&rows.length){
      const targetIds=rows.map(row=>row.id);const linked=await tx.select().from(provenance).where(and(eq(provenance.userId,userId),eq(provenance.personaId,personaId)));
      const linkedIds=linked.filter(row=>(row.evidence as any[]).some(ref=>ref.type==='message'&&targetIds.includes(ref.messageId))).map(row=>row.memoryId).filter((id):id is number=>id!==null);
      const ownedMemories=await tx.select().from(memories).where(and(eq(memories.userId,userId),eq(memories.personaId,personaId)));
      const removed=input.deleteLinkedMemories?ownedMemories.filter(row=>linkedIds.includes(row.id)||(row.messageId!==null&&targetIds.includes(row.messageId))):[];
      backupId=(await tx.insert(backups).values({userId,personaId,payload:{messages:rows,memories:removed,contextState:state,provenance:linked.filter(row=>row.memoryId!==null&&removed.some(memory=>memory.id===row.memoryId))}}).returning({id:backups.id}))[0].id;
      if(removed.length){await tx.delete(memories).where(and(eq(memories.userId,userId),eq(memories.personaId,personaId),inArray(memories.id,removed.map(row=>row.id))));deletedMemories=removed.length;}
      await tx.delete(messages).where(and(eq(messages.userId,userId),eq(messages.personaId,personaId),inArray(messages.id,targetIds)));
      targetIds.forEach(id=>delete overrides[String(id)]);
    }
    await tx.delete(chatSummaries).where(and(eq(chatSummaries.userId,userId),eq(chatSummaries.personaId,personaId)));
    await tx.update(states).set({startAfterMessageId:start,overrides,revision:state.revision+1,updatedAt:new Date()}).where(scope(userId,personaId));
    return {updated:rows.length,deletedMessages:action==='delete'||action==='clear'?rows.length:0,deletedMemories,backupId,startAfterMessageId:start,revision:state.revision+1};
  });
}

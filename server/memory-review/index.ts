import { MemoryReviewService, resolveEvidenceState } from './service';
import { createMemoryReviewRepository } from './repository';
export const memoryReviewRepository=createMemoryReviewRepository();
export const memoryReviewService=new MemoryReviewService(memoryReviewRepository);
export async function eligibleRealityMemories<T extends {id:number;userId:number;personaId:number;status?:string}>(rows:T[],userId:number,personaId:number):Promise<T[]> {
  const records=await memoryReviewRepository.provenance(userId,personaId,rows.map(row=>row.id));
  const result:T[]=[];
  for(const row of rows){
    if(row.userId!==userId||row.personaId!==personaId||(row.status??'active')!=='active')continue;
    const provenance=records.filter(record=>record.memoryId===row.id);
    let eligible=true;
    for(const record of provenance){
      if(record.kind!=='user_fact'||record.application!=='memory'){eligible=false;break;}
      // Manual confirmation establishes the reality scope; referenced evidence must still exist unchanged.
      for(const reference of record.evidence){
        const current=await memoryReviewRepository.resolveCurrentEvidence(userId,personaId,reference);
        const {hashValue}=await import('./core');
        if(reference.fingerprint&&(!current||hashValue(current.text)!==reference.fingerprint)){eligible=false;break;}
      }
    }
    if(eligible)result.push(row);
  }
  return result;
}

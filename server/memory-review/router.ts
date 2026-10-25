import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../_core/trpc';
import { MemoryReviewError } from './core';
import { memoryReviewService as service } from './index';
export const candidateFieldsSchema=z.object({
 kind:z.enum(['user_fact','source_fact','story_event']),title:z.string().min(1).max(200),description:z.string().min(1).max(2000),
 confidence:z.number().int().min(1).max(5),importance:z.number().int().min(1).max(5).optional(),source:z.string().max(24).optional(),memoryType:z.string().max(40).optional(),keywords:z.array(z.string().max(24)).max(12).optional(),emotion:z.string().max(120).optional(),
 sceneId:z.number().int().positive().nullable().optional(),factKey:z.string().max(120).nullable().optional(),date:z.string().max(50).nullable().optional(),category:z.enum(['memory','anchor','milestone','anniversary']).optional(),
 evidence:z.array(z.discriminatedUnion('type',[
 z.object({type:z.literal('message'),messageId:z.number().int().positive(),quote:z.string().max(800).optional()}),
 z.object({type:z.literal('source'),documentId:z.number().int().positive(),chunkIndex:z.number().int().nonnegative(),quote:z.string().max(800).optional()}),
 ])).max(8).optional(),
});
export async function reviewCall<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){if(error instanceof MemoryReviewError)throw new TRPCError({code:error.code,message:error.message});throw error;}}
const scope=z.object({personaId:z.number().int().positive()});const command=scope.extend({operationId:z.string().uuid()});const review=command.extend({candidateId:z.number().int().positive(),expectedRevision:z.number().int().positive()});
export const memoryReviewRouter=router({
 list:protectedProcedure.input(scope.extend({status:z.enum(['pending','accepted','rejected']).optional()})).query(({ctx,input})=>reviewCall(()=>service.list(ctx.user.id,input.personaId,input.status))),
 create:protectedProcedure.input(command.extend({fields:candidateFieldsSchema})).mutation(({ctx,input})=>reviewCall(()=>service.perform(ctx.user.id,{...input,action:'create'}))),
 edit:protectedProcedure.input(review.extend({fields:candidateFieldsSchema})).mutation(({ctx,input})=>reviewCall(()=>service.perform(ctx.user.id,{...input,action:'edit'}))),
 accept:protectedProcedure.input(review.extend({confirmWithoutEvidence:z.boolean().default(false)})).mutation(({ctx,input})=>reviewCall(()=>service.perform(ctx.user.id,{...input,action:'accept'}))),
 reject:protectedProcedure.input(review).mutation(({ctx,input})=>reviewCall(()=>service.perform(ctx.user.id,{...input,action:'reject'}))),
 reviewedFacts:protectedProcedure.input(scope.extend({kind:z.enum(['source_fact','story_event']),sceneId:z.number().int().positive().optional()})).query(({ctx,input})=>reviewCall(()=>service.reviewedFacts(ctx.user.id,input.personaId,input.kind,input.sceneId))),
});

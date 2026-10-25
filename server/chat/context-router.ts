import { z } from 'zod';
import { protectedProcedure } from '../_core/trpc';
import { changeContext, contextOverview } from './context-state';
const scope=z.object({personaId:z.number().int().positive()});
const selection=scope.extend({messageIds:z.array(z.number().int().positive()).min(1).max(500)});
export const contextProcedures={
  getContextState:protectedProcedure.input(scope.extend({limit:z.number().int().min(1).max(500).default(500)})).query(({ctx,input})=>contextOverview(ctx.user.id,input.personaId,input.limit)),
  startNewContext:protectedProcedure.input(scope).mutation(({ctx,input})=>changeContext(ctx.user.id,input.personaId,'start')),
  restoreAllContext:protectedProcedure.input(scope).mutation(({ctx,input})=>changeContext(ctx.user.id,input.personaId,'restore')),
  setContextInclusion:protectedProcedure.input(selection.extend({included:z.boolean().nullable()})).mutation(({ctx,input})=>changeContext(ctx.user.id,input.personaId,'include',input)),
  deleteMessages:protectedProcedure.input(selection.extend({deleteLinkedMemories:z.boolean().default(false),resetRuntimeCaches:z.boolean().default(true)})).mutation(({ctx,input})=>changeContext(ctx.user.id,input.personaId,'delete',input)),
};

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router, rateLimit } from '../_core/trpc';
import { RATE_LIMITS } from '../_core/rate-limit';
import { SourceLibraryError, SOURCE_LIBRARY_LIMITS } from './core';
import { sourceLibraryService as service } from './index';
const scope = z.object({ personaId: z.number().int().positive() });
async function execute<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) {
    if (error instanceof SourceLibraryError) throw new TRPCError({ code: error.code, message: error.message });
    throw error;
  }
}
export const sourceLibraryRouter = router({
  upload: protectedProcedure.use(rateLimit(RATE_LIMITS.upload)).input(scope.extend({
    fileName: z.string().min(1).max(255), fileContent: z.string().max(Math.ceil(SOURCE_LIBRARY_LIMITS.maxFileBytes / 3) * 4),
    title: z.string().trim().min(1).max(200).optional(), replaceId: z.number().int().positive().optional(),
  })).mutation(({ ctx, input }) => execute(() => service.upload(ctx.user.id, input))),
  list: protectedProcedure.input(scope).query(({ ctx, input }) => execute(() => service.list(ctx.user.id, input.personaId))),
  delete: protectedProcedure.input(scope.extend({ documentId: z.number().int().positive() })).mutation(({ ctx, input }) => execute(() => service.delete(ctx.user.id, input.personaId, input.documentId))),
  search: protectedProcedure.input(scope.extend({ query: z.string().max(120) })).query(({ ctx, input }) => execute(() => service.search(ctx.user.id, input.personaId, input.query))),
  overview: protectedProcedure.input(scope.extend({ query: z.string().max(120).optional() })).query(({ ctx, input }) => execute(() => service.overview(ctx.user.id, input.personaId, input.query))),
});

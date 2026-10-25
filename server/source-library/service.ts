import { SOURCE_LIBRARY_LIMITS, SOURCE_LIBRARY_INSTRUCTION, SourceLibraryError, sourceQueryTerms, rankSourceHits, formatSourceEvidence, type SourceHit } from './core';
import { prepareSourceBytes } from './parser';
import type { SourceLibraryRepository } from './repository';

export function createSourceLibraryService(repo: SourceLibraryRepository) {
  async function authorize(userId: number, personaId: number) {
    if (!await repo.ownsPersona(userId, personaId)) throw new SourceLibraryError('NOT_FOUND', '角色不存在或不属于当前账号。');
  }
  async function search(userId: number, personaId: number, query: string) {
    await authorize(userId, personaId);
    const bounded = Array.from(query.trim()).slice(0, 120).join('');
    const seeds = rankSourceHits(await repo.searchCandidates(userId, personaId, sourceQueryTerms(bounded)), bounded);
    const neighbors = await repo.neighborCandidates(userId, personaId, seeds);
    const result: SourceHit[] = [];
    for (let index = 0; index < seeds.length; index++) {
      for (const hit of [seeds[index], ...neighbors.filter(n => n.seedRank === index)]) {
        if (result.some(old => old.id === hit.id)) continue;
        result.push({ ...hit, score: seeds[index].score - .025 * (hit.distanceFromSeed ?? 0), matchedTerms: seeds[index].matchedTerms });
        if (result.length === 8) return result;
      }
    }
    return result;
  }
  return {
    async upload(userId: number, input: { personaId: number; fileName: string; fileContent: string; title?: string; replaceId?: number }, signal?: AbortSignal) {
      await authorize(userId, input.personaId);
      if (input.replaceId !== undefined && !await repo.getDocument(userId, input.personaId, input.replaceId)) throw new SourceLibraryError('NOT_FOUND', '待替换资料不存在。');
      if (!input.fileContent || input.fileContent.length > Math.ceil(SOURCE_LIBRARY_LIMITS.maxFileBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.fileContent)) throw new SourceLibraryError('BAD_REQUEST', '文件编码无效或超过 20 MiB。');
      const bytes = Buffer.from(input.fileContent, 'base64');
      const prepared = await prepareSourceBytes({ fileName: input.fileName, bytes, title: input.title, signal });
      signal?.throwIfAborted();
      return repo.saveDocument(userId, input.personaId, prepared, input.replaceId);
    },
    async list(userId: number, personaId: number) { await authorize(userId, personaId); return repo.listDocuments(userId, personaId); },
    async delete(userId: number, personaId: number, documentId: number) {
      await authorize(userId, personaId);
      if (!await repo.deleteDocument(userId, personaId, documentId)) throw new SourceLibraryError('NOT_FOUND', '原文资料不存在。');
      return { success: true };
    },
    search,
    async overview(userId: number, personaId: number, query = '') {
      await authorize(userId, personaId);
      const [documents, metadata] = await Promise.all([repo.listDocuments(userId, personaId), repo.listChunkMetadata(userId, personaId)]);
      const keywords = (rows: typeof metadata) => {
        const counts = new Map<string, number>();
        rows.forEach(row => row.keywords.forEach(word => counts.set(word, (counts.get(word) ?? 0) + 1)));
        return Array.from(counts).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([word]) => word);
      };
      const sources = documents.map(doc => {
        const rows = metadata.filter(row => row.documentId === doc.id);
        const chapters = Array.from(new Set(rows.map(row => row.chapterTitle))).map(title => {
          const items = rows.filter(row => row.chapterTitle === title);
          return { title: title || '正文', chunkCount: items.length, tokenEstimate: items.reduce((sum, row) => sum + row.tokenEstimate, 0) };
        });
        return { id: doc.id, title: doc.title, sourceType: doc.format, originalName: doc.fileName, createdAt: doc.createdAt, updatedAt: doc.updatedAt, chunkCount: doc.chunkCount, chapterCount: chapters.length, tokenEstimate: chapters.reduce((sum, row) => sum + row.tokenEstimate, 0), topKeywords: keywords(rows), chapters };
      });
      return { stats: { sourceCount: sources.length, chunkCount: metadata.length, chapterCount: sources.reduce((sum, row) => sum + row.chapterCount, 0), tokenEstimate: metadata.reduce((sum, row) => sum + row.tokenEstimate, 0) }, topKeywords: keywords(metadata), sources,
        search: { query, results: (query.trim() ? await search(userId, personaId, query) : []).map(hit => ({ ...hit, sourceId: hit.documentId })) } };
    },
    async context(userId: number, personaId: number, query: string, previousUserQueries: string[] = []) {
      await authorize(userId, personaId);
      const docs = await repo.listDocuments(userId, personaId);
      if (!docs.length && !/原文|原著|书中|小说|作品|资料/.test(query)) return null;
      const retrievalQuery = Array.from(query).length <= 24 ? [...previousUserQueries.slice(-2), query].join(' ').slice(-120) : Array.from(query).slice(0, 120).join('');
      const hits = docs.length ? await search(userId, personaId, retrievalQuery) : [];
      const formatted = formatSourceEvidence(hits, SOURCE_LIBRARY_LIMITS.evidenceBytes, retrievalQuery);
      return { instruction: SOURCE_LIBRARY_INSTRUCTION, evidence: formatted.evidence || JSON.stringify({ type: 'source_library_evidence', status: docs.length ? 'no_matching_excerpt' : 'no_uploaded_source', entries: [] }) };
    },
  };
}

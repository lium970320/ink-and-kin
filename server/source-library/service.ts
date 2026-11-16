import { SOURCE_LIBRARY_LIMITS, SOURCE_LIBRARY_INSTRUCTION, SourceLibraryError, sourceCandidateTerms, sourceRankCandidate, rankSourceHits, formatSourceEvidence, type SourceHit } from './core';
import { prepareSourceBytes } from './parser';
import type { SourceLibraryRepository } from './repository';
import { isRerankConfigured, resolveEmbeddingConfig } from '../llm/retrieval-providers';
import { hybridRankCandidates } from '../social/hybrid-retrieval';
import { resolveSourceRecallQuery } from '../social/source-recall';

export function createSourceLibraryService(repo: SourceLibraryRepository) {
  async function authorize(userId: number, personaId: number) {
    if (!await repo.ownsPersona(userId, personaId)) throw new SourceLibraryError('NOT_FOUND', '角色不存在或不属于当前账号。');
  }
  async function search(userId: number, personaId: number, query: string, allowExternal = true) {
    await authorize(userId, personaId);
    const bounded = Array.from(query.trim()).slice(0, 120).join('');
    if (!bounded) return [];
    const lexical = await repo.searchCandidates(userId, personaId, sourceCandidateTerms(bounded));
    let seeds = rankSourceHits(lexical, bounded);
    const embedding = resolveEmbeddingConfig({ enabled: allowExternal ? undefined : false });
    const rerankConfig = { enabled: allowExternal ? undefined : false };
    if (embedding.enabled || isRerankConfigured(rerankConfig)) {
      try {
        const cacheRows = embedding.enabled && repo.cachedCandidates
          ? await repo.cachedCandidates(userId, personaId, embedding.fingerprint) : [];
        const candidates = new Map(lexical.map(chunk => [chunk.id, sourceRankCandidate(chunk)]));
        for (const { embedding, ...chunk } of cacheRows) {
          candidates.set(chunk.id, { ...sourceRankCandidate(chunk), embedding });
        }
        const ranked = await hybridRankCandidates(bounded, Array.from(candidates.values()), {
          limit: SOURCE_LIBRARY_LIMITS.maxSearchResults,
          embeddingConfig: embedding,
          rerankConfig,
          onVectors: async (rows, fingerprint) => {
            await repo.saveVectors?.(userId, personaId, fingerprint,
              rows.flatMap(row => typeof row.id === 'number' ? [{ id: row.id, embedding: row.embedding }] : []));
          },
        });
        // 再次核对块仍存在，处理服务商请求期间原文被替换或删除。
        const current = await Promise.all(ranked.map(row => repo.getChunk(userId, personaId, row.item.id)));
        const rankedIds = new Set(ranked.map(row => row.item.id));
        seeds = [
          ...ranked.flatMap((row, index) => {
            const chunk = current[index];
            return chunk ? [{ ...chunk, score: row.fusedScore, matchedTerms: row.matchedTerms }] : [];
          }),
          ...seeds.filter(seed => !rankedIds.has(seed.id)),
        ].slice(0, SOURCE_LIBRARY_LIMITS.maxSearchResults);
      } catch {
        // 外部向量缓存不可用时保留本地匹配结果。
      }
    }
    const neighbors = await repo.neighborCandidates(userId, personaId, seeds);
    const result: SourceHit[] = [];
    for (let index = 0; index < seeds.length; index++) {
      for (const hit of [seeds[index], ...neighbors.filter(n => n.seedRank === index)]) {
        if (result.some(old => old.id === hit.id)) continue;
        result.push({ ...hit, score: seeds[index].score * (1 - .025 * (hit.distanceFromSeed ?? 0)), matchedTerms: seeds[index].matchedTerms });
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
    async context(userId: number, personaId: number, query: string, previousUserQueries: string[] = [], personaData?: unknown) {
      await authorize(userId, personaId);
      const docs = await repo.listDocuments(userId, personaId);
      const sourceTitles = docs.map(doc => doc.title);
      let retrievalQuery = resolveSourceRecallQuery(query, previousUserQueries, { personaData, sourceTitles });
      if (!retrievalQuery && docs.length) {
        const metadata = await repo.listChunkMetadata(userId, personaId, 96);
        retrievalQuery = resolveSourceRecallQuery(query, previousUserQueries, {
          personaData, sourceTitles,
          chapterTitles: metadata.map(row => row.chapterTitle),
          chunkKeywords: metadata.flatMap(row => row.keywords),
        });
      }
      if (!retrievalQuery) return null;
      // 普通聊天上下文用本地检索，专门的原文查询入口才允许转发查询给配置的服务商。
      const hits = docs.length ? await search(userId, personaId, retrievalQuery, false) : [];
      const formatted = formatSourceEvidence(hits, SOURCE_LIBRARY_LIMITS.evidenceBytes, retrievalQuery);
      return { instruction: SOURCE_LIBRARY_INSTRUCTION, evidence: formatted.evidence || JSON.stringify({ type: 'source_library_evidence', status: docs.length ? 'no_matching_excerpt' : 'no_uploaded_source', entries: [] }) };
    },
  };
}

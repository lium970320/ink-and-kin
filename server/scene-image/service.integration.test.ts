import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneImageProviderError, type GeneratedSceneImage, type GenerateSceneImageInput, type ListSceneImageModelsInput, type SceneImageModel } from "./provider-types";
import type { SceneImageRelayInput } from "./config";
import type { PreparedSceneImageRequest } from "./service";

const provider = vi.hoisted(() => ({
  generate: vi.fn<(input: GenerateSceneImageInput) => Promise<GeneratedSceneImage>>(),
  list: vi.fn<(input: ListSceneImageModelsInput) => Promise<SceneImageModel[]>>(),
}));
vi.mock("./providers", async importOriginal => ({
  ...await importOriginal<typeof import("./providers")>(),
  generateSceneImage: provider.generate,
  listSceneImageModels: provider.list,
}));

const testUrl = process.env.INK_AND_KIN_SCENE_IMAGE_TEST_DATABASE_URL;
const isolated = testUrl ? describe : describe.skip;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=", "base64");
const generated = { buffer: png, mimeType: "image/png", referenceMode: "no_reference" } satisfies GeneratedSceneImage;
const relay = {
  relayName: "合成首站", priority: 100, enabled: true, protocol: "openai", baseUrl: "https://first-image.example.invalid/v1",
  apiKey: "integration-fixture-only", model: "synthetic-image", size: "1024x1024", timeoutMs: 30_000, formalReferenceEnabled: true,
} satisfies SceneImageRelayInput;
const backupRelay = { ...relay, relayName: "合成备用站", priority: 50, baseUrl: "https://backup-image.example.invalid/v1" };

function assertIsolatedUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("配图集成测试数据库地址无效。"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || !url.port || url.port === "5434"
    || url.pathname !== "/ink_and_kin_batch8b" || raw.includes("?") || raw.includes("#")) {
    throw new Error("配图集成测试只允许本机独立的第 8B 批数据库。");
  }
  return Number(url.port);
}

isolated("场景配图真实数据库集成", () => {
  let db: typeof import("../db");
  let service: typeof import("./service");
  let config: typeof import("./config");
  let assets: typeof import("./assets");
  let context: typeof import("../chat/context-state");
  let pool: NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>> | undefined;
  let verifiedDatabase = false;
  let tempBase: string;
  let uploadRoot: string | undefined;
  const owners: Array<{ userId: number; username: string }> = [];
  const unexpectedFetch = vi.fn(async () => { throw new Error("集成测试禁止外部请求。"); });

  beforeAll(async () => {
    const expectedPort = assertIsolatedUrl(testUrl!);
    tempBase = await realpath(tmpdir());
    if (process.platform === "win32" && !/^G:[\\/]/i.test(tempBase)) throw new Error("请将本批测试 TEMP/TMP 指向 G 盘运行区。");
    uploadRoot = await mkdtemp(path.join(tempBase, "ink-kin-scene-image-integration-"));
    vi.stubEnv("DATABASE_URL", testUrl!);
    vi.stubEnv("UPLOAD_DIR", uploadRoot);
    vi.stubEnv("JWT_SECRET", `scene-image-integration-${randomUUID()}`);
    vi.stubGlobal("fetch", unexpectedFetch);
    // Import the production database and storage only after both sandbox guards are in place.
    db = await import("../db");
    pool = (await db.getDb()) ?? undefined;
    if (!pool) throw new Error("本批隔离库不可用。");
    const identity = await pool.$client.query("SELECT current_database() AS name, inet_server_port() AS port");
    expect(identity.rows[0]).toEqual({ name: "ink_and_kin_batch8b", port: expectedPort });
    verifiedDatabase = true;
    [service, config, assets, context] = await Promise.all([
      import("./service"), import("./config"), import("./assets"), import("../chat/context-state"),
    ]);
  }, 20_000);

  afterAll(async () => {
    try {
      let failedCleanup = 0;
      if (verifiedDatabase) for (const { userId, username } of owners) {
        try {
          if ((await db.getUserById(userId))?.username !== username) throw new Error("测试账号身份不匹配。");
          await db.deleteUserAccount(userId);
        } catch { failedCleanup++; }
      }
      if (failedCleanup) throw new Error(`${failedCleanup} 个合成账号未能完成清理。`);
      expect(unexpectedFetch).not.toHaveBeenCalled();
    } finally {
      try { await pool?.$client.end(); }
      finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        if (uploadRoot) {
          const resolved = await realpath(uploadRoot);
          if (path.relative(tempBase, path.dirname(resolved)) !== ""
            || !path.basename(resolved).startsWith("ink-kin-scene-image-integration-")) throw new Error("临时目录不属于配图集成测试。");
          await rm(resolved, { recursive: true, force: true });
        }
      }
    }
  }, 20_000);

  beforeEach(() => {
    provider.generate.mockReset().mockResolvedValue(generated);
    provider.list.mockReset().mockResolvedValue([{ id: relay.model, label: "合成模型" }] satisfies SceneImageModel[]);
  });

  async function fixture(options: { backup?: boolean; scene?: boolean; blankBaseline?: boolean; comfyTemplate?: string } = {}) {
    const username = `scene-img-it-${randomUUID()}`;
    const userId = await db.createUser({ username, passwordHash: "synthetic-not-for-login", name: "合成配图集成账号" });
    owners.push({ userId, username });
    const personaId = await db.createPersona({ userId, name: "合成馆员", analysisStatus: "ready" });
    const scene = options.scene ? await db.createScene({ userId, name: "合成图书室",
      sceneVisualBaseline: options.blankBaseline ? null : "窗边柔光" }) : null;
    if (scene) await db.activateScene(personaId, scene.id, userId);
    const first = await config.saveSceneImageRelay(userId, 0, options.comfyTemplate ? {
      ...relay, protocol: "comfyui", model: "synthetic.safetensors",
    } : relay);
    const current = options.backup ? await config.saveSceneImageRelay(userId, first.revision, backupRelay) : first;
    const { revision } = await config.saveSceneImageSettings(userId, current.revision, {
      enabled: true, cooldownMinutes: 0, maxPerHour: 0,
      ...(options.comfyTemplate ? { comfyPromptTemplate: options.comfyTemplate } : {}),
    });
    return { userId, personaId, sceneId: scene?.id ?? null, revision, firstRelayId: first.savedRelayId };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function requestInput(owner: Fixture, operationId: string = randomUUID(), message = "/p 画出图书室窗边") {
    return { userId: owner.userId, personaId: owner.personaId, expectedSceneId: owner.sceneId, operationId, message, channel: "web" as const };
  }
  async function prepare(owner: Fixture, operationId?: string): Promise<PreparedSceneImageRequest> {
    const { request, errorMessage } = await service.prepareSceneImageRequest(requestInput(owner, operationId));
    if (!request) throw new Error(`显式配图请求未得到任务：${errorMessage ?? "没有返回原因"}`);
    return request;
  }
  async function result(request: PreparedSceneImageRequest) {
    // The test wait is bounded independently of the production task deadline.
    return vi.waitFor(async () => {
      const job = await service.getSceneImageJob(request.userId, request.operationId);
      expect(job.status).not.toMatch(/^(pending|running)$/);
      return job;
    }, { timeout: 5000, interval: 25 });
  }
  function images(owner: Fixture) {
    return db.getMessagesByPersonaId(owner.personaId, owner.userId).then(rows => rows.filter(row => row.messageType === "image"));
  }
  async function outputs(owner: Fixture) {
    return readdir(path.join(uploadRoot!, "scene-images", String(owner.userId))).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
  }
  function holdGeneration() {
    let signal: AbortSignal | undefined;
    let release!: (value: GeneratedSceneImage) => void;
    const pending = new Promise<GeneratedSceneImage>(resolve => { release = resolve; });
    provider.generate.mockImplementationOnce((input: GenerateSceneImageInput) => { signal = input.signal; return pending; });
    return { wait: () => vi.waitFor(() => { expect(signal).toBeDefined(); return signal!; }, { timeout: 5000, interval: 25 }),
      release: () => release(generated) };
  }
  const textReply = { reply: "窗边放着一本打开的书。" };

  it("普通文字无任务；并发显式请求只占用一次，重复启动只保存一条图片消息", async () => {
    const owner = await fixture({ scene: true });
    const ordinary = requestInput(owner, randomUUID(), "解释 /policy 这个命令");
    await expect(service.prepareSceneImageRequest(ordinary)).resolves.toEqual({ requested: false, message: ordinary.message });
    await expect(service.getSceneImageJob(owner.userId, ordinary.operationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await service.getSceneImageLogDetails(owner.userId)).records).toEqual([]);
    expect(provider.generate).not.toHaveBeenCalled();

    const input = requestInput(owner);
    const reservations = await Promise.allSettled([service.prepareSceneImageRequest(input), service.prepareSceneImageRequest(input)]);
    expect(reservations.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(reservations.find(item => item.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    const accepted = reservations.find(item => item.status === "fulfilled");
    if (!accepted || accepted.status !== "fulfilled" || !accepted.value.request) throw new Error("没有成功占用配图任务。");
    const request = accepted.value.request;
    await Promise.all([service.startSceneImageJob(request, textReply), service.startSceneImageJob(request, textReply)]);
    const job = await result(request);
    expect(job).toMatchObject({ status: "succeeded", messageId: expect.any(Number), relayId: owner.firstRelayId });
    expect(job.outputKey).toMatch(new RegExp(`^scene-images/${owner.userId}/`));
    await expect(service.startSceneImageJob(request, textReply)).resolves.toMatchObject({ status: "succeeded", messageId: job.messageId });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(await images(owner)).toMatchObject([{ id: job.messageId, role: "assistant", sceneId: owner.sceneId, mediaUrl: job.imageUrl }]);
    expect(await readFile(path.join(uploadRoot!, job.outputKey!))).toEqual(png);
    expect((await db.getSceneGenerationSnapshot(owner.personaId, owner.userId)).scene?.sceneVisualBaseline).toBe("窗边柔光");
  }, 15_000);

  it("首次正式成功时填充本账号空基线，后续出图不覆盖", async () => {
    const owner = await fixture({ scene: true, blankBaseline: true });
    const readBaseline = async () => (await db.getSceneGenerationSnapshot(owner.personaId, owner.userId)).scene?.sceneVisualBaseline;
    expect(await readBaseline()).toBeNull();
    const first = await prepare(owner);
    await service.startSceneImageJob(first, textReply);
    await expect(result(first)).resolves.toMatchObject({ status: "succeeded" });
    const filled = await readBaseline();
    expect(filled).toBe("场景：合成图书室");
    expect(filled).not.toContain("用户描述");
    expect(filled).not.toContain("对话回应");
    expect(filled).toContain("合成图书室");
    const second = await prepare(owner);
    await service.startSceneImageJob(second, { reply: "另一段场景回应。" });
    await expect(result(second)).resolves.toMatchObject({ status: "succeeded" });
    expect(await readBaseline()).toBe(filled);
    expect(await images(owner)).toHaveLength(2);
  }, 15_000);

  it("取消先到阻止迟到请求；生成中取消向替身传播，迟到结果无图片", async () => {
    const owner = await fixture();
    const late = requestInput(owner);
    await expect(service.cancelSceneImageOperation(owner.userId, late.operationId)).resolves.toMatchObject({ status: "cancelled" });
    await expect(service.prepareSceneImageRequest(late)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(provider.generate).not.toHaveBeenCalled();

    const request = await prepare(owner);
    const hold = holdGeneration();
    const beforePublish = vi.fn(async () => {});
    try {
      await service.startSceneImageJob(request, { ...textReply, beforePublish });
      const signal = await hold.wait();
      expect(signal.aborted).toBe(false);
      await expect(service.cancelSceneImageJob(owner.userId, request.operationId)).resolves.toMatchObject({ status: "cancelled" });
      expect(signal.aborted).toBe(true);
    } finally { hold.release(); }
    await expect(result(request)).resolves.toMatchObject({ status: "cancelled", messageId: null, outputKey: undefined });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(beforePublish).not.toHaveBeenCalled();
    expect(await images(owner)).toEqual([]);
    expect(await outputs(owner)).toEqual([]);
  }, 15_000);

  const staleChanges: Array<[string, (owner: Fixture) => Promise<unknown>]> = [
    ["配置版本", owner => config.saveSceneImageSettings(owner.userId, owner.revision, { enabled: false })],
    ["场景画面基线", owner => db.updateScene(owner.sceneId!, owner.userId, { sceneVisualBaseline: "换为夜色和台灯" })],
    ["场景资产", async owner => {
      const reference = await assets.uploadSceneImageReference(owner.userId, png.toString("base64"), "image/png");
      return db.updateScene(owner.sceneId!, owner.userId, { scenePersonaRefKey: reference.key });
    }],
    ["对话版本", owner => context.changeContext(owner.userId, owner.personaId, "start")],
    ["当前场景", owner => db.activateScene(owner.personaId, null, owner.userId)],
  ];
  it.each(staleChanges)("生成期间变更%s会拒绝迟到图片并清除临时输出", async (_name, change) => {
    const owner = await fixture({ scene: true });
    const request = await prepare(owner);
    const hold = holdGeneration();
    try {
      await service.startSceneImageJob(request, textReply);
      await hold.wait();
      await change(owner);
    } finally { hold.release(); }
    await expect(result(request)).resolves.toMatchObject({ status: "cancelled", messageId: null, outputKey: undefined });
    expect(await images(owner)).toEqual([]);
    await vi.waitFor(async () => expect(await outputs(owner)).toEqual([]));
    expect(provider.generate).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("两个账号使用同一操作编号仍各自隔离任务、参考图、日志和输出", async () => {
    const owner = await fixture({ scene: true }), other = await fixture({ scene: true });
    const ref = await assets.uploadSceneImageReference(owner.userId, png.toString("base64"), "image/png");
    await db.updateScene(owner.sceneId!, owner.userId, { scenePersonaRefKey: ref.key });
    await expect(assets.readSceneImageAsset(other.userId, ref.key)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(config.saveSceneImageSettings(other.userId, other.revision, { userReferenceKey: ref.key })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const operationId = randomUUID();
    const ownRequest = await prepare(owner, operationId);
    await expect(service.getSceneImageJob(other.userId, operationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.cancelSceneImageJob(other.userId, operationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await service.getSceneImageLogDetails(other.userId)).records).toEqual([]);
    const otherRequest = await prepare(other, operationId);
    await service.startSceneImageJob(ownRequest, textReply);
    await service.startSceneImageJob(otherRequest, textReply);
    const [ownJob, otherJob] = await Promise.all([result(ownRequest), result(otherRequest)]);
    expect(ownJob.status).toBe("succeeded");
    expect(otherJob.status).toBe("succeeded");
    expect(ownJob.outputKey).toMatch(new RegExp(`^scene-images/${owner.userId}/`));
    expect(otherJob.outputKey).toMatch(new RegExp(`^scene-images/${other.userId}/`));
    const references = provider.generate.mock.calls.map(([input]) => input.references.map(item => item.key));
    expect(references).toEqual(expect.arrayContaining([[ref.key], []]));
    expect(references).toHaveLength(2);
    await expect(assets.deleteSceneImageOutput(other.userId, ownJob.outputKey!)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await readFile(path.join(uploadRoot!, ownJob.outputKey!))).toEqual(png);
    expect(await readFile(path.join(uploadRoot!, otherJob.outputKey!))).toEqual(png);
    expect(await images(other)).toMatchObject([{ id: otherJob.messageId, mediaUrl: otherJob.imageUrl }]);
    expect((await service.getSceneImageLogDetails(owner.userId)).records).toMatchObject([{ userId: owner.userId, outputKey: ownJob.outputKey }]);
    expect((await service.getSceneImageLogDetails(other.userId)).records).toMatchObject([{ userId: other.userId, outputKey: otherJob.outputKey }]);
  }, 15_000);

  it.each([["content_policy", "failed"], ["network_error", "unknown"]] as const)("%s 不换站或写入聊天", async (code, status) => {
    const owner = await fixture({ backup: true });
    provider.generate.mockRejectedValueOnce(new SceneImageProviderError(code, "合成替身故障"));
    const request = await prepare(owner);
    await service.startSceneImageJob(request, textReply);
    await expect(result(request)).resolves.toMatchObject({ status, relayId: owner.firstRelayId, outputKey: undefined, messageId: null });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(await images(owner)).toEqual([]);
  }, 15_000);

  it("明确未提交才换到下一站，并只保存最终一条图片", async () => {
    const owner = await fixture({ backup: true });
    provider.generate.mockRejectedValueOnce(new SceneImageProviderError("invalid_config", "合成替身未提交", true));
    const request = await prepare(owner);
    await service.startSceneImageJob(request, textReply);
    const job = await result(request);
    expect(job).toMatchObject({ status: "succeeded", relayId: owner.firstRelayId + 1 });
    expect(provider.generate.mock.calls.map(([input]) => input.relay.baseUrl)).toEqual([relay.baseUrl, backupRelay.baseUrl]);
    expect(await images(owner)).toMatchObject([{ id: job.messageId }]);
  }, 15_000);

  it("Comfy 明确未提交后，备用云站用默认改写，日志与视觉基线记录实际成功提示词",async()=>{
    const template="专用结构：{{prompt}}";
    const owner=await fixture({backup:true,scene:true,blankBaseline:true,comfyTemplate:template});
    const llm=await import("../llm/user-provider");
    type Resolution=Awaited<ReturnType<typeof llm.resolveSingleProviderForUser>>;
    const comfyText="服装：黄色外套";
    const cloudText=["服装：蓝色外套","场景：云端图书室"].join(String.fromCharCode(10));
    const invoke=vi.fn<Resolution["provider"]["invoke"]>().mockResolvedValueOnce(comfyText).mockResolvedValueOnce(cloudText);
    const resolver=vi.spyOn(llm,"resolveSingleProviderForUser").mockResolvedValue({
      provider:{invoke} as unknown as Resolution["provider"],relayEnabled:true,reflectsCurrentChatRoute:false,maxAttempts:1,
    });
    const original=config.getSceneImageConfig;
    const summary=vi.spyOn(config,"getSceneImageConfig").mockImplementation(async userId=>({
      ...await original(userId),promptRewriteDefaultRelayId:987,promptRewriteRelayOptions:[
        {relayId:987,providerName:"合成改写站",relayName:"合成改写站",priority:10,model:null},
      ],
    }));
    try {
      provider.generate.mockRejectedValueOnce(new SceneImageProviderError("invalid_config","合成替身未提交",true));
      const request=await prepare(owner);
      await service.startSceneImageJob(request,textReply);
      await expect(result(request)).resolves.toMatchObject({status:"succeeded",relayId:owner.firstRelayId+1});
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke.mock.calls[0][0][0].content).toContain(template);
      expect(invoke.mock.calls[1][0][0].content).not.toContain(template);
      expect(provider.generate.mock.calls.map(([input])=>input.prompt)).toEqual([comfyText,cloudText]);
      expect((await service.getSceneImageLogDetails(owner.userId)).records).toMatchObject([{promptText:cloudText,attempt:2}]);
      const snapshot=await db.getSceneGenerationSnapshot(owner.personaId,owner.userId);
      expect(snapshot.scene?.sceneVisualBaseline).toBe(cloudText);
    } finally {summary.mockRestore();resolver.mockRestore();}
  },15000);

  it("设置页试生成和模型读取不会写入聊天", async () => {
    const owner = await fixture();
    await expect(service.listSceneImageRelayModels(owner.userId, owner.revision, { ...relay, id: owner.firstRelayId })).resolves.toMatchObject({
      models: [{ id: relay.model, displayName: "合成模型" }],
    });
    const operationId = randomUUID();
    const job = await service.testSceneImageRelay(owner.userId, { ...relay, id: owner.firstRelayId, expectedRevision: owner.revision,
      operationId, testMode: "neutral" });
    expect(job).toMatchObject({ status: "succeeded", success: true, messageId: null });
    expect(job.outputKey).toMatch(new RegExp(`^scene-image-tests/${owner.userId}/`));
    await expect(service.testSceneImageRelay(owner.userId, { ...relay, id: owner.firstRelayId, expectedRevision: owner.revision,
      operationId, testMode: "neutral" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(provider.list).toHaveBeenCalledTimes(1);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(await db.getMessagesByPersonaId(owner.personaId, owner.userId)).toEqual([]);
    expect((await service.getSceneImageLogDetails(owner.userId)).records).toMatchObject([{ source: "relay_test_neutral", outputKey: job.outputKey }]);
  }, 15_000);

  it("试生成的预约提交后先收到取消，不再提交图片接口",async()=>{
    const owner=await fixture(),operationId=randomUUID();
    const original=config.withSceneImageConfigRevision;
    let first=true;
    const wrapped=vi.spyOn(config,"withSceneImageConfigRevision").mockImplementation(async(userId,revision,work)=>{
      const value=await original(userId,revision,work);
      if(first){first=false;await service.cancelSceneImageOperation(userId,operationId);}
      return value;
    });
    try {
      await expect(service.testSceneImageRelay(owner.userId,{...relay,id:owner.firstRelayId,expectedRevision:owner.revision,operationId,testMode:"neutral"}))
        .resolves.toMatchObject({status:"cancelled",success:false});
      expect(provider.generate).not.toHaveBeenCalled();
    }finally{wrapped.mockRestore();}
  },15000);

  it("关闭配图也返回原正文快照，错误场景不能降级写入",async()=>{
    const owner=await fixture({scene:true});
    await config.saveSceneImageSettings(owner.userId,owner.revision,{enabled:false});
    const prepared=await service.prepareSceneImageRequest({...requestInput(owner),expectedSceneId:owner.sceneId});
    expect(prepared.request).toBeUndefined();expect(prepared.contextRevision).toBeTypeOf("number");expect(prepared.sceneId).toBe(owner.sceneId);
    await expect(service.prepareSceneImageRequest({...requestInput(owner),expectedSceneId:null})).rejects.toMatchObject({code:"CONFLICT"});
    expect(provider.generate).not.toHaveBeenCalled();
  },15000);

  it("过期任务结为未知，不因读取、重复启动或同编号请求再提交", async () => {
    const owner = await fixture();
    const request = await prepare(owner);
    const { sceneImageJobs: jobs } = await import("../../drizzle/scene-image-job-schema");
    const scope = and(eq(jobs.userId, owner.userId), eq(jobs.id, request.operationId));
    const [stored] = await pool!.select({ createdAt: jobs.createdAt, deadline: jobs.deadline }).from(jobs).where(scope);
    const now = Date.now();
    expect(Math.abs(stored.createdAt.getTime() - now)).toBeLessThan(30_000);
    expect(stored.deadline.getTime()).toBe(request.deadline);
    expect(stored.deadline.getTime()).toBeGreaterThan(now);

    // Match the service's Date encoding instead of converting SQL now() via the session time zone.
    const pastDeadline = new Date(now - 60_000);
    const updated = await pool!.update(jobs).set({ deadline: pastDeadline }).where(scope)
      .returning({ id: jobs.id, deadline: jobs.deadline });
    expect(updated).toEqual([{ id: request.operationId, deadline: pastDeadline }]);
    await expect(service.getSceneImageJob(owner.userId, request.operationId)).resolves.toMatchObject({ status: "unknown", messageId: null });
    await expect(service.startSceneImageJob(request, textReply)).resolves.toMatchObject({ status: "unknown" });
    await expect(service.prepareSceneImageRequest(requestInput(owner, request.operationId))).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await service.getSceneImageLogDetails(owner.userId)).records).toMatchObject([{ id: request.operationId, reason: "expired" }]);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(await images(owner)).toEqual([]);
  }, 15_000);
});

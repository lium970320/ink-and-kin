import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { sceneImageJobs as jobs, type SceneImageJobStatus } from "../../drizzle/scene-image-job-schema";
import { personas, scenes, type Scene } from "../../drizzle/schema";
import * as db from "../db";
import { resolveSingleProviderForUser } from "../llm/user-provider";
import { getSceneImageConfig, getSceneImageRuntimeConfig, resolveSceneImageRelayDraft, withSceneImageConfigRevision,
  type SceneImageRelayInput, type SceneImageRuntimeConfig, type SceneImageRuntimeRelay } from "./config";
import { readSceneImageAsset, writeSceneImageOutput, deleteSceneImageOutput } from "./assets";
import { generateSceneImage, listSceneImageModels, resolveSceneImageProtocol } from "./providers";
import { SceneImageProviderError, type SceneImageReference } from "./provider-types";

const TOTAL_MS = 660_000;
const active = new Map<string, AbortController>();
const pendingStatuses: SceneImageJobStatus[] = ["pending", "running"];
const scope = (userId: number, id: string) => and(eq(jobs.userId, userId), eq(jobs.id, id));
const mapKey = (userId: number, id: string) => `${userId}:${id}`;
function checkOperation(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "配图操作编号无效。" });
  }
}
function abortIf(signal?: AbortSignal) { if (signal?.aborted) throw new SceneImageProviderError("cancelled", "配图已取消。"); }
function changed(): never { throw new TRPCError({ code: "CONFLICT", message: "配图的场景或上下文已变化，请重新发送。" }); }
async function database() {
  const connection = await db.getDb();
  if (!connection) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "配图任务暂不可用。" });
  return connection;
}
export function parseSceneImageRequest(input: string) {
  const value = input.trim();
  const prefix = /^[\/／][pｐＰP](?=$|\s|[^a-zA-Z0-9_])/;
  const suffix = /(?:^|\s)[\/／][pｐＰP]\s*$/;
  const requested = prefix.test(value) || suffix.test(value);
  return { requested, message: requested ? value.replace(prefix, "").replace(suffix, "").trim() || "请继续当前场景。" : input };
}
export function orderSceneImageRelays(config: Pick<SceneImageRuntimeConfig, "priorityStrategy" | "relays">) {
  const relays = config.relays.filter(item => item.enabled).sort((a,b) => b.priority-a.priority || (a.id ?? 0)-(b.id ?? 0));
  const comfy = relays.filter(item => resolveSceneImageProtocol(item) === "comfyui");
  const cloud = relays.filter(item => resolveSceneImageProtocol(item) !== "comfyui");
  if (config.priorityStrategy === "comfyui_only") return comfy;
  if (config.priorityStrategy === "relay_only") return cloud;
  return config.priorityStrategy === "comfyui_first" ? [...comfy, ...cloud] : [...cloud, ...comfy];
}
function sceneFingerprint(scene: Scene | null) {
  if (!scene) return "none";
  return JSON.stringify([scene.id, scene.name, scene.description, scene.systemPromptOverlay, scene.personaIdentityOverride,
    scene.userIdentityOverride, scene.contextSeed, scene.sceneVisualBaseline, scene.scenePersonaRefKey, scene.sceneUserRefKey, scene.sceneEnvRefKey]);
}
export interface PreparedSceneImageRequest {
  userId: number; personaId: number; operationId: string; sceneId: number | null; contextRevision: number;
  channel: "web" | "qq"; message: string; config: SceneImageRuntimeConfig;
  scene: Scene | null; personaName: string; deadline: number;
}
async function checkSnapshot(tx: db.DbTransaction, request: PreparedSceneImageRequest, publish = false) {
  const context = await db.lockChatContext(tx, request.personaId, request.userId, "share");
  if (context.revision !== request.contextRevision) return changed();
  const [persona] = await tx.select({ sceneId: personas.activeSceneId }).from(personas)
    .where(and(eq(personas.id,request.personaId),eq(personas.userId,request.userId))).limit(1);
  if (!persona || persona.sceneId !== request.sceneId) return changed();
  const scene = request.sceneId === null ? null : publish
    ? (await tx.select().from(scenes).where(eq(scenes.id,request.sceneId)).limit(1).for("update"))[0] ?? null
    : await db.lockSceneForContext(tx,request.userId,request.sceneId);
  if (sceneFingerprint(scene) !== sceneFingerprint(request.scene)) return changed();
}
async function expireJobs(userId: number) {
  const connection=await database();
  await connection.update(jobs).set({ status:"unknown", errorCode:"expired", updatedAt:new Date() })
    .where(and(eq(jobs.userId,userId),inArray(jobs.status,pendingStatuses),lte(jobs.deadline,new Date())));
}
export async function prepareSceneImageRequest(input: {
  userId:number;personaId:number;operationId:string;message:string;channel:"web"|"qq";signal?:AbortSignal;expectedSceneId?:number|null;
}): Promise<{requested:boolean;message:string;request?:PreparedSceneImageRequest;errorMessage?:string;contextRevision?:number;sceneId?:number|null}> {
  const command=parseSceneImageRequest(input.message);
  if (!command.requested) return command;
  checkOperation(input.operationId); abortIf(input.signal);
  const snapshot=await db.getSceneGenerationSnapshot(input.personaId,input.userId);
  const sceneId=snapshot.scene?.id ?? null;
  if (input.expectedSceneId !== undefined && input.expectedSceneId !== sceneId) return changed();
  const parsed={...command,contextRevision:snapshot.revision,sceneId};
  const config=await getSceneImageRuntimeConfig(input.userId);
  if (!config.enabled) return {...parsed,errorMessage:"请先在设置中开启场景配图。"};
  if (!orderSceneImageRelays(config).length) return {...parsed,errorMessage:"当前配图策略没有启用的图片接口。"};
  const request:PreparedSceneImageRequest={...input,message:parsed.message,config,scene:snapshot.scene,sceneId,
    contextRevision:snapshot.revision,personaName:snapshot.persona.name,deadline:Date.now()+TOTAL_MS};
  await expireJobs(input.userId);
  const reserved=await withSceneImageConfigRevision(input.userId,config.revision,async tx=>{
    await checkSnapshot(tx,request); abortIf(input.signal);
    const [existing]=await tx.select().from(jobs).where(scope(input.userId,input.operationId)).limit(1);
    if(existing) throw new TRPCError({code:"CONFLICT",message:existing.status === "cancelled" ? "配图已取消。" : "这次配图请求已处理，请查看原任务。"});
    // 固定账号锁将额度检查和占用写入合为一个事务，失败/未知请求也计入，避免重复收费。
    const recent=await tx.select({createdAt:jobs.createdAt}).from(jobs).where(and(eq(jobs.userId,input.userId),
      inArray(jobs.kind,["web","qq"]),gte(jobs.createdAt,new Date(Date.now()-3600_000)))).orderBy(desc(jobs.createdAt));
    if((config.maxPerHour > 0 && recent.length >= config.maxPerHour) || (config.cooldownMinutes > 0 && recent[0] && Date.now()-recent[0].createdAt.getTime()<config.cooldownMinutes*60_000)) {
      return false;
    }
    const created=await tx.insert(jobs).values({userId:input.userId,id:input.operationId,personaId:input.personaId,sceneId,
      contextRevision:request.contextRevision,configRevision:config.revision,kind:input.channel,status:"pending",deadline:new Date(request.deadline)})
      .onConflictDoNothing().returning({id:jobs.id});
    if(!created.length) throw new TRPCError({code:"CONFLICT",message:"配图已取消或已处理。"});
    return true;
  });
  if(!reserved)return {...parsed,errorMessage:"配图冷却或每小时次数已达上限，请稍后再试。"};
  return {...parsed,request};
}
const errorMessages:Record<string,string>={
  cancelled:"配图已取消。",context_changed:"配图配置、场景或上下文已变化，请重新发送。",expired:"配图任务已过期，结果未知；没有自动重试。",
  timeout:"图片接口超时，结果未知；没有自动重试。",unknown:"图片接口结果未知；没有自动重试。",network_error:"图片接口连接中断，结果未知；没有自动重试。",
  content_policy:"图片服务拒绝了该请求。",invalid_config:"请检查图片接口与工作流配置。",unsupported_reference:"当前接口无法按角色使用所选参考图。",
  invalid_response:"图片接口未返回有效图片。",response_too_large:"图片接口返回内容超过允许范围。",http_4xx:"图片接口拒绝了请求，请检查配置。",
  rewrite_failed:"提示词改写未成功，本次未提交图片生成。",failed:"配图未完成，请检查配置后重试。",
};
function safeError(error:unknown) {
  if(error instanceof SceneImageProviderError)return error.code;
  if(error instanceof TRPCError && (error.code === "CONFLICT" || error.code === "NOT_FOUND"))return "context_changed";
  return "failed";
}
function publicJob(row:typeof jobs.$inferSelect) {
  return {id:row.id,status:row.status,imageUrl:row.status === "succeeded" && row.outputKey ? `/uploads/${row.outputKey}`:undefined,
    outputKey:row.status === "succeeded" ? row.outputKey:undefined,messageId:row.messageId,
    errorMessage:row.errorCode ? errorMessages[row.errorCode] ?? errorMessages.failed:undefined,
    referenceMode:row.referenceMode,durationMs:row.durationMs,relayId:row.relayId};
}
export async function getSceneImageJob(userId:number,id:string) {
  checkOperation(id);await expireJobs(userId);const connection=await database();
  const [row]=await connection.select().from(jobs).where(scope(userId,id)).limit(1);
  if(!row)throw new TRPCError({code:"NOT_FOUND",message:"配图任务不存在。"});
  return publicJob(row);
}
export async function cancelSceneImageOperation(userId:number,id:string) {
  checkOperation(id);const connection=await database();
  // 墓碑与启动占用竞争同一主键。取消先到也能阻止迟到的正文请求启动生图。
  await connection.insert(jobs).values({userId,id,kind:"cancel",status:"cancelled",errorCode:"cancelled",deadline:new Date()}).onConflictDoNothing();
  await connection.update(jobs).set({status:"cancelled",errorCode:"cancelled",updatedAt:new Date()})
    .where(and(scope(userId,id),inArray(jobs.status,pendingStatuses)));
  active.get(mapKey(userId,id))?.abort();
  return getSceneImageJob(userId,id);
}
export async function cancelSceneImageJob(userId:number,id:string) {
  await getSceneImageJob(userId,id);return cancelSceneImageOperation(userId,id);
}
async function terminal(userId:number,id:string,status:SceneImageJobStatus,errorCode:string,durationMs?:number) {
  const connection=await database();await connection.update(jobs).set({status,errorCode,updatedAt:new Date(),durationMs})
    .where(and(scope(userId,id),inArray(jobs.status,pendingStatuses)));
}
function operationSignal(userId:number,id:string,deadline:number,parent?:AbortSignal) {
  const controller=new AbortController();const abort=()=>controller.abort();
  parent?.addEventListener("abort",abort,{once:true});if(parent?.aborted)abort();
  const timer=setTimeout(abort,Math.max(1,deadline-Date.now()));timer.unref?.();
  active.set(mapKey(userId,id),controller);
  return {signal:controller.signal,cleanup(){clearTimeout(timer);parent?.removeEventListener("abort",abort);active.delete(mapKey(userId,id));}};
}
async function referencesFor(userId:number,config:SceneImageRuntimeConfig,scene:Scene|null,includeUser=true):Promise<SceneImageReference[]> {
  const keys: Array<[SceneImageReference["role"],string|null]> = [
    ["persona",scene?.scenePersonaRefKey || config.activePersonaReferenceKey],
    ["user",includeUser ? scene?.sceneUserRefKey || config.userReferenceKey : null],["env",scene?.sceneEnvRefKey ?? null],
  ];
  const result:SceneImageReference[]=[];
  for(const [role,key] of keys)if(key)result.push({role,...await readSceneImageAsset(userId,key)});
  return result;
}
export function sceneImageIncludesUser(scene:Scene|null,message:string,reply:string) {
  if(scene)return true;
  return /双人|两个人|两人|我们.{0,12}(?:一起|坐|走|站|见面|合影)|一起.{0,12}(?:合影|散步|吃饭)|与你同框|和我同框|面对面/.test(`${message}\n${reply}`);
}
export function sceneImageVisualBaseline(prompt:string,scene:Scene) {
  const fields=new Map<string,string>();
  for(const line of prompt.split(/\r?\n/)){
    const match=/^\s*(服装|场景|光线|镜头)[：:]\s*(.{1,800})$/.exec(line);
    if(match && !fields.has(match[1]))fields.set(match[1],match[2].trim());
  }
  if(!fields.has("场景"))fields.set("场景",scene.name);
  return ["服装","场景","光线","镜头"].filter(key=>fields.has(key)).map(key=>`${key}：${fields.get(key)}`).join("\n").slice(0,4000);
}
type RewriteMessage = { role: "system" | "user"; content: string };
type PromptRewriter = (messages: RewriteMessage[]) => Promise<string>;

export function createSceneImagePromptResolver(input:{
  base:string;comfyPromptTemplate?:string|null;signal?:AbortSignal;resolveRewrite:()=>Promise<PromptRewriter|null>;
}) {
  const cache=new Map<string|null,Promise<string>>();
  const comfyTemplate=input.comfyPromptTemplate?.trim() || null;
  let rewriter:Promise<PromptRewriter|null>|undefined;
  return (relay:SceneImageRuntimeRelay):Promise<string>=>{
    abortIf(input.signal);
    const template=resolveSceneImageProtocol(relay) === "comfyui" ? comfyTemplate : null;
    const cached=cache.get(template);
    if(cached)return cached;
    const result=(async()=>{
      const rewrite=await (rewriter ??= input.resolveRewrite());
      abortIf(input.signal);
      if(!rewrite)return input.base;
      const instructions=["将给定场景转成一段图片生成提示词，只输出画面描述。保持角色身份、出图范围、场景和参考图关系；不添加用户未表达的主动选择。不要输出推理或说明。",
        template ? `按以下输出模板的结构和字段填写本轮画面描述。只输出填写后的画面内容，不输出模板指令本身。${String.fromCharCode(10)}${template}`
          : "分别用服装、场景、光线、镜头四行标明视觉设定。"].join(" ");
      const text=await rewrite([{role:"system",content:instructions},{role:"user",content:input.base}]);
      abortIf(input.signal);
      if(!text.trim() || text.length>12000)throw new Error("rewrite_failed");
      return text.trim();
    })();
    cache.set(template,result);
    return result;
  };
}

async function checkRunningJob(tx:db.DbTransaction,request:PreparedSceneImageRequest,signal:AbortSignal) {
  await checkSnapshot(tx,request);
  const [row]=await tx.select().from(jobs).where(scope(request.userId,request.operationId)).limit(1).for("update");
  abortIf(signal);
  if(!row || row.status !== "running" || row.deadline.getTime()<=Date.now())throw new SceneImageProviderError("cancelled","配图已取消。");
}

function buildPromptResolver(request:PreparedSceneImageRequest,reply:string,signal:AbortSignal) {
  const scene=request.scene;
  const base=["为当前对话生成一张场景插图。参考图按角色标识绑定，保持身份和现有场景设定。",
    `角色：${request.personaName}`,`出图范围：${sceneImageIncludesUser(scene,request.message,reply)?"双人":"仅人物，不使用用户参考图"}`,scene ? `场景：${scene.name}\n${scene.description ?? ""}`:"",
    scene?.personaIdentityOverride ? `角色身份：${scene.personaIdentityOverride}`:"",
    scene?.userIdentityOverride ? `用户身份：${scene.userIdentityOverride}`:"",
    scene?.sceneVisualBaseline ? `画面基线：${scene.sceneVisualBaseline}`:"",
    `用户描述：${request.message}`,`对话回应：${reply.slice(0,6000)}`].filter(Boolean).join("\n");
  return createSceneImagePromptResolver({base,comfyPromptTemplate:request.config.comfyPromptTemplate,signal,async resolveRewrite(){
    let resolved:Awaited<ReturnType<typeof resolveSingleProviderForUser>>;
    try {
      const summary=await getSceneImageConfig(request.userId);
      const selected=request.config.promptRewriteRelayId ?? summary.promptRewriteDefaultRelayId;
      if(selected === null)return null;
      const option=summary.promptRewriteRelayOptions.find(item=>item.relayId===selected);
      if(!option)throw new Error("missing");
      abortIf(signal);
      resolved=await resolveSingleProviderForUser({userId:request.userId,providerName:option.providerName,relayId:selected});
      if(!resolved.relayEnabled)throw new Error("disabled");
    }catch(error){abortIf(signal);throw new Error("rewrite_failed");}
    return async messages=>{
      await withSceneImageConfigRevision(request.userId,request.config.revision,tx=>checkRunningJob(tx,request,signal));
      abortIf(signal);
      try {
        return await resolved.provider.invoke(messages,{signal,purpose:"scene_image_prompt",maxTokens:1000,requestTimeoutMs:30_000});
      }catch(error){abortIf(signal);throw new Error("rewrite_failed");}
    };
  }});
}
async function generateOrdered(request:PreparedSceneImageRequest,promptForRelay:ReturnType<typeof createSceneImagePromptResolver>,references:SceneImageReference[],signal:AbortSignal) {
  const {userId,operationId:id,config}=request;
  const candidates=orderSceneImageRelays(config);let last:unknown;
  for(const relay of candidates){
    abortIf(signal);
    const prompt=await promptForRelay(relay);
    await withSceneImageConfigRevision(userId,config.revision,async tx=>{
      await checkRunningJob(tx,request,signal);
      await tx.update(jobs).set({relayId:relay.id,relayName:relay.relayName,model:relay.model,promptText:prompt,attempt:sql`${jobs.attempt} + 1`,updatedAt:new Date()}).where(scope(userId,id));
    });
    abortIf(signal);
    try {
      return {image:await generateSceneImage({relay,prompt,references,signal}),prompt};
    }catch(error){
      last=error;abortIf(signal);
      if(!(error instanceof SceneImageProviderError) || !error.safeToSwitch)throw error;
    }
  }
  throw last ?? new SceneImageProviderError("invalid_config","没有可用的图片接口。");
}
async function executeJob(request:PreparedSceneImageRequest,options:{reply:string;signal?:AbortSignal;beforePublish?:(tx:db.DbTransaction)=>Promise<void>}) {
  const {userId,operationId:id}=request;const started=Date.now();
  const op=operationSignal(userId,id,request.deadline,options.signal);let outputKey:string|undefined;
  try {
    abortIf(op.signal);
    await withSceneImageConfigRevision(userId,request.config.revision,tx=>checkRunningJob(tx,request,op.signal));
    const promptForRelay=buildPromptResolver(request,options.reply,op.signal);
    const references=await referencesFor(userId,request.config,request.scene,sceneImageIncludesUser(request.scene,request.message,options.reply));
    const {image,prompt}=await generateOrdered(request,promptForRelay,references,op.signal);abortIf(op.signal);
    const output=await writeSceneImageOutput(userId,image.buffer,image.mimeType);outputKey=output.key;
    await withSceneImageConfigRevision(userId,request.config.revision,async tx=>{
      await options.beforePublish?.(tx);
      await checkSnapshot(tx,request,true);
      const [row]=await tx.select().from(jobs).where(scope(userId,id)).limit(1).for("update");
      abortIf(op.signal);
      if(!row || row.status !== "running" || row.deadline.getTime()<=Date.now())throw new SceneImageProviderError("cancelled","配图已取消。");
      if(request.scene && !request.scene.isBuiltin && request.scene.userId === userId && !request.scene.sceneVisualBaseline?.trim()) {
        await tx.update(scenes).set({sceneVisualBaseline:sceneImageVisualBaseline(prompt,request.scene)}).where(and(eq(scenes.id,request.scene.id),eq(scenes.userId,userId)));
      }
      const messageId=await db.createMessage({userId,personaId:request.personaId,sceneId:request.sceneId,role:"assistant",
        content:"[场景配图]",messageType:"image",mediaUrl:output.url,channel:request.channel},tx);
      await tx.update(jobs).set({status:"succeeded",outputKey:output.key,messageId,referenceMode:image.referenceMode,durationMs:Date.now()-started,updatedAt:new Date()})
        .where(scope(userId,id));
    });
    outputKey=undefined;
  }catch(error){
    const code=op.signal.aborted ? Date.now()>=request.deadline ? "timeout":"cancelled" : error instanceof Error && error.message === "rewrite_failed" ? "rewrite_failed":safeError(error);
    const status:SceneImageJobStatus=code === "cancelled" || code === "context_changed" ? "cancelled" : ["timeout","unknown","network_error"].includes(code)?"unknown":"failed";
    await terminal(userId,id,status,code,Date.now()-started).catch(()=>{});
  }finally {
    op.cleanup();if(outputKey)await deleteSceneImageOutput(userId,outputKey).catch(()=>{});
  }
}
export async function startSceneImageJob(request:PreparedSceneImageRequest,options:{reply:string;signal?:AbortSignal;beforePublish?:(tx:db.DbTransaction)=>Promise<void>}) {
  const connection=await database();
  const rows=await connection.update(jobs).set({status:"running",updatedAt:new Date()})
    .where(and(scope(request.userId,request.operationId),eq(jobs.status,"pending"),gte(jobs.deadline,new Date()))).returning({id:jobs.id});
  if(rows.length)void executeJob(request,options);
  return getSceneImageJob(request.userId,request.operationId);
}
export async function waitForSceneImageJob(userId:number,id:string,signal?:AbortSignal) {
  for(;;){
    if(signal?.aborted)await cancelSceneImageOperation(userId,id);
    const result=await getSceneImageJob(userId,id);
    if(!pendingStatuses.includes(result.status))return result;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
}
export async function listSceneImageRelayModels(userId:number,expectedRevision:number,input:SceneImageRelayInput) {
  const relay=await resolveSceneImageRelayDraft(userId,expectedRevision,input);
  const models=await listSceneImageModels({relay});
  return {models:models.map(item=>({id:item.id,displayName:item.label})),filteredToImageModels:false,message:"请确认所选模型支持所需图片生成与参考图能力。"};
}
export async function testSceneImageRelay(userId:number,input:SceneImageRelayInput & {expectedRevision:number;operationId:string;testMode:"neutral"|"scene";scenePrompt?:string}) {
  checkOperation(input.operationId);const relay=await resolveSceneImageRelayDraft(userId,input.expectedRevision,input);
  const config=await getSceneImageRuntimeConfig(userId);const id=input.operationId;const started=Date.now();const deadline=started+TOTAL_MS;
  await withSceneImageConfigRevision(userId,input.expectedRevision,async tx=>{
    const added=await tx.insert(jobs).values({userId,id,configRevision:input.expectedRevision,kind:"test",status:"running",relayId:relay.id,testMode:input.testMode,deadline:new Date(deadline)})
      .onConflictDoNothing().returning({id:jobs.id});
    if(!added.length)throw new TRPCError({code:"CONFLICT",message:"这次测试已取消或已处理。"});
  });
  const op=operationSignal(userId,id,deadline);let outputKey:string|undefined;
  try {
    const references=input.testMode === "scene" ? await referencesFor(userId,config,null):[];
    const prompt=input.testMode === "scene" ? input.scenePrompt?.trim() || "自然光中的人物场景插图，按标记保持人物身份。":"白色桌面上一个蓝色陶瓷杯，柔和自然光，静物摄影。";
    await withSceneImageConfigRevision(userId,input.expectedRevision,async tx=>{
      const [row]=await tx.select().from(jobs).where(scope(userId,id)).limit(1).for("update");abortIf(op.signal);
      if(!row || row.status !== "running")throw new SceneImageProviderError("cancelled","配图已取消。");
      await tx.update(jobs).set({relayName:relay.relayName,model:relay.model,promptText:prompt,attempt:1,updatedAt:new Date()}).where(scope(userId,id));
    });
    const image=await generateSceneImage({relay:relay,prompt,references,signal:op.signal});abortIf(op.signal);
    const output=await writeSceneImageOutput(userId,image.buffer,image.mimeType,true);outputKey=output.key;
    await withSceneImageConfigRevision(userId,input.expectedRevision,async tx=>{
      const [row]=await tx.select().from(jobs).where(scope(userId,id)).limit(1).for("update");abortIf(op.signal);
      if(!row || row.status !== "running")throw new SceneImageProviderError("cancelled","配图已取消。");
      await tx.update(jobs).set({status:"succeeded",outputKey:output.key,referenceMode:image.referenceMode,durationMs:Date.now()-started,updatedAt:new Date()}).where(scope(userId,id));
    });outputKey=undefined;
  }catch(error){const code=op.signal.aborted ? Date.now()>=deadline ? "timeout":"cancelled":safeError(error);
    await terminal(userId,id,code === "cancelled" || code === "context_changed"?"cancelled":["timeout","unknown","network_error"].includes(code)?"unknown":"failed",code,Date.now()-started);
  }finally{op.cleanup();if(outputKey)await deleteSceneImageOutput(userId,outputKey).catch(()=>{});}
  const result=await getSceneImageJob(userId,id);
  return {...result,success:result.status === "succeeded",reason:result.status,testMode:input.testMode,recorded:true,
    isSavedRelay:relay.id !== null,enabledForSceneImages:relay.enabled,durationMs:result.durationMs ?? Date.now()-started};
}
export async function getSceneImageLogDetails(userId:number,input:{from?:Date;to?:Date;personaId?:number;relayId?:number;success?:boolean;limit?:number}={}) {
  await expireJobs(userId);const connection=await database();
  const rows=await connection.select().from(jobs).where(and(eq(jobs.userId,userId),
    input.from?gte(jobs.createdAt,input.from):undefined,input.to?lte(jobs.createdAt,input.to):undefined,
    input.personaId?eq(jobs.personaId,input.personaId):undefined,input.relayId?eq(jobs.relayId,input.relayId):undefined,
    input.success === undefined?undefined:input.success?eq(jobs.status,"succeeded"):inArray(jobs.status,["failed","unknown","cancelled"])))
    .orderBy(desc(jobs.createdAt)).limit(input.limit ?? 50);
  return {source:"database",summary:{calls:rows.length,successfulCalls:rows.filter(row=>row.status === "succeeded").length,
    failedCalls:rows.filter(row=>["failed","unknown","cancelled"].includes(row.status)).length,
    averageDurationMs:rows.length?Math.round(rows.reduce((sum,row)=>sum+(row.durationMs ?? 0),0)/rows.length):0},records:rows.map(row=>({...publicJob(row),userId,personaId:row.personaId,sceneId:row.sceneId,
    createdAt:row.createdAt.toISOString(),startedAt:row.createdAt.toISOString(),outputUrl:row.status === "succeeded" && row.outputKey ? `/uploads/${row.outputKey}`:null,
    source:row.kind === "test" ? row.testMode === "scene"?"relay_test_scene":"relay_test_neutral":"scene",attempt:row.attempt,promptText:row.promptText,
    relayName:row.relayName,model:row.model,success:row.status === "succeeded",channel:row.kind === "test" ? "web":row.kind,reason:row.errorCode,trigger:row.kind === "test"?"test":"explicit"}))};
}

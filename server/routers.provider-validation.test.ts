import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * 已注册提供商及明确配置的自定义提供商均受支持。
 * 自定义提供商必须具备当前用户自有的密钥和完整端点，才能写入配置或设为默认。
 * 配置不完整时应明确拒绝，并确保没有数据库写入。
 */

const upsertLlmConfig = vi.fn();
const setDefaultLlmConfig = vi.fn();
const getLlmConfigsByUserId = vi.fn();
const getLlmRelaysByUserId = vi.fn();
const getDefaultLlmConfig = vi.fn();
const updatePersona = vi.fn();
const getPersonaById = vi.fn();
const invalidateUserProviderCache = vi.fn();

vi.mock("./db", () => ({
  normalizeLlmProviderName: (value: string) => value.trim(),
  upsertLlmConfig: (...a: unknown[]) => upsertLlmConfig(...a),
  setDefaultLlmConfig: (...a: unknown[]) => setDefaultLlmConfig(...a),
  getLlmConfigsByUserId: (...a: unknown[]) => getLlmConfigsByUserId(...a),
  getLlmRelaysByUserId: (...a: unknown[]) => getLlmRelaysByUserId(...a),
  getDefaultLlmConfig: (...a: unknown[]) => getDefaultLlmConfig(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

// 本组检验路由参数校验，凭据加密与宿主密钥配置由各自测试负责。
vi.mock("./_core/crypto", () => ({
  encryptSecret: async () => "v1:test-only-ciphertext",
  decryptSecret: async () => null,
  decryptIfEncrypted: async () => null,
}));

vi.mock("./llm/user-provider", () => ({
  invalidateUserProviderCache: (...a: unknown[]) => invalidateUserProviderCache(...a),
  resolveProviderForUser: vi.fn(),
}));

import { appRouter } from "./routers";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      name: `User ${userId}`,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
    },
    req: { headers: {}, method: "GET", url: "/api/trpc/test" } as any,
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("provider names", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    for (const fn of [
      upsertLlmConfig,
      setDefaultLlmConfig,
      getLlmConfigsByUserId,
      getLlmRelaysByUserId,
      getDefaultLlmConfig,
      updatePersona,
      getPersonaById,
      invalidateUserProviderCache,
    ]) {
      fn.mockReset();
    }
    upsertLlmConfig.mockResolvedValue(1);
    getLlmConfigsByUserId.mockResolvedValue([]);
    getLlmRelaysByUserId.mockResolvedValue([]);
    setDefaultLlmConfig.mockResolvedValue(undefined);
    updatePersona.mockResolvedValue(undefined);
    getPersonaById.mockResolvedValue({
      id: 1,
      userId: 1,
      name: "小A",
      analysisStatus: "ready",
      personaData: {},
    });

    caller = appRouter.createCaller(ctxFor(1));
  });

  it("refuses to store a custom provider without its own endpoint", async () => {
    await expect(
      caller.llmConfig.upsert({ providerName: "NotAProvider", apiKey: "sk-test" }),
    ).rejects.toThrow(/自定义提供商须使用你自己的密钥和完整 API 地址/);

    expect(upsertLlmConfig).not.toHaveBeenCalled();
  });

  it("refuses to make an unconfigured custom provider the default", async () => {
    await expect(
      caller.llmConfig.setDefault({ providerName: "NotAProvider" }),
    ).rejects.toThrow(/自定义提供商须先配置你自己的密钥和完整 API 地址/);

    expect(setDefaultLlmConfig).not.toHaveBeenCalled();
  });

  it("refuses to point a persona at a provider that does not exist", async () => {
    await expect(
      caller.persona.update({ id: 1, llmProvider: "NotAProvider" }),
    ).rejects.toThrow(/未知的 LLM 提供商/);

    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("accepts a registered provider", async () => {
    // "OpenAI" is always registered.
    const result = await caller.llmConfig.upsert({
      providerName: "OpenAI",
      apiKey: "sk-test",
    });

    expect(result.id).toBe(1);
    expect(upsertLlmConfig).toHaveBeenCalled();
  });

  it("accepts a persona that points at a registered provider", async () => {
    const result = await caller.persona.update({ id: 1, llmProvider: "OpenAI" });

    expect(result).toEqual({ success: true });
    expect(updatePersona).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), details: vi.fn(), memorySnapshot: vi.fn(), memoryDetails: vi.fn() }));
vi.mock("../db", () => ({ getPersistentLlmUsageSnapshot: mocks.snapshot, getPersistentLlmUsageDetails: mocks.details, getDefaultLlmConfig: vi.fn(async () => null), getLlmConfigsByUserId: vi.fn(async () => []) }));
vi.mock("../llm/usage", () => ({ getLlmUsageSnapshot: mocks.memorySnapshot, getLlmUsageDetails: mocks.memoryDetails }));
vi.mock("../llm-management", () => ({ listUserLlmProviders: vi.fn(async () => []) }));
vi.mock("../llm", () => ({ registry: { getDefaultName: () => "Test", list: () => [] } }));
vi.mock("./notification", () => ({ notifyOwner: vi.fn() }));
import { systemRouter } from "./systemRouter";
function caller(id: number, role = "user") { return systemRouter.createCaller({ user: { id, role }, req: {}, res: {} } as any); }
describe("模型用量读取隔离", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.snapshot.mockResolvedValue({ source: "database" }); mocks.details.mockResolvedValue({ source: "database", records: [] }); mocks.memoryDetails.mockReturnValue({ source: "in-memory-runtime", records: [] }); });
  it("普通用户不能请求其他用户记录", async () => {
    await caller(7).llmUsageDetails({ userId: 99 });
    expect(mocks.details.mock.calls[0][0].userId).toBe(7);
  });
  it("总览和数据库失败回退都保持当前用户", async () => {
    mocks.snapshot.mockResolvedValue(null); mocks.memorySnapshot.mockReturnValue({ today: {} });
    await caller(7).operationsDiagnostics();
    expect(mocks.snapshot).toHaveBeenCalledWith({ userId: 7 });
    expect(mocks.memorySnapshot).toHaveBeenCalledWith(expect.any(Date), { userId: 7 });
    mocks.details.mockRejectedValue(new Error("不可用"));
    await caller(7).llmUsageDetails({ userId: 99 });
    expect(mocks.memoryDetails.mock.calls[0][0].userId).toBe(7);
  });
  it("管理员默认看自己，只有显式选择才查询目标用户", async () => {
    await caller(1, "admin").llmUsageDetails();
    expect(mocks.details.mock.calls[0][0].userId).toBe(1);
    await caller(1, "admin").llmUsageDetails({ userId: 99 });
    expect(mocks.details.mock.calls[1][0].userId).toBe(99);
  });
  it("匿名请求在查询前被拒绝", async () => {
    const anonymous = systemRouter.createCaller({ user: null, req: {}, res: {} } as any);
    await expect(anonymous.llmUsageDetails()).rejects.toThrow();
    expect(mocks.details).not.toHaveBeenCalled();
  });
});

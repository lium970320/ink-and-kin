import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { MediaOperations } from "./operations";

describe("语音取消归属与去重", () => {
  it("预取消和已完成ID均不会重新开始，不影响另一账号", () => {
    const ops = new MediaOperations(), id = randomUUID();
    ops.cancel(1, id);
    expect(() => ops.begin(1, id)).toThrow();
    const other = ops.begin(2, id); expect(other.signal.aborted).toBe(false); other.finish();
    expect(() => ops.begin(2, id)).toThrow();
  });
  it("配置取消全部当前账号任务但不取消另一账号", () => {
    const ops = new MediaOperations(), a = ops.begin(1, randomUUID()), b = ops.begin(1, randomUUID()), c = ops.begin(2, randomUUID());
    ops.cancelUser(1);
    expect([a.signal.aborted,b.signal.aborted,c.signal.aborted]).toEqual([true,true,false]);
    a.finish();b.finish();c.finish();
  });
  it("连接断开取消，正常响应结束不取消，完成会移除监听器", () => {
    const ops = new MediaOperations(); const req = new EventEmitter(), res = Object.assign(new EventEmitter(), { writableEnded: false });
    const op = ops.begin(1, randomUUID(), { req, res } as any);
    res.emit("close"); expect(op.signal.aborted).toBe(true); op.finish();
    expect(req.listenerCount("aborted")).toBe(0);expect(res.listenerCount("close")).toBe(0);
    const normal=ops.begin(1,randomUUID(),{req,res} as any); res.writableEnded=true;res.emit("close");expect(normal.signal.aborted).toBe(false);normal.finish();
  });
});

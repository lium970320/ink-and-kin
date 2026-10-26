import { describe, expect, it } from "vitest";
import { memoryReferencesAnyMessage } from "./chat-history-management";
import { isMessageIncludedInContext } from "./db";

describe("memoryReferencesAnyMessage", () => {
  it("matches a direct source message", () => {
    expect(memoryReferencesAnyMessage({ messageId: 12 }, new Set([12]))).toBe(true);
  });

  it("matches evidence message ids", () => {
    expect(memoryReferencesAnyMessage(
      { messageId: null, evidenceMessageIds: [7, 9] },
      new Set([9]),
    )).toBe(true);
  });

  it("ignores unrelated or malformed evidence", () => {
    expect(memoryReferencesAnyMessage(
      { messageId: 4, evidenceMessageIds: ["9", null] },
      new Set([9]),
    )).toBe(false);
  });
});

describe("isMessageIncludedInContext", () => {
  it("follows the conversation boundary when no manual override exists", () => {
    expect(isMessageIncludedInContext(20, null, 19)).toBe(true);
    expect(isMessageIncludedInContext(19, null, 19)).toBe(false);
  });

  it("lets a manual decision override the conversation boundary", () => {
    expect(isMessageIncludedInContext(5, true, 19)).toBe(true);
    expect(isMessageIncludedInContext(20, false, 19)).toBe(false);
  });
});

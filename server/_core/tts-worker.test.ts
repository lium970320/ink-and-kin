import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const runNode = promisify(execFile);
const workerCheck = String.raw`
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";

const [ttsModule, uploadDir] = process.argv.slice(1);
const native = createRequire(import.meta.url)("node:worker_threads");
const Worker = native.Worker;
const stub = 'export async function tts(text, {voice}) { return Buffer.from(JSON.stringify({text, voice})); }';
const moduleUrl = 'data:text/javascript,' + encodeURIComponent(stub);
let isolatedWorkers = 0;
native.Worker = class IsolatedWorker extends Worker {
  constructor(filename, options) {
    assert(filename instanceof URL && filename.protocol === "data:");
    super(filename, { ...options, workerData: { ...options.workerData, moduleUrl } });
    isolatedWorkers++;
  }
};
syncBuiltinESMExports();
// Prove that the production ESM import will use the replacement before loading it.
assert.equal((await import("node:worker_threads")).Worker, native.Worker);
const { createTtsGenerator } = await import(ttsModule);
const generate = createTtsGenerator({ uploadDir: () => uploadDir });
const url = await generate('我 & 你 <break time="1s"/> \' &amp;', "zh-CN-XiaoxiaoNeural", 72);
assert.equal(isolatedWorkers, 1);
process.stdout.write(await readFile(path.join(uploadDir, url.slice("/uploads/".length)), "utf8"));
`;

describe("Edge TTS 工作线程的 SSML 文本", () => {
  it("向不转义的 SDK 只传转义一次的纯文本", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ink-tts-worker-"));
    try {
      const ttsModule = new URL("./tts.ts", import.meta.url).href;
      const cwd = fileURLToPath(new URL("../../", import.meta.url));
      // The native Node subprocess keeps import.meta.resolve and replaces the SDK
      // input before the real production worker is created.
      const { stdout } = await runNode(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", workerCheck, ttsModule, dir], {
        cwd, timeout: 10_000, windowsHide: true, maxBuffer: 64 * 1024,
      });
      expect(JSON.parse(stdout)).toEqual({ text: "我 &amp; 你 &lt;break time=&quot;1s&quot;/&gt; &apos; &amp;amp;", voice: "zh-CN-XiaoxiaoNeural" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);
});

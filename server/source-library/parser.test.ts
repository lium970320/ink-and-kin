import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSourceBytes, prepareSourceBytes, SOURCE_PARSER_LIMITS } from "./parser";
import { SOURCE_LIBRARY_LIMITS } from "./core";

/** Small ZIP fixture builder: no filesystem, Python, network, or installed ZIP executable. */
type ZipPart = { name: string; text?: string; bytes?: Buffer; flags?: number; deflate?: boolean; declaredSize?: number };

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of Array.from(bytes)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFixture(parts: ZipPart[]): Buffer {
  const bodies: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name, "utf8");
    const plain = part.bytes ?? Buffer.from(part.text ?? "", "utf8");
    const data = part.deflate ? deflateRawSync(plain) : plain;
    const method = part.deflate ? 8 : 0;
    const flags = 0x800 | (part.flags ?? 0);
    const checksum = crc32(plain);
    const size = part.declaredSize ?? plain.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    bodies.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, central, end]);
}

function epubParts(overrides: { container?: string; opf?: string; first?: string; second?: string } = {}): ZipPart[] {
  return [
    { name: "mimetype", text: "application/epub+zip" },
    { name: "META-INF/container.xml", text: overrides.container ?? '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: "OPS/package.opf", text: overrides.opf ?? '<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>合成旅记</dc:title></metadata><manifest><item id="one" href="first.xhtml" media-type="application/xhtml+xml"/><item id="two" href="second.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="two"/><itemref idref="one"/></spine></package>' },
    { name: "OPS/first.xhtml", text: overrides.first ?? '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>码头</title><style>隐藏样式</style></head><body><h1>第一章 码头</h1><p>地图在<span>灯塔</span>。</p><script>禁止执行</script><p>短章。</p></body></html>', deflate: true },
    { name: "OPS/second.xhtml", text: overrides.second ?? '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><h2>第二章 山路</h2><p>旅人回到山谷。&amp; &#x1F331;</p></body></html>', deflate: true },
  ];
}

afterEach(() => { vi.restoreAllMocks(); });

describe("严格文本解码", () => {
  it("接受 UTF-8 与 BOM 标识的 UTF-16 两种字节序", async () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("地图在桌上。\r\n", "utf16le")]);
    const be = Buffer.from(le);
    be.swap16();
    expect(decodeSourceBytes(le)).toBe("地图在桌上。\r\n");
    expect(decodeSourceBytes(be)).toBe("地图在桌上。\r\n");
    for (const bytes of [Buffer.from("地图在桌上。"), le, be]) {
      const result = await prepareSourceBytes({ fileName: "设定.txt", bytes });
      expect(result.chunks[0].content).toContain("地图在桌上。");
      expect(result.fileHash).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(result.byteSize).toBe(bytes.length);
    }
  });

  it("拒绝无 BOM 的 UTF-16、乱码字节、截断编码和不一致的 XML 声明", async () => {
    for (const bytes of [Buffer.from([0xff, 0x61]), Buffer.from([0xe4, 0xb8]), Buffer.from([0xff, 0xfe, 0x61]), Buffer.from("a\0b\0"), Buffer.from('<?xml version="1.0" encoding="gb18030"?><p>正文</p>')]) {
      await expect(prepareSourceBytes({ fileName: "资料.txt", bytes })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("拒绝空文、超大原文件和伪装为 EPUB 的文本", async () => {
    await expect(prepareSourceBytes({ fileName: "空.txt", bytes: Buffer.alloc(0) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(prepareSourceBytes({ fileName: "大.txt", bytes: Buffer.alloc(SOURCE_LIBRARY_LIMITS.maxFileBytes + 1) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(prepareSourceBytes({ fileName: "书.epub", bytes: Buffer.from("不是压缩包") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("受限 EPUB 章节纯文本导入", () => {
  it("遵从 spine 而非 ZIP 顺序，保留短章和内联文本顺序，剔除脚本样式", async () => {
    const bytes = zipFixture(epubParts());
    const result = await prepareSourceBytes({ fileName: "folder/旅记.epub", bytes });
    expect(result).toMatchObject({ title: "合成旅记", fileName: "旅记.epub", format: "epub", byteSize: bytes.length });
    expect(result.chunks.map(chunk => chunk.chapterTitle)).toEqual(["第二章 山路", "第一章 码头"]);
    expect(result.chunks[0].content).toContain("& 🌱");
    expect(result.chunks[1].content).toContain("地图在灯塔。");
    expect(result.chunks[1].content).toContain("短章。");
    expect(result.chunks.map(chunk => chunk.content).join("\n")).not.toMatch(/隐藏样式|禁止执行|<p>|<span>/);
    const normalized = result.chunks.map(chunk => chunk.content).join("\n\n");
    for (const chunk of result.chunks) expect(chunk.content).toBe(normalized.slice(chunk.startOffset, chunk.endOffset));
  });

  it("显式标题覆盖元数据，支持百分号路径并忽略图片资源", async () => {
    const parts = epubParts();
    parts[2].text = parts[2].text!.replace('href="first.xhtml"', 'href="first%20chapter.xhtml"').replace("</manifest>", '<item id="cover" href="cover.png" media-type="image/png"/></manifest>');
    parts[3].name = "OPS/first chapter.xhtml";
    parts.push({ name: "OPS/cover.png", bytes: Buffer.from([0xff, 0x00, 0x81]) });
    const result = await prepareSourceBytes({ fileName: "书.epub", title: "新标题", bytes: zipFixture(parts) });
    expect(result.title).toBe("新标题");
    expect(result.chunks).toHaveLength(2);
  });

  it("无正文、错误阅读引用、缺失资源和错误 XML 都失败，不静默少导章节", async () => {
    const examples = [
      epubParts({ first: "<html><body><img src=\"x.png\"/></body></html>", second: "<html><body/></html>" }),
      epubParts({ opf: '<package><manifest/><spine><itemref idref="missing"/></spine></package>' }),
      epubParts().filter(part => part.name !== "OPS/first.xhtml"),
      epubParts({ first: "<html><body><p>未闭合</body></html>" }),
      epubParts().filter(part => part.name !== "META-INF/container.xml"),
    ];
    for (const parts of examples) await expect(prepareSourceBytes({ fileName: "书.epub", bytes: zipFixture(parts) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("拒绝加密、重复条目、非法路径、外链资源及 XML 实体声明", async () => {
    const encrypted = epubParts(); encrypted[3].flags = 1;
    const external = epubParts(); external[2].text = external[2].text!.replace('href="first.xhtml"', 'href="https://example.invalid/first.xhtml"');
    const traversal = epubParts(); traversal[2].text = traversal[2].text!.replace('href="first.xhtml"', 'href="../../outside.xhtml"');
    const entity = epubParts({ first: '<!DOCTYPE html [<!ENTITY text "正文">]><html><body>&text;</body></html>' });
    for (const parts of [encrypted, [...epubParts(), { name: "META-INF/encryption.xml", text: "<encryption/>" }], [...epubParts(), epubParts()[0]], [...epubParts(), { name: "../outside", text: "正文" }], external, traversal, entity]) {
      await expect(prepareSourceBytes({ fileName: "书.epub", bytes: zipFixture(parts) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("归档条目数、单资源展开量、异常压缩率与 XML 深度有界", async () => {
    const many = Array.from({ length: SOURCE_PARSER_LIMITS.maxArchiveEntries + 1 }, (_, index) => ({ name: `entry-${index}`, text: "" }));
    const large = [...epubParts(), { name: "large.bin", text: "正文", declaredSize: SOURCE_PARSER_LIMITS.maxEntryBytes + 1, deflate: true }];
    const ratio = [...epubParts(), { name: "ratio.bin", bytes: Buffer.alloc(2 * 1024 * 1024), deflate: true }];
    const deep = epubParts({ first: `<html><body>${"<div>".repeat(110)}正文${"</div>".repeat(110)}</body></html>` });
    for (const parts of [many, large, ratio, deep]) await expect(prepareSourceBytes({ fileName: "书.epub", bytes: zipFixture(parts) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("总声明展开量同样有界，不必解压无关资源", async () => {
    // Compressed fixture data is deliberately small; only directory metadata is needed for this rejection.
    const padding = Array.from({ length: 9 }, (_, index) => {
      let state = 123456789 + index;
      const bytes = Buffer.alloc(20000);
      for (let position = 0; position < bytes.length; position++) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        bytes[position] = state & 255;
      }
      return { name: `padding-${index}.bin`, bytes, deflate: true, declaredSize: 8 * 1024 * 1024 };
    });
    await expect(prepareSourceBytes({ fileName: "书.epub", bytes: zipFixture([...epubParts(), ...padding]) })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "EPUB 展开后超过 64 MiB 限制。" });
  });

  it("响应开始前和异步读取中的取消，且错误不含正文或内部路径", async () => {
    const first = new AbortController(); first.abort();
    await expect(prepareSourceBytes({ fileName: "书.epub", bytes: zipFixture(epubParts()), signal: first.signal })).rejects.toMatchObject({ name: "AbortError" });
    const second = new AbortController();
    const pending = prepareSourceBytes({ fileName: "书.epub", bytes: zipFixture(epubParts()), signal: second.signal });
    second.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const parts = epubParts(); parts[1].text = "<不完整";
    await expect(prepareSourceBytes({ fileName: "书.epub", bytes: zipFixture(parts) })).rejects.toMatchObject({ message: "EPUB 包含无效的 XML 或 XHTML。" });
  });

  it("解析总截止时间包含分块阶段", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(SOURCE_PARSER_LIMITS.maxParseTimeMs + 1);
    await expect(prepareSourceBytes({ fileName: "资料.txt", bytes: Buffer.from("正文") })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "原文解析超时，请拆分文件后重试。" });
  });
});

import { createHash } from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";
import * as yauzl from "yauzl";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  prepareSourceSections, sourceFileIdentity, SourceLibraryError, SOURCE_LIBRARY_LIMITS,
  type PreparedSource, type SourceSection,
} from "./core";

export const SOURCE_PARSER_LIMITS = {
  maxArchiveEntries: 4000,
  maxEntryBytes: 8 * 1024 * 1024,
  maxExpandedBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 1000,
  maxParseTimeMs: 15000,
  maxXmlDepth: 100,
  maxXmlNodes: 200000,
} as const;

function invalid(message: string): SourceLibraryError {
  return new SourceLibraryError("BAD_REQUEST", message);
}

function cancelled(): Error {
  const error = new Error("原文解析已取消。");
  error.name = "AbortError";
  return error;
}

/** No encoding guessing: UTF-8, or UTF-16 explicitly identified by a BOM. */
export function decodeSourceBytes(bytes: Buffer): string {
  let encoding: "utf-8" | "utf-16le" | "utf-16be" = "utf-8";
  if (bytes.length >= 4 && ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) || (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff))) {
    throw invalid("不支持 UTF-32，请转换为 UTF-8 或带 BOM 的 UTF-16。");
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    const declaration = text.match(/^\s*<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase();
    if (declaration && !(encoding === "utf-8" ? ["utf-8", "utf8"].includes(declaration) : ["utf-16", encoding].includes(declaration))) {
      throw invalid("文本编码声明与 UTF-8 或带 BOM 的 UTF-16 不一致。");
    }
    return text;
  } catch (error) {
    if (error instanceof SourceLibraryError) throw error;
    throw invalid("文件编码无效，请使用 UTF-8 或带 BOM 的 UTF-16。");
  }
}

type XmlNode = Record<string, unknown>;

function safeXml(text: string, preserveOrder: boolean): unknown {
  if (/<!ENTITY\b/i.test(text) || /<!DOCTYPE[^>]*\[/i.test(text)) throw invalid("EPUB 不支持自定义 XML 实体。");
  // A simple document type declaration is not fetched or resolved.
  const xml = text.replace(/<!DOCTYPE[^>]*>/gi, "");
  let depth = 0;
  let nodes = 0;
  const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(xml)) !== null) {
    const tag = match[0];
    if (tag.startsWith("<!")) continue;
    if (++nodes > SOURCE_PARSER_LIMITS.maxXmlNodes) throw invalid("EPUB XML 节点过多。");
    if (tag.startsWith("</")) depth--;
    else if (!tag.endsWith("/>")) depth++;
    if (depth > SOURCE_PARSER_LIMITS.maxXmlDepth) throw invalid("EPUB XML 层级过深。");
  }
  if (XMLValidator.validate(xml) !== true) throw invalid("EPUB 包含无效的 XML 或 XHTML。");
  try {
    return new XMLParser({
      preserveOrder, ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true,
      processEntities: false, trimValues: false, parseTagValue: false, parseAttributeValue: false,
      ignoreDeclaration: true, ignorePiTags: true,
    }).parse(xml);
  } catch {
    throw invalid("EPUB XML 解析失败。");
  }
}

function record(value: unknown): XmlNode {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as XmlNode : {};
}
function array(value: unknown): unknown[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function scalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return scalar(record(value)["#text"] ?? "");
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", hellip: "…", mdash: "—", ndash: "–" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? whole;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

function archivePath(reference: string, directory = ""): string {
  let decoded: string;
  try { decoded = decodeURIComponent(decodeEntities(reference).split("#")[0]); }
  catch { throw invalid("EPUB 资源路径编码无效。"); }
  if (!decoded || decoded.length > 1024 || /[\\\u0000-\u001f?#]/.test(decoded) || /^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(decoded)) throw invalid("EPUB 资源路径无效。");
  const result = path.posix.normalize(path.posix.join(directory, decoded));
  if (result === ".." || result.startsWith("../") || result.startsWith("/")) throw invalid("EPUB 资源路径越界。");
  return result;
}

const BLOCK_TAGS = new Set(["p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "tr", "br", "hr"]);
const OMIT_TAGS = new Set(["script", "style", "head", "svg", "math", "iframe", "object", "noscript"]);

/** Ordered XHTML traversal; no HTML is returned or executed. */
function sectionFromXhtml(text: string, fallbackTitle: string, check: () => void): SourceSection {
  const nodes = array(safeXml(text, true));
  let chapterTitle = "";
  let documentTitle = "";
  function plainText(values: unknown[]): string {
    check();
    return values.map(value => Object.entries(record(value)).map(([tag, children]) => {
      if (tag === ":@") return "";
      if (tag === "#text" || tag === "#cdata") return decodeEntities(scalar(children));
      return plainText(array(children));
    }).join("")).join("");
  }
  function readDocumentTitle(values: unknown[]): void {
    check();
    for (const value of values) {
      for (const [tag, children] of Object.entries(record(value))) {
        if (tag === ":@" || tag.startsWith("#")) continue;
        if (tag.toLowerCase() === "title") documentTitle ||= plainText(array(children)).trim().slice(0, 160);
        else readDocumentTitle(array(children));
      }
    }
  }
  readDocumentTitle(nodes);
  function collect(values: unknown[], level = 0): string {
    check();
    if (level > SOURCE_PARSER_LIMITS.maxXmlDepth) throw invalid("EPUB XHTML 层级过深。");
    const parts: string[] = [];
    for (const value of values) {
      for (const [tag, children] of Object.entries(record(value))) {
        if (tag === ":@") continue;
        if (tag === "#text" || tag === "#cdata") { parts.push(decodeEntities(scalar(children))); continue; }
        if (OMIT_TAGS.has(tag.toLowerCase())) continue;
        const body = collect(array(children), level + 1);
        if (!chapterTitle && /^(?:h1|h2)$/i.test(tag) && body.trim()) chapterTitle = body.trim().slice(0, 160);
        parts.push(BLOCK_TAGS.has(tag.toLowerCase()) ? `\n${body}\n` : body);
      }
    }
    return parts.join("");
  }
  const body = collect(nodes).replace(/\u3000/g, " ").split("\n").map(line => line.replace(/[\t ]+/g, " ").trim()).filter(Boolean).join("\n");
  return { title: chapterTitle || documentTitle || fallbackTitle, text: body };
}

async function parseEpub(bytes: Buffer, signal: AbortSignal | undefined, deadline: number): Promise<{ title?: string; sections: SourceSection[] }> {
  let zip: yauzl.ZipFile | undefined;
  let activeStream: { destroy(error?: Error): void } | undefined;
  let rejectPending: ((error: Error) => void) | undefined;
  let interruption: Error | undefined;
  const check = () => {
    if (signal?.aborted) throw cancelled();
    if (interruption) throw interruption;
    if (Date.now() >= deadline) throw invalid("原文解析超时，请拆分文件后重试。");
  };
  const interrupt = (error: Error) => {
    interruption = error;
    activeStream?.destroy(error);
    zip?.close();
    rejectPending?.(error);
  };
  const onAbort = () => interrupt(cancelled());
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => interrupt(invalid("原文解析超时，请拆分文件后重试。")), Math.max(1, deadline - Date.now()));
  try {
    check();
    zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
      rejectPending = reject;
      yauzl.fromBuffer(bytes, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, archive) => {
        if (error || !archive) { reject(invalid("无法读取 EPUB 压缩包。")); return; }
        if (interruption || signal?.aborted) { archive.close(); reject(interruption ?? cancelled()); return; }
        resolve(archive);
      });
    });
    const archive = zip;
    const entries = new Map<string, yauzl.Entry>();
    let expandedBytes = 0;
    await new Promise<void>((resolve, reject) => {
      rejectPending = reject;
      archive.on("error", () => rejectPending?.(invalid("EPUB 压缩包已损坏。")));
      archive.on("end", resolve);
      archive.on("entry", (entry: yauzl.Entry) => {
        try {
          check();
          const name = entry.fileName;
          if ((entry.generalPurposeBitFlag & 1) !== 0 || name === "META-INF/encryption.xml") throw invalid("暂不支持加密 EPUB。");
          if (entries.size >= SOURCE_PARSER_LIMITS.maxArchiveEntries) throw invalid("EPUB 文件条目过多。");
          if (name.length > 1024 || /[\\\u0000-\u001f]/.test(name) || name.startsWith("/") || name.split("/").includes("..") || /^[a-z]:/i.test(name) || path.posix.normalize(name) !== name) throw invalid("EPUB 包含非法路径。");
          if (entries.has(name)) throw invalid("EPUB 包含重复资源路径。");
          if (entry.uncompressedSize > SOURCE_PARSER_LIMITS.maxEntryBytes) throw invalid("EPUB 单个资源超过 8 MiB 限制。");
          expandedBytes += entry.uncompressedSize;
          if (expandedBytes > SOURCE_PARSER_LIMITS.maxExpandedBytes) throw invalid("EPUB 展开后超过 64 MiB 限制。");
          if (entry.uncompressedSize > Math.max(1024 * 1024, entry.compressedSize * SOURCE_PARSER_LIMITS.maxCompressionRatio)) throw invalid("EPUB 压缩比例异常。");
          entries.set(name, entry);
          archive.readEntry();
        } catch (error) { reject(error); }
      });
      archive.readEntry();
    });
    let readBytes = 0;
    const readText = async (name: string): Promise<string> => {
      check();
      const entry = entries.get(name);
      if (!entry || name.endsWith("/")) throw invalid("EPUB 缺少必要的正文或结构文件。");
      const data = await new Promise<Buffer>((resolve, reject) => {
        rejectPending = reject;
        archive.openReadStream(entry, (error, stream) => {
          if (error || !stream) { reject(invalid("EPUB 资源读取失败。")); return; }
          if (interruption || signal?.aborted) { stream.destroy(); reject(interruption ?? cancelled()); return; }
          activeStream = stream;
          const buffers: Buffer[] = [];
          let length = 0;
          stream.on("error", () => reject(interruption ?? invalid("EPUB 资源解压失败。")));
          stream.on("data", (chunk: Buffer) => {
            try {
              check();
              length += chunk.length;
              readBytes += chunk.length;
              if (length > SOURCE_PARSER_LIMITS.maxEntryBytes || readBytes > SOURCE_PARSER_LIMITS.maxExpandedBytes) throw invalid("EPUB 实际展开量超过限制。");
              buffers.push(chunk);
            } catch (failure) { stream.destroy(); reject(failure); }
          });
          stream.on("end", () => {
            activeStream = undefined;
            if (length !== entry.uncompressedSize) reject(invalid("EPUB 资源长度不一致。"));
            else resolve(Buffer.concat(buffers, length));
          });
        });
      });
      check();
      return decodeSourceBytes(data);
    };
    if (entries.has("mimetype") && (await readText("mimetype")).trim() !== "application/epub+zip") throw invalid("文件不是有效的 EPUB。");
    const container = record(record(safeXml(await readText("META-INF/container.xml"), false)).container);
    const rootfiles = array(record(container.rootfiles).rootfile).map(record);
    const rootfile = rootfiles.find(item => item["@_media-type"] === "application/oebps-package+xml") ?? rootfiles[0];
    if (!rootfile) throw invalid("EPUB 未声明书籍结构文件。");
    const opfPath = archivePath(scalar(rootfile["@_full-path"]));
    const packageNode = record(record(safeXml(await readText(opfPath), false)).package);
    const metadata = record(packageNode.metadata);
    const title = decodeEntities(scalar(array(metadata.title)[0])).trim().slice(0, 200) || undefined;
    const manifest = new Map<string, { href: string; mediaType: string }>();
    for (const item of array(record(packageNode.manifest).item).map(record)) {
      const id = scalar(item["@_id"]);
      if (!id || manifest.has(id)) throw invalid("EPUB 资源清单标识无效或重复。");
      manifest.set(id, { href: scalar(item["@_href"]), mediaType: scalar(item["@_media-type"]) });
    }
    const spine = array(record(packageNode.spine).itemref).map(record);
    if (!spine.length) throw invalid("EPUB 未包含阅读顺序。");
    const sections: SourceSection[] = [];
    const seen = new Set<string>();
    let textBytes = 0;
    for (const itemref of spine) {
      check();
      const item = manifest.get(scalar(itemref["@_idref"]));
      if (!item) throw invalid("EPUB 阅读顺序引用了不存在的资源。");
      if (!["application/xhtml+xml", "text/html"].includes(item.mediaType)) continue;
      const href = archivePath(item.href, path.posix.dirname(opfPath));
      if (seen.has(href)) continue;
      seen.add(href);
      const section = sectionFromXhtml(await readText(href), path.posix.basename(href), check);
      textBytes += Buffer.byteLength(section.text, "utf8") + 2;
      if (textBytes > SOURCE_LIBRARY_LIMITS.maxTextBytes) throw invalid("解析后的文本超过 32 MiB 限制。");
      if (section.text.trim()) sections.push(section);
    }
    check();
    if (!sections.length) throw invalid("EPUB 未包含可读取的正文，可能仅有图片或不受支持的内容。");
    return { title, sections };
  } catch (error) {
    if (error instanceof SourceLibraryError || (error instanceof Error && error.name === "AbortError")) throw error;
    throw invalid("EPUB 解析失败，请检查文件格式。");
  } finally {
    rejectPending = undefined;
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    activeStream?.destroy();
    zip?.close();
  }
}

export async function prepareSourceBytes(input: { fileName: string; bytes: Buffer; title?: string; signal?: AbortSignal }): Promise<PreparedSource> {
  if (input.signal?.aborted) throw cancelled();
  const deadline = Date.now() + SOURCE_PARSER_LIMITS.maxParseTimeMs;
  const { fileName, format } = sourceFileIdentity(input.fileName);
  if (!input.bytes.length) throw invalid("请选择包含正文的非空文件。");
  if (input.bytes.length > SOURCE_LIBRARY_LIMITS.maxFileBytes) throw invalid("文件超过 20 MiB 限制。");
  const fileHash = createHash("sha256").update(input.bytes).digest("hex");
  const extracted: { title?: string; sections: SourceSection[] } = format === "epub"
    ? await parseEpub(input.bytes, input.signal, deadline)
    : { sections: [{ title: "", text: decodeSourceBytes(input.bytes) }] };
  if (input.signal?.aborted) throw cancelled();
  const check = () => {
    if (input.signal?.aborted) throw cancelled();
    if (Date.now() >= deadline) throw invalid("原文解析超时，请拆分文件后重试。");
  };
  const prepared = prepareSourceSections({ fileName, format, byteSize: input.bytes.length, fileHash, title: input.title ?? extracted.title, sections: extracted.sections, check });
  if (input.signal?.aborted) throw cancelled();
  if (Date.now() >= deadline) throw invalid("原文解析超时，请拆分文件后重试。");
  return prepared;
}

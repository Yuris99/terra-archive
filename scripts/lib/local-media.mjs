import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";

const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
export function byteRange(value, size) {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const suffix = !match[1];
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix || !match[2] ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return null;
  return { start, end, partial: true };
}
export function createMediaStore(projectRoot) {
  let cached, stamp;
  function index() {
    const filename = path.join(projectRoot, "data/indexes/media-v1/index.json");
    if (!fs.existsSync(filename)) throw new Error("미디어 목록을 먼저 생성해 주세요.");
    const stat = fs.statSync(filename);
    const next = `${stat.mtimeMs}:${stat.size}`;
    if (stamp !== next) { cached = JSON.parse(fs.readFileSync(filename, "utf8")); stamp = next; }
    if (cached.schemaVersion !== 1 || cached.policySha256 !== hash(fs.readFileSync(path.join(projectRoot, "config/retrieval-policy.json"))) ||
      cached.selectionSha256 !== hash(fs.readFileSync(path.join(projectRoot, "data/retrieval/global-v1/manifest.json")))) {
      throw new Error("공개 범위가 변경되었습니다. 미디어 목록을 다시 생성해 주세요.");
    }
    return cached;
  }
  function publicItem(item) {
    return { ...item, url: `/api/archive/media/file?id=${item.id}` };
  }
  function operator(id) {
    const operators = index().operators;
    const entry = Object.hasOwn(operators, id) ? operators[id] : null;
    return entry ? { id: entry.id, name: entry.name, images: entry.images.map(publicItem), voices: entry.voices.map(publicItem) } : null;
  }
  function story(id) {
    const key = id.replace(/^(ko_KR|en_US|ja_JP|zh_CN):/, "");
    const stories = index().stories;
    const entry = Object.hasOwn(stories, key) ? stories[key] : null;
    return entry ? { ...entry, images: entry.images.map(publicItem) } : null;
  }
  return {
    catalog() {
      const data = index();
      return { summary: data.summary, koreanSource: data.koreanSource,
        operators: Object.values(data.operators).filter((entry) => entry.images.length || entry.voices.length).map(({ id, name }) => ({ id, name })),
        stories: Object.values(data.stories).filter((entry) => entry.images.length).map(({ id, title, group, code, phase }) => ({ id, title, group, code, phase })),
        korean: data.korean.map(publicItem) };
    }, operator, story,
    document(id) {
      const key = id.replace(/^(ko_KR|en_US|ja_JP|zh_CN):/, "");
      const subjects = index().documentSubjects;
      const subject = Object.hasOwn(subjects, key) ? subjects[key] : null;
      return subject?.operator ? operator(subject.operator) : subject?.story ? story(subject.story) : null;
    },
    /** @param {string} id @param {string | null} [rangeHeader] @param {boolean} [head] */
    async response(id, rangeHeader = null, head = false) {
      if (!/^[a-f0-9]{32}$/.test(id)) return new Response(null, { status: 404 });
      const entry = index().files[id];
      if (!entry || !entry.path.startsWith("data/raw/arknights-assets2/")) return new Response(null, { status: 404 });
      const root = fs.realpathSync(path.join(projectRoot, "data/raw/arknights-assets2"));
      const target = fs.realpathSync(path.resolve(projectRoot, entry.path));
      const relative = path.relative(root, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return new Response(null, { status: 404 });
      const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp3": "audio/mpeg" }[path.extname(target).toLowerCase()];
      const stat = fs.statSync(target);
      if (!mime || !stat.isFile() || stat.size !== entry.bytes) return new Response(null, { status: 404 });
      const range = byteRange(rangeHeader, stat.size);
      if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
      const headers = { "Content-Type": mime, "Content-Length": String(range.end - range.start + 1),
        "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
      if (range.partial) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
      const body = head ? null : Readable.toWeb(fs.createReadStream(target, { start: range.start, end: range.end }));
      return new Response(body, { status: range.partial ? 206 : 200, headers });
    },
  };
}

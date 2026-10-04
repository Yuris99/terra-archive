import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArchiveStore } from "./lib/local-search.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = createArchiveStore(root);
const [locale = "ko_KR", kind = "profile", operator = "char_002_amiya"] = process.argv.slice(2);
for (const record of store.records(locale, kind).filter((record) => record.document.context.operator?.id === operator)) {
  console.log(JSON.stringify({ id: record.document.id, title: record.document.title,
    context: record.document.context, chunks: record.chunks.map((chunk) => ({ id: chunk.id,
      pointer: chunk.spans[0].sourcePointer, text: chunk.text })) }));
}

import fs from "node:fs";
import path from "node:path";
import { createArchiveStore } from "./lib/local-search.mjs";
import { embeddingText, embedInputs, installedEmbeddingModel } from "./lib/semantic-search.mjs";
const root = path.resolve(import.meta.dirname, ".."), archive = createArchiveStore(root);
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/semantic-policy.json")));
await installedEmbeddingModel(policy);
for (const [locale, kind, id] of [
  ["ko_KR", "voice", "voice:charWords:char_002_amiya_CN_008"],
  ["en_US", "module", "module:uniequip_002_angel"],
  ["ko_KR", "profile", "profile:char_002_amiya:2:0"],
]) {
  const record = archive.records(locale, kind).find((record) => record.document.id === `${locale}:${id}`);
  const mapping = JSON.parse(fs.readFileSync(path.join(root, `data/indexes/semantic-v1/${locale}/${kind}.rows.json`)));
  const bytes = fs.readFileSync(path.join(root, `data/indexes/semantic-v1/${locale}/${kind}.f32`));
  const vectors = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  for (const chunk of record.chunks) {
    const row = mapping.find((entry) => entry.id === chunk.id).row;
    const [fresh] = await embedInputs(policy, [embeddingText(record.document, chunk)]);
    let cosine = 0;
    for (let i = 0; i < policy.dimensions; i++) cosine += fresh[i] * vectors[row * policy.dimensions + i];
    console.log(JSON.stringify({ id: chunk.id, indexedVsFreshCosine: cosine }));
  }
}

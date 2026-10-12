import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backupSuffix = ".terra-dedup-backup";
async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.ino !== 0;
const unchanged = (a, b) => sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs;

export async function deduplicateMedia(base, { apply = false, progress = () => {} } = {}) {
  for (const branch of ["en", "cn"]) for (const relative of ["", branch, `${branch}/assets`, `${branch}/assets/dyn`]) {
    if ((await fs.lstat(path.join(base, relative))).isSymbolicLink()) throw new Error("Symbolic links are not accepted in asset roots");
  }
  base = await fs.realpath(base);
  const files = [];
  let recovered = false;
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not accepted: ${file}`);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile()) continue;
      if (file.endsWith(backupSuffix)) {
        if (!apply) throw new Error("Interrupted replacement found; use --apply to recover it first.");
        const original = file.slice(0, -backupSuffix.length);
        try {
          await fs.access(original);
          if (await digest(file) !== await digest(original)) throw new Error(`Backup differs: ${file}`);
          await fs.unlink(file);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await fs.rename(file, original);
        }
        recovered = true;
        continue;
      }
      files.push({ file, stat: await fs.stat(file) });
    }
  }
  for (const branch of ["en", "cn"]) await walk(path.join(base, branch, "assets", "dyn"));
  // Re-enumerate after recovery so every restored path participates in the inventory.
  if (recovered) {
    files.length = 0;
    for (const branch of ["en", "cn"]) await walk(path.join(base, branch, "assets", "dyn"));
  }
  const groups = new Map();
  for (const item of files) {
    const group = groups.get(item.stat.size) ?? [];
    group.push(item); groups.set(item.stat.size, group);
  }
  const potential = [...groups.values()].filter((group) => group.length > 1);
  const hashCache = new Map();
  let hashed = 0, duplicates = 0, linked = 0, reclaimableBytes = 0, reclaimedBytes = 0;
  const changes = [];
  for (const group of potential) {
    const byHash = new Map();
    for (const item of group) {
      const key = `${item.stat.dev}:${item.stat.ino}:${item.stat.size}:${item.stat.mtimeMs}`;
      const hash = hashCache.get(key) ?? await digest(item.file);
      hashCache.set(key, hash);
      const canonical = byHash.get(hash);
      if (!canonical) byHash.set(hash, item);
      else {
        duplicates++;
        if (!sameFile(canonical.stat, item.stat)) {
          reclaimableBytes += item.stat.size;
          changes.push({ canonical: path.relative(base, canonical.file).replaceAll("\\", "/"), target: path.relative(base, item.file).replaceAll("\\", "/"), bytes: item.stat.size, sha256: hash });
          if (apply) {
            if (!unchanged(canonical.stat, await fs.stat(canonical.file)) || !unchanged(item.stat, await fs.stat(item.file))) throw new Error("Asset changed during comparison; stopped without replacing it.");
            const backup = item.file + backupSuffix;
            await fs.access(backup).then(() => { throw new Error("Backup already exists"); }, (error) => { if (error.code !== "ENOENT") throw error; });
            await fs.rename(item.file, backup);
            try {
              await fs.link(canonical.file, item.file);
              if (!sameFile(await fs.stat(canonical.file), await fs.stat(item.file)) || await digest(item.file) !== hash) throw new Error("Hard-link verification failed");
              await fs.unlink(backup);
              linked++; reclaimedBytes += item.stat.size;
            } catch (error) {
              await fs.unlink(item.file).catch(() => {});
              await fs.rename(backup, item.file);
              throw error;
            }
          }
        }
      }
      hashed++;
      if (hashed % 500 === 0) progress({ hashed, duplicates, linked, reclaimedBytes });
    }
  }
  return { generatedAt: new Date().toISOString(), mode: apply ? "applied" : "preview", method: "sha256-verified-ntfs-hard-links", files: files.length, logicalBytes: files.reduce((sum, item) => sum + item.stat.size, 0), comparedFiles: hashed, duplicates, linked, reclaimableBytes, reclaimedBytes, pathsPreserved: true, changes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const base = path.join(root, "data/raw/arknights-assets2");
  const report = await deduplicateMedia(base, { apply: process.argv.includes("--apply"), progress: (state) => console.log(JSON.stringify(state)) });
  await fs.writeFile(path.join(base, ".storage-index.json"), JSON.stringify(report));
  const { changes, ...summary } = report;
  await fs.writeFile(path.join(root, "data/raw/manifests/media-storage.json"), JSON.stringify({ ...summary, detailedIndex: "data/raw/arknights-assets2/.storage-index.json", note: "Identical original files share disk storage. Their paths and contents are retained. Treat raw assets as immutable; editing a hard-linked file affects every linked path." }, null, 2) + "\n");
  console.log(JSON.stringify(summary));
}

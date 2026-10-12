import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { deduplicateMedia } from "../deduplicate-media.mjs";

test("deduplication preserves paths, links only identical bytes and is repeatable", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "terra-media-"));
  try {
    for (const branch of ["en", "cn"]) await fs.mkdir(path.join(base, branch, "assets/dyn/arts"), { recursive: true });
    const a = path.join(base, "en/assets/dyn/arts/a.png");
    const b = path.join(base, "cn/assets/dyn/arts/b.png");
    const c = path.join(base, "cn/assets/dyn/arts/c.png");
    await fs.writeFile(a, "same"); await fs.writeFile(b, "same"); await fs.writeFile(c, "diff");
    const preview = await deduplicateMedia(base);
    assert.equal(preview.reclaimableBytes, 4); assert.equal(preview.linked, 0);
    const result = await deduplicateMedia(base, { apply: true });
    assert.equal(result.linked, 1); assert.equal(result.reclaimedBytes, 4);
    assert.equal((await fs.stat(a)).ino, (await fs.stat(b)).ino);
    assert.equal(await fs.readFile(c, "utf8"), "diff");
    assert.equal((await deduplicateMedia(base, { apply: true })).linked, 0);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test("symlinks are rejected without replacing a source", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "terra-media-"));
  try {
    await fs.mkdir(path.join(base, "en/assets/dyn"), { recursive: true });
    await fs.mkdir(path.join(base, "cn/assets/dyn"), { recursive: true });
    await fs.symlink(path.join(base, "cn"), path.join(base, "en/assets/dyn/outside"), "junction");
    await assert.rejects(deduplicateMedia(base, { apply: true }), /Symbolic links/);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test("interrupted replacements recover both before and after hard-link creation", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "terra-media-recovery-"));
  try {
    for (const branch of ["en", "cn"]) await fs.mkdir(path.join(base, branch, "assets/dyn"), { recursive: true });
    const a = path.join(base, "en/assets/dyn/a.png");
    const b = path.join(base, "cn/assets/dyn/b.png");
    const c = path.join(base, "cn/assets/dyn/c.png");
    await fs.writeFile(a, "same");
    await fs.writeFile(b + ".terra-dedup-backup", "same");
    await fs.writeFile(c + ".terra-dedup-backup", "same");
    await fs.link(a, c);
    await assert.rejects(deduplicateMedia(base), /Interrupted/);
    await deduplicateMedia(base, { apply: true });
    for (const file of [a, b, c]) assert.equal(await fs.readFile(file, "utf8"), "same");
    assert.deepEqual((await fs.readdir(path.dirname(b))).sort(), ["b.png", "c.png"]);
    assert.equal((await fs.stat(a)).ino, (await fs.stat(b)).ino);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

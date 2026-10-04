import "server-only";
import path from "node:path";
import { createArchiveStore } from "../../scripts/lib/local-search.mjs";
import { generateLocalAnswer, localModels } from "../../scripts/lib/local-rag.mjs";
import { createSemanticSearch } from "../../scripts/lib/semantic-search.mjs";

export const archive = createArchiveStore(path.resolve(process.cwd(), ".."));
export const semantic = createSemanticSearch(path.resolve(process.cwd(), ".."), archive);
export { generateLocalAnswer, localModels };
export function pageNumber(value: string | null, fallback: number, maximum: number) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > maximum) throw new Error("조회 범위가 올바르지 않습니다.");
  return number;
}
export function errorResponse(error: unknown, status = 400) {
  console.error(error instanceof Error ? error.message : "Archive request failed");
  return Response.json({ error: error instanceof Error ? error.message : "자료를 조회하지 못했습니다." }, { status, headers: { "Cache-Control": "no-store" } });
}

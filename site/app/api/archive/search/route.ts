import { archive, semantic, errorResponse, pageNumber } from "@/lib/archive-server";
import { isSameLocalOrigin } from "../../../../../scripts/lib/local-http.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isSameLocalOrigin(request)) return Response.json({ error: "같은 로컬 화면에서만 실행할 수 있습니다." }, { status: 403 });
  try {
    const parameters = new URL(request.url).searchParams;
    const mode = parameters.get("mode") ?? "literal";
    if (!["literal", "semantic", "hybrid"].includes(mode)) throw new Error("지원하지 않는 검색 방식입니다.");
    const options = { query: parameters.get("q") ?? "", locale: parameters.get("locale") ?? "ko_KR",
      kind: parameters.get("kind") ?? "all", offset: pageNumber(parameters.get("offset"), 0, 1000000),
      limit: Math.max(1, pageNumber(parameters.get("limit"), 20, 50)) };
    return Response.json(mode !== "literal" ? await semantic.search({ ...options, mode, signal: request.signal }) : archive.search(options),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

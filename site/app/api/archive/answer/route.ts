import { archive, semantic, errorResponse, generateLocalAnswer } from "@/lib/archive-server";
import { isSameLocalOrigin } from "../../../../../scripts/lib/local-http.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!isSameLocalOrigin(request)) return Response.json({ error: "같은 로컬 화면에서만 실행할 수 있습니다." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 16000) return Response.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  try {
    const body = await request.text();
    if (body.length > 16000) throw new Error("요청이 너무 큽니다.");
    const input = JSON.parse(body);
    return Response.json(await generateLocalAnswer({ store: archive, semantic, mode: input.mode ?? "literal", question: input.question, query: input.query,
      locale: input.locale ?? "ko_KR", kind: input.kind ?? "all", model: input.model ?? "gemma4:12b", signal: request.signal }),
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, 503); }
}

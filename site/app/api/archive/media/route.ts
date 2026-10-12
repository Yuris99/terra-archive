import { media } from "@/lib/media-server";
import { errorResponse } from "@/lib/archive-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    const data = parameters.has("operator") ? media.operator(parameters.get("operator") ?? "") :
      parameters.has("document") ? media.document(parameters.get("document") ?? "") : media.catalog();
    return Response.json(data ?? { error: "공개 범위에 연결된 미디어가 없습니다." }, { status: data ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, 503); }
}

import { archive, errorResponse, pageNumber } from "@/lib/archive-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    const document = archive.document(parameters.get("id") ?? "", pageNumber(parameters.get("offset"), 0, 1000000), 30);
    if (!document) return Response.json({ error: "검색 허용 범위에서 문서를 찾지 못했습니다." }, { status: 404 });
    return Response.json(document, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

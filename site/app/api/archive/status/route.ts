import { archive, semantic, errorResponse, localModels } from "@/lib/archive-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    let models: { name: string; size: number }[] = [];
    try { models = await localModels(); } catch { /* Search remains usable without Ollama. */ }
    const semanticStatus = semantic.status();
    return Response.json({ ...archive.status(), semanticSearch: semanticStatus.ready, semantic: semanticStatus, models }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, 503); }
}

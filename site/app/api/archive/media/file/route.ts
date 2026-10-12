import { media } from "@/lib/media-server";
import { errorResponse } from "@/lib/archive-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function serve(request: Request, head: boolean) {
  try {
    return await media.response(new URL(request.url).searchParams.get("id") ?? "", request.headers.get("range"), head);
  } catch (error) { return errorResponse(error, 404); }
}
export function GET(request: Request) { return serve(request, false); }
export function HEAD(request: Request) { return serve(request, true); }

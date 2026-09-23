import { liveStatus } from "@/lib/runs/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether a live run could start right now, so the page can say so before an upload. Reads one small
 * budget file; the run route checks again when it reserves.
 */
export async function GET() {
  return Response.json(await liveStatus(), { headers: { "Cache-Control": "private, no-store" } });
}

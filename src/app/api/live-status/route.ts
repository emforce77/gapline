import { liveStatus } from "@/lib/runs/budget";
import { requestViewerHash } from "@/lib/store/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether a live run could start right now, for the whole allowance and for this visitor (their
 * other run or edit, their daily share), so the page can say so before an upload or a press of
 * Generate. Reads one small budget file and never sets a session; the run route checks again when
 * it reserves.
 */
export async function GET(request: Request) {
  return Response.json(await liveStatus(requestViewerHash(request)), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

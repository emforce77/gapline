/**
 * ?run=<id> names the result or live run on screen, so a reload, a bookmark or a shared link comes
 * back to it. Written with the native history API, which Next's router follows without a request
 * (node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md, "Native
 * History API").
 */
const RUN_PARAM = "run";

function replaceSearch(change: (params: URLSearchParams) => void) {
  const url = new URL(window.location.href);
  change(url.searchParams);
  // null, not the current state: Next copies its own state over and then updates its router's URL.
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function pinRunInUrl(runId: string) {
  replaceSearch((params) => params.set(RUN_PARAM, runId));
}

/** Drops a ?run= that names nothing this viewer can open, so a reload does not bring it back. */
export function unpinRunInUrl() {
  replaceSearch((params) => params.delete(RUN_PARAM));
}

/** The run the address names now; after Back or Forward it can differ from the server's props. */
export function runInUrl(): string | null {
  return new URLSearchParams(window.location.search).get(RUN_PARAM);
}

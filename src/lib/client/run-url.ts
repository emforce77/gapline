/**
 * ?run=<id> names the result or live run on screen, so a reload, a bookmark or a shared link comes
 * back to it. A narration language and density with no result yet are named instead by
 * ?narration=<en|ko>&density=<standard|brief>, so a reload keeps that choice too. Written with the
 * native history API, which Next's router follows without a request
 * (node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md, "Native
 * History API").
 */
import type { Density, Language } from "@/lib/pipeline/schemas";

const RUN_PARAM = "run";
const NARRATION_PARAM = "narration";
const DENSITY_PARAM = "density";
const LANGUAGES: readonly Language[] = ["en", "ko"];
const DENSITIES: readonly Density[] = ["standard", "brief"];

/**
 * The narration language and density an address names (pinSettingInUrl), from the page's search
 * params; a value that is missing, repeated or unknown names nothing.
 */
export function settingInParams(params: Record<string, string | string[] | undefined>): {
  language?: Language;
  density?: Density;
} {
  const narration = params[NARRATION_PARAM];
  const density = params[DENSITY_PARAM];
  return {
    ...(LANGUAGES.includes(narration as Language) ? { language: narration as Language } : {}),
    ...(DENSITIES.includes(density as Density) ? { density: density as Density } : {}),
  };
}

function replaceSearch(change: (params: URLSearchParams) => void) {
  // Deferred to after the current effects: on mount the page's effects run before Next's router
  // patches history (its own effect, an ancestor's), and a native replaceState(null) there wiped
  // Next's state for this entry, so Back to it kept the previous page on screen. The address is
  // read when the write happens, so two changes in one turn both apply.
  queueMicrotask(() => {
    const url = new URL(window.location.href);
    change(url.searchParams);
    // null, not the current state: Next copies its own state over and then updates its router's URL.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  });
}

export function pinRunInUrl(runId: string) {
  replaceSearch((params) => {
    params.set(RUN_PARAM, runId);
    // A named result has its own narration language and density.
    params.delete(NARRATION_PARAM);
    params.delete(DENSITY_PARAM);
  });
}

/** Names a narration language and density that has no result yet, in place of any run. */
export function pinSettingInUrl(setting: { language: Language; density: Density }) {
  replaceSearch((params) => {
    params.delete(RUN_PARAM);
    params.set(NARRATION_PARAM, setting.language);
    params.set(DENSITY_PARAM, setting.density);
  });
}

/** Drops a ?run= that names nothing this viewer can open, so a reload does not bring it back. */
export function unpinRunInUrl() {
  replaceSearch((params) => params.delete(RUN_PARAM));
}

/** The run the address names now; after Back or Forward it can differ from the server's props. */
export function runInUrl(): string | null {
  return new URLSearchParams(window.location.search).get(RUN_PARAM);
}

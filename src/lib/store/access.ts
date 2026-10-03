import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { assertSafeId, readProject, runOwnerHash, runVisibleTo, type Project } from "./projects";

export const OWNER_COOKIE = "scene-owner";
export function ownerHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function canAccess(project: Project, token?: string): boolean {
  return (
    project.kind === "sample" ||
    (!!token && /^[a-f0-9]{64}$/.test(token) && project.ownerHash === ownerHash(token))
  );
}
export async function sessionToken(create = false): Promise<string | undefined> {
  const jar = await cookies();
  const existing = jar.get(OWNER_COOKIE)?.value;
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  if (!create) return undefined;
  const token = randomBytes(32).toString("hex");
  jar.set(OWNER_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: !!process.env.K_SERVICE,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return token;
}
export async function accessibleProject(id: string): Promise<Project | null> {
  try {
    const project = await readProject(id);
    return canAccess(project, await sessionToken()) ? project : null;
  } catch {
    return null;
  }
}
/** This browser's owner hash, if it has a session; it decides which sample runs it sees. */
export async function viewerHash(): Promise<string | undefined> {
  const token = await sessionToken();
  return token ? ownerHash(token) : undefined;
}
/**
 * viewerHash read from the request's own Cookie header, for a handler that needs nothing else
 * from next/headers (and so also answers when called outside a Next request, as in tests).
 */
export function requestViewerHash(request: Request): string | undefined {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, value] = pair.trim().split("=");
    if (name === OWNER_COOKIE && value && /^[a-f0-9]{64}$/.test(value)) return ownerHash(value);
  }
  return undefined;
}
/**
 * The project, if this viewer may open it and see this run of it (runVisibleTo). Another viewer's
 * run on the sample answers null, the same as a run that does not exist.
 */
export async function accessibleRun(id: string, runId: string): Promise<Project | null> {
  return (await runAccess(id, runId))?.project ?? null;
}

/**
 * accessibleRun, also saying whether the run is open to everyone (`shared`): on the sample, a run no
 * visitor made, such as a curated result. Any other run is reachable only with its maker's cookie.
 */
export async function runAccess(
  id: string,
  runId: string,
): Promise<{ project: Project; shared: boolean } | null> {
  try {
    assertSafeId(runId);
  } catch {
    return null;
  }
  const project = await accessibleProject(id);
  if (!project) return null;
  // Only a sample's runs can belong to someone other than the viewer; uploads skip the reads.
  const owner = project.kind === "sample" ? await runOwnerHash(project.id, runId) : null;
  if (!runVisibleTo(project, owner, await viewerHash())) return null;
  return { project, shared: project.kind === "sample" && owner === null };
}
export function publicProject(project: Project): Omit<Project, "ownerHash"> {
  const { ownerHash: _owner, ...visible } = project;
  return visible;
}
/**
 * The origin a browser on this site sends, from Host and X-Forwarded-Proto. Cloud Run's front end
 * routes by Host and sets X-Forwarded-Proto itself (a forged one is replaced), but it passes a
 * client's X-Forwarded-Host through unchanged, so that header names nothing (live QA, 2026-10-03).
 * Next's own request URL can say localhost behind the proxy. Locally, Next sets the proto to http.
 */
export function requestOrigin(request: Request): string | null {
  const host = request.headers.get("host");
  if (!host) return null;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "http";
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * Mutations (upload, run, edit) must come from this site's own pages. Browsers send Origin with
 * every POST, same-origin included, so a request without one is a script, not the app. The whole
 * origin must match, so neither http:// on this host nor a userinfo trick (https://x@host) passes.
 */
export function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  const expected = requestOrigin(request);
  return !!origin && !!expected && origin === expected;
}

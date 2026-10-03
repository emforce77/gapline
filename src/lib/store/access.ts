import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { assertSafeId, canSeeRun, readProject, type Project } from "./projects";

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
 * The project, if this viewer may open it and see this run of it (canSeeRun). Another viewer's run
 * on the sample answers null, the same as a run that does not exist.
 */
export async function accessibleRun(id: string, runId: string): Promise<Project | null> {
  try {
    assertSafeId(runId);
  } catch {
    return null;
  }
  const project = await accessibleProject(id);
  if (!project) return null;
  return (await canSeeRun(project, runId, await viewerHash())) ? project : null;
}
export function publicProject(project: Project): Omit<Project, "ownerHash"> {
  const { ownerHash: _owner, ...visible } = project;
  return visible;
}
/**
 * Mutations (upload, run, edit) must come from this site's own pages. Browsers send Origin with
 * every POST, same-origin included, so a request without one is a script, not the app.
 */
export function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    // Next's request URL can use localhost behind Cloud Run's reverse proxy.
    // Browser cross-site requests are rejected above; compare its public forwarded host.
    const host =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

import type { NextConfig } from "next";
import { MAX_UPLOAD_BYTES } from "./src/lib/api-contract";

/** Multipart boundaries and part headers around the file; Next's docs suggest 10–20 KB. */
const MULTIPART_ENVELOPE_BYTES = 64 * 1024;

/**
 * Everything the app loads is its own: scripts, styles, fonts and media under this origin, object
 * URLs for the picked file's length check and the generated caption tracks, inline styles, and the
 * root layout's inline load-failure watcher (a nonce would need every page rendered with it, so
 * scripts keep 'unsafe-inline'; Next's guide, "Without Nonces"). React in development needs eval.
 * No page may be framed by another site: nothing frames Gapline, and a framed page could be
 * clicked through unseen.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // For browsers without frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // Every answer names its type; a VTT or JSON file is never run as a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // A link out (the footer's sources) tells the other site only that it came from Gapline, never
  // which clip or result was open.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Self-contained server bundle for the Cloud Run container.
  output: "standalone",
  devIndicators: false,
  // ffmpeg and data paths are built at run time, so the tracer would otherwise copy the whole
  // project (runtime data, notes) into the server bundle.
  outputFileTracingExcludes: {
    "/*": [
      "./runtime/**/*",
      "./.playwright-mcp/**/*",
      "./*.md",
      "./Dockerfile",
      "./scripts/**/*",
      "./tests/**/*",
      "./docs/**/*",
    ],
  },
  // Applies to Server Actions only (the upload route handler checks MAX_UPLOAD_BYTES itself). Kept
  // at the upload limit so no path accepts a larger body than the one the app advertises.
  experimental: {
    serverActions: { bodySizeLimit: MAX_UPLOAD_BYTES + MULTIPART_ENVELOPE_BYTES },
  },
};

export default nextConfig;

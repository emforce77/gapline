import type { NextConfig } from "next";
import { MAX_UPLOAD_BYTES } from "./src/lib/api-contract";

/** Multipart boundaries and part headers around the file; Next's docs suggest 10–20 KB. */
const MULTIPART_ENVELOPE_BYTES = 64 * 1024;

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
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

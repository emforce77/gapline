import type { NextConfig } from "next";

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
    ],
  },
  // Uploaded clips arrive as multipart bodies through route handlers.
  experimental: { serverActions: { bodySizeLimit: "200mb" } },
};

export default nextConfig;

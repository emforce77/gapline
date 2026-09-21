import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Cloud Run container.
  output: "standalone",
  devIndicators: false,
  // Uploaded clips arrive as multipart bodies through route handlers.
  experimental: { serverActions: { bodySizeLimit: "200mb" } },
};

export default nextConfig;

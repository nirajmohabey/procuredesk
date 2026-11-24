import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native Next builds scoped to this checkout, including inside the
  // containing Codex workspace. The legacy Sites/Vite config is separate.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;

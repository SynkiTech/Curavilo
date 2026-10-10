import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Security gate (spec §182): type errors fail the build. src/ is held to a
  // zero-error standard via `bunx tsc --noEmit`; non-src dirs are excluded in
  // tsconfig so the build gate and the CI gate see the same code.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;

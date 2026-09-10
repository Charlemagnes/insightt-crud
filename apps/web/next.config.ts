import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@insightt/shared` is raw TypeScript with no build step, so Next has to
  // compile it as if it were application source.
  transpilePackages: ["@insightt/shared"],
};

export default nextConfig;

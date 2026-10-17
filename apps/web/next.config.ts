import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The dev badge sits over the settings strip.
  devIndicators: false,
  partialPrefetching: true,
  // The engine ships as TypeScript source from the workspace.
  transpilePackages: ["@mech-vent/engine"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

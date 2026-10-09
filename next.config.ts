import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page and route here is per-request and behind login or a secret, so the
  // classic dynamic model is simpler than Cache Components.
  cacheComponents: false,
  poweredByHeader: false,
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

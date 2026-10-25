import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ExcelJS reads uploads in Node route handlers; load it as-is rather than bundling it.
  serverExternalPackages: ["exceljs"],
  cacheComponents: true,
  partialPrefetching: true,
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

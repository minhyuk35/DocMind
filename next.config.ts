import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname),
  outputFileTracingIncludes: {
    "/api/analyze-pdf": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
    "/api/sessions/[id]/pages/[pageNum]/image": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
  serverExternalPackages: ["@napi-rs/canvas"],
  experimental: {
    serverActions: {
      bodySizeLimit: "1gb",
    },
  },
};

export default nextConfig;

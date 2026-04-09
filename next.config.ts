import type { NextConfig } from "next";

/** Не используем extensionAlias для `.js` → `.ts`: это ломает разрешение модулей в Webpack/RSC. */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pg", "@langchain/langgraph-checkpoint-postgres"],
};

export default nextConfig;

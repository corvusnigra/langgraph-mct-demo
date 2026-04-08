import type { NextConfig } from "next";

/** Не используем extensionAlias для `.js` → `.ts`: это ломает разрешение модулей в Webpack/RSC. */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql"],
  transpilePackages: [
    "@buckshot/core",
    "@buckshot/engine",
    "@buckshot/db",
    "@buckshot/auth",
    "@buckshot/ui",
  ],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_ALEX_DESKTOP: process.env.ALEX_DESKTOP,
  },
};

export default nextConfig;

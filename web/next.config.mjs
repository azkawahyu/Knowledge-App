/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Keep build output out of `.next`: Next.js deletes/recreates `.next` on every
  // build, and `web/.next` sits inside this project's baseline tree. A dedicated
  // dir makes a build non-destructive to anything tracked elsewhere.
  distDir: ".next-build",
};

export default nextConfig;

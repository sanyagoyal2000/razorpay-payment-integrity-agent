/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compiler: { styledComponents: true },
  // Lets a dev server and a production build run side by side without sharing output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep sharp (native image lib) out of the bundler/trace step — it ships large
  // platform binaries that crash "Collecting build traces" if Next tries to trace
  // them. This is the official way to use sharp in a Next.js server route.
  serverExternalPackages: ["sharp"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "hnkjhhabebzmcwwhhfeu.supabase.co" },
    ],
  },
};

export default nextConfig;

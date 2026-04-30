/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "hnkjhhabebzmcwwhhfeu.supabase.co" },
    ],
  },
};

export default nextConfig;

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Don't crash the build (page-data collection) when these are unset — the real
// values are inlined at build time for the browser. Warn loudly in the browser
// instead, so a misconfigured deploy is obvious rather than a blank 404.
if (!url || !anonKey) {
  const msg =
    "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and " +
    "NEXT_PUBLIC_SUPABASE_ANON_KEY (Vercel: Project → Settings → Environment Variables).";
  if (typeof window !== "undefined") console.error(msg);
  else console.warn(msg);
}

// Placeholder fallbacks keep createClient from throwing during the build. They
// never connect anywhere — if real values are missing, the console warning above
// fires and auth simply fails fast at runtime.
export const supabase = createClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder-anon-key"
);

export const BUCKET = process.env.NEXT_PUBLIC_BUCKET || "pics";

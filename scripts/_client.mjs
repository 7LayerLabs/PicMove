import { createClient } from "@supabase/supabase-js";

// Shared Supabase client for the dev/test scripts. Reads from env so no keys
// are committed. The publishable (anon) key is safe to expose, but keeping it
// in env keeps the repo clean and lets you point scripts at another project.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(
    "✕ Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "  Set them in your shell or load them from .env.local before running scripts."
  );
  process.exit(1);
}

export const supabase = createClient(url, key);
export const BUCKET = process.env.NEXT_PUBLIC_BUCKET || "pics";

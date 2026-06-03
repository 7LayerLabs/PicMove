import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { supabase, BUCKET } from "@/lib/supabase";

export const runtime = "nodejs";
// gpt-image edits are slow; keep headroom. Vercel Hobby clamps this to 60s.
export const maxDuration = 60;

type EditRequest = {
  sourcePath?: string;
  referencePath?: string;
  prompt?: string;
  size?: string;
  quality?: string;
};

const DEFAULT_PROMPT =
  "Create a clean, appetizing, photorealistic restaurant menu photo. Keep the food item from the first image recognizable, remove hands and messy prep surfaces, and plate it naturally using the second image as the plate/background reference. Preserve realistic lighting, shadows, texture, and portion size.";

// Allowlist what we forward to OpenAI so an attacker can't force the most
// expensive combination (or an invalid value that 400s after we've done work).
const ALLOWED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024"]);
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);
const MAX_PROMPT_LEN = 2000;

type ImageFile = { blob: Blob; name: string };

// Best-effort, in-memory throttle. Resets on cold start (fine as a backstop —
// the real lock is the login requirement below).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5; // edits per IP per minute
const DAILY_CAP = 200; // total edits per running instance per day
const ipHits = new Map<string, number[]>();
let dailyCount = 0;
let dailyResetAt = 0;

function rateLimited(ip: string, now: number): boolean {
  if (now > dailyResetAt) {
    dailyCount = 0;
    dailyResetAt = now + 24 * 60 * 60 * 1000;
  }
  if (dailyCount >= DAILY_CAP) return true;

  const hits = (ipHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    ipHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  dailyCount++;
  return false;
}

// Only allow plain bucket object keys: no traversal, no absolute paths, no
// scheme. Mirrors the characters the gallery actually produces.
function isSafeObjectPath(p: string): boolean {
  if (!p || p.length > 1024) return false;
  if (p.startsWith("/") || p.includes("..") || p.includes("\\")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return false; // reject http:, data:, etc.
  return /^[a-zA-Z0-9 _\-./]+$/.test(p);
}

// Reject cross-site callers. Same-origin browser requests send an Origin that
// matches the deployment; allow an explicit extra list via env if needed.
function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin navigations / server-side may omit it
  const allowed = new Set<string>([request.nextUrl.origin]);
  for (const o of (process.env.ALLOWED_EDIT_ORIGINS || "").split(",")) {
    const t = o.trim();
    if (t) allowed.add(t);
  }
  return allowed.has(origin);
}

// A Supabase client scoped to the signed-in user, so storage reads/writes run
// under that user's permissions on the private bucket (no admin key needed).
function userClient(token: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

async function fetchImageFile(db: SupabaseClient, path: string, fallbackName: string) {
  // Private bucket: download as the signed-in user, not via a public URL.
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error(`Could not load ${path}: ${error?.message || "not found"}`);
  }

  if (data.type.startsWith("video/")) {
    throw new Error(`"${path}" is a video. Pick a still photo for AI editing.`);
  }

  const input = Buffer.from(await data.arrayBuffer());
  const name = `${(path.split("/").pop() || fallbackName).replace(/\.[^.]+$/, "")}.png`;

  try {
    const normalized = await sharp(input, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .toColorspace("srgb")
      .png()
      .toBuffer();

    return {
      blob: new Blob([new Uint8Array(normalized)], { type: "image/png" }),
      name,
    };
  } catch {
    throw new Error(
      `Could not normalize "${path}" into a PNG. Try re-uploading it as JPG or PNG, then run the edit again.`
    );
  }
}

function safeStem(path: string) {
  const name = path.split("/").pop() || "photo";
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64) || "photo";
}

export async function POST(request: NextRequest) {
  try {
    if (!originAllowed(request)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // Require a valid signed-in user — no anonymous (paid) edits.
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Please sign in to edit photos." }, { status: 401 });
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (rateLimited(ip, Date.now())) {
      return NextResponse.json(
        { error: "Too many edits — slow down and try again in a minute." },
        { status: 429 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const body = (await request.json()) as EditRequest;
    const sourcePath = body.sourcePath?.trim();
    const referencePath = body.referencePath?.trim();

    if (!sourcePath) {
      return NextResponse.json({ error: "Pick a source photo first." }, { status: 400 });
    }
    if (!isSafeObjectPath(sourcePath)) {
      return NextResponse.json({ error: "Invalid source path." }, { status: 400 });
    }
    if (referencePath && !isSafeObjectPath(referencePath)) {
      return NextResponse.json({ error: "Invalid reference path." }, { status: 400 });
    }

    const size = body.size && ALLOWED_SIZES.has(body.size) ? body.size : "1024x1536";
    const quality =
      body.quality && ALLOWED_QUALITIES.has(body.quality) ? body.quality : "medium";
    const prompt = (body.prompt?.trim() || DEFAULT_PROMPT).slice(0, MAX_PROMPT_LEN);

    const db = userClient(token);
    const source = await fetchImageFile(db, sourcePath, "source.jpg");
    let reference: ImageFile | null = null;

    if (referencePath) {
      reference = await fetchImageFile(db, referencePath, "reference.jpg");
    }

    const form = new FormData();
    form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("quality", quality);
    form.append("output_format", "png");
    form.append("image[]", source.blob, source.name);
    if (reference) form.append("image[]", reference.blob, reference.name);

    const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    });

    const result = await openaiResponse.json();
    if (!openaiResponse.ok) {
      const message = result?.error?.message || "OpenAI image edit failed.";
      return NextResponse.json({ error: message }, { status: openaiResponse.status });
    }

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json({ error: "OpenAI did not return an image." }, { status: 502 });
    }

    const bytes = Buffer.from(b64, "base64");
    const dir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
    const editedName = `${Date.now()}-${safeStem(sourcePath)}-ai-edit.png`;
    const editedPath = dir ? `${dir}/${editedName}` : editedName;

    const { error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(editedPath, bytes, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: signed } = await db.storage
      .from(BUCKET)
      .createSignedUrl(editedPath, 60 * 60);

    return NextResponse.json({
      path: editedPath,
      url: signed?.signedUrl ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown image edit error." },
      { status: 500 }
    );
  }
}

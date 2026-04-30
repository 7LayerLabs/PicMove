import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { supabase, BUCKET } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 180;

type EditRequest = {
  sourcePath?: string;
  referencePath?: string;
  prompt?: string;
  size?: string;
  quality?: string;
};

const DEFAULT_PROMPT =
  "Create a clean, appetizing, photorealistic restaurant menu photo. Keep the food item from the first image recognizable, remove hands and messy prep surfaces, and plate it naturally using the second image as the plate/background reference. Preserve realistic lighting, shadows, texture, and portion size.";

type ImageFile = { blob: Blob; name: string };

function publicUrl(path: string) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function fetchImageFile(path: string, fallbackName: string) {
  const response = await fetch(publicUrl(path));
  if (!response.ok) {
    throw new Error(`Could not load ${path}: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.startsWith("video/")) {
    throw new Error(`"${path}" is a video. Pick a still photo for AI editing.`);
  }

  const input = Buffer.from(await response.arrayBuffer());
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
    const body = (await request.json()) as EditRequest;
    const sourcePath = body.sourcePath?.trim();
    const referencePath = body.referencePath?.trim();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    if (!sourcePath) {
      return NextResponse.json({ error: "Pick a source photo first." }, { status: 400 });
    }

    const source = await fetchImageFile(sourcePath, "source.jpg");
    let reference: ImageFile | null = null;

    if (referencePath) {
      reference = await fetchImageFile(referencePath, "reference.jpg");
    }

    const form = new FormData();
    form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
    form.append("prompt", body.prompt?.trim() || DEFAULT_PROMPT);
    form.append("size", body.size || "1024x1536");
    form.append("quality", body.quality || "medium");
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

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(editedPath, bytes, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    return NextResponse.json({
      path: editedPath,
      url: publicUrl(editedPath),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown image edit error." },
      { status: 500 }
    );
  }
}

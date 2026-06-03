import { supabase } from "./_client.mjs";

// 1x1 red PNG
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64"
);

const key = `test-${Date.now()}.png`;
const { error: upErr } = await supabase.storage
  .from("pics")
  .upload(key, png, { contentType: "image/png" });
if (upErr) { console.error("upload failed:", upErr.message); process.exit(1); }
console.log("✓ uploaded", key);

const { data: pub } = supabase.storage.from("pics").getPublicUrl(key);
console.log("✓ public url:", pub.publicUrl);

const res = await fetch(pub.publicUrl);
console.log("✓ fetch status:", res.status, "bytes:", (await res.arrayBuffer()).byteLength);

const { data: list, error: lsErr } = await supabase.storage.from("pics").list("");
if (lsErr) { console.error("list failed:", lsErr.message); process.exit(1); }
console.log("✓ list count:", list.length);

const { error: rmErr } = await supabase.storage.from("pics").remove([key]);
if (rmErr) { console.error("delete failed:", rmErr.message); process.exit(1); }
console.log("✓ delete works");

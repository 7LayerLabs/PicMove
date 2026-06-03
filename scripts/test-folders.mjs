import { supabase } from "./_client.mjs";

// Create folder placeholder
const { error: e1 } = await supabase.storage
  .from("pics")
  .upload("test-folder/.folder", new Blob([""]), { upsert: true });
if (e1) { console.error("create folder failed:", e1.message); process.exit(1); }
console.log("✓ folder created");

// Upload a test pic at root
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64"
);
const key = `move-test-${Date.now()}.png`;
const { error: e2 } = await supabase.storage.from("pics").upload(key, png, { contentType: "image/png" });
if (e2) { console.error("upload failed:", e2.message); process.exit(1); }
console.log("✓ uploaded at root:", key);

// Move it into the folder
const newKey = `test-folder/${key}`;
const { error: e3 } = await supabase.storage.from("pics").move(key, newKey);
if (e3) { console.error("move failed:", e3.message); process.exit(1); }
console.log("✓ moved to test-folder/");

// Rename it (move within same folder)
const renamedKey = `test-folder/renamed-${Date.now()}.png`;
const { error: e4 } = await supabase.storage.from("pics").move(newKey, renamedKey);
if (e4) { console.error("rename failed:", e4.message); process.exit(1); }
console.log("✓ rename works");

// List folder contents
const { data: contents, error: e5 } = await supabase.storage.from("pics").list("test-folder");
if (e5) { console.error("list failed:", e5.message); process.exit(1); }
console.log("✓ folder contents:", contents.map((f) => f.name));

// Cleanup
await supabase.storage.from("pics").remove([renamedKey, "test-folder/.folder"]);
console.log("✓ cleanup done");

// Verify root list shows folders correctly
const { data: rootList } = await supabase.storage.from("pics").list("");
const folders = rootList.filter((e) => e.id === null).map((e) => e.name);
const files = rootList.filter((e) => e.id !== null).map((e) => e.name);
console.log("Root files:", files.length, "Root folders:", folders);

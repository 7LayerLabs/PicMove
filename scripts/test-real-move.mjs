import { createClient } from "@supabase/supabase-js";
const s = createClient(
  "https://hnkjhhabebzmcwwhhfeu.supabase.co",
  "sb_publishable_bSWy7hZPLEwilatHxnIzpw_re3uWe-V"
);

const { data: rootList } = await s.storage.from("pics").list("");
const realFile = rootList.find((e) => e.id !== null && !e.name.startsWith("."));
console.log("test file:", realFile?.name);
if (!realFile) process.exit(1);

const newPath = `plates/${realFile.name}`;
const { error } = await s.storage.from("pics").move(realFile.name, newPath);
console.log("move result:", error ? `ERROR: ${error.message}` : "✓ moved");

if (!error) {
  const { error: e2 } = await s.storage.from("pics").move(newPath, realFile.name);
  console.log("move back:", e2 ? `ERROR: ${e2.message}` : "✓ moved back");
}

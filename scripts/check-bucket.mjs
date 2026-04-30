import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://hnkjhhabebzmcwwhhfeu.supabase.co",
  "sb_publishable_bSWy7hZPLEwilatHxnIzpw_re3uWe-V"
);

const { data, error } = await supabase.storage
  .from("pics")
  .list("", { limit: 100, sortBy: { column: "created_at", order: "desc" } });

if (error) { console.error("ERROR:", error.message); process.exit(1); }
console.log(`Files in bucket: ${data.length}`);
data.forEach((f) => {
  console.log(` - ${f.name}  size=${f.metadata?.size ?? "?"}  created=${f.created_at}`);
});

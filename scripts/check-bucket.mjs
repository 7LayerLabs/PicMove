import { supabase, BUCKET } from "./_client.mjs";

const { data, error } = await supabase.storage
  .from(BUCKET)
  .list("", { limit: 100, sortBy: { column: "created_at", order: "desc" } });

if (error) { console.error("ERROR:", error.message); process.exit(1); }
console.log(`Files in bucket: ${data.length}`);
data.forEach((f) => {
  console.log(` - ${f.name}  size=${f.metadata?.size ?? "?"}  created=${f.created_at}`);
});

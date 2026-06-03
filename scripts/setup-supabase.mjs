import pg from "pg";

const { Client } = pg;

// SECURITY: never hardcode the database password. Set SUPABASE_DB_URL in your
// shell or in an uncommitted .env.local, e.g.
//   $env:SUPABASE_DB_URL="postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres"
// Even better: paste the SQL below into the Supabase dashboard SQL editor and
// never ship admin credentials in the repo at all.
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error(
    "✕ Missing SUPABASE_DB_URL. Set it before running, e.g.\n" +
      '  $env:SUPABASE_DB_URL="postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres"'
  );
  process.exit(1);
}

const client = new Client({
  connectionString,
  // Validate the server certificate. Supabase presents a valid CA chain.
  ssl: { rejectUnauthorized: true },
});

const sql = `
-- PRIVATE bucket (files are only reachable via short-lived signed URLs that the
-- app generates for signed-in users), with sane upload limits (25 MB, images + meta json).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pics', 'pics', false, 26214400, array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif','application/json'])
on conflict (id) do update set
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif','application/json'];

-- Drop any prior policies (both the old wide-open anon ones and ours), idempotent
drop policy if exists "PicMove anon read" on storage.objects;
drop policy if exists "PicMove anon insert" on storage.objects;
drop policy if exists "PicMove anon delete" on storage.objects;
drop policy if exists "PicMove anon update" on storage.objects;
drop policy if exists "PicMove auth read" on storage.objects;
drop policy if exists "PicMove auth insert" on storage.objects;
drop policy if exists "PicMove auth delete" on storage.objects;
drop policy if exists "PicMove auth update" on storage.objects;

-- Only SIGNED-IN users may read/write. Anonymous visitors get nothing.
create policy "PicMove auth read"
on storage.objects for select to authenticated
using (bucket_id = 'pics');

create policy "PicMove auth insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'pics');

create policy "PicMove auth update"
on storage.objects for update to authenticated
using (bucket_id = 'pics')
with check (bucket_id = 'pics');

create policy "PicMove auth delete"
on storage.objects for delete to authenticated
using (bucket_id = 'pics');
`;

try {
  await client.connect();
  console.log("Connected to Supabase Postgres");
  await client.query(sql);
  console.log("✓ Bucket 'pics' created and policies applied");
  const r = await client.query(
    "select id, public, file_size_limit from storage.buckets where id = 'pics'"
  );
  console.log("Bucket row:", r.rows[0]);
} catch (e) {
  console.error("✕ Setup failed:", e.message);
  process.exit(1);
} finally {
  await client.end();
}

import pg from "pg";

const { Client } = pg;

const client = new Client({
  connectionString:
    "postgresql://postgres:Zachzoey123!@db.hnkjhhabebzmcwwhhfeu.supabase.co:5432/postgres",
  ssl: { rejectUnauthorized: false },
});

const sql = `
-- Create the public bucket if missing
insert into storage.buckets (id, name, public)
values ('pics', 'pics', true)
on conflict (id) do update set public = true;

-- Drop our prior policies if they exist (idempotent)
drop policy if exists "PicMove anon read" on storage.objects;
drop policy if exists "PicMove anon insert" on storage.objects;
drop policy if exists "PicMove anon delete" on storage.objects;
drop policy if exists "PicMove anon update" on storage.objects;

-- Allow anyone to read (bucket is public, but explicit for clarity)
create policy "PicMove anon read"
on storage.objects for select
using (bucket_id = 'pics');

-- Allow anonymous uploads to this bucket
create policy "PicMove anon insert"
on storage.objects for insert
with check (bucket_id = 'pics');

-- Allow anonymous deletes (so the gallery delete button works)
create policy "PicMove anon delete"
on storage.objects for delete
using (bucket_id = 'pics');

-- Allow anonymous updates (needed for move/rename)
create policy "PicMove anon update"
on storage.objects for update
using (bucket_id = 'pics')
with check (bucket_id = 'pics');
`;

try {
  await client.connect();
  console.log("Connected to Supabase Postgres");
  await client.query(sql);
  console.log("✓ Bucket 'pics' created and policies applied");
  const r = await client.query(
    "select id, public from storage.buckets where id = 'pics'"
  );
  console.log("Bucket row:", r.rows[0]);
} catch (e) {
  console.error("✕ Setup failed:", e.message);
  process.exit(1);
} finally {
  await client.end();
}

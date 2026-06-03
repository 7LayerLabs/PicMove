"use client";

import { useState, useRef } from "react";
import { supabase, BUCKET } from "@/lib/supabase";

type UploadState = "queued" | "uploading" | "done" | "error";
type UploadStatus = { id: string; name: string; state: UploadState; error?: string };

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // matches the bucket's file_size_limit
const UPLOAD_CONCURRENCY = 4; // how many upload at the same time; the rest wait in line

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Home() {
  const [items, setItems] = useState<UploadStatus[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function updateItem(id: string, patch: Partial<UploadStatus>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function uploadOne(file: File, id: string) {
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        updateItem(id, {
          state: "error",
          error: `Too large (${(file.size / 1048576).toFixed(1)} MB, max 25 MB)`,
        });
        return;
      }
      updateItem(id, { state: "uploading" });
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || "jpg"}`;
      const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });
      if (error) {
        updateItem(id, { state: "error", error: error.message });
        return;
      }
      updateItem(id, { state: "done" });
    } catch (err) {
      updateItem(id, {
        state: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const queued = arr.map<UploadStatus>((f) => ({ id: newId(), name: f.name, state: "queued" }));
    setItems((prev) => [...prev, ...queued]);

    // Worker pool: only UPLOAD_CONCURRENCY run at once; each worker pulls the
    // next file off the line until everything is done. No choking on big batches.
    let cursor = 0;
    const worker = async () => {
      while (cursor < arr.length) {
        const i = cursor++;
        await uploadOne(arr[i], queued[i].id);
      }
    };
    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, arr.length) }, worker);
    await Promise.all(workers);
  }

  const total = items.length;
  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "error").length;
  const remaining = total - done - failed;

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>PicMove</h1>
        <a href="/gallery" style={styles.link}>Gallery →</a>
      </header>

      <div
        style={{ ...styles.drop, borderColor: dragOver ? "var(--accent)" : "#333" }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <div style={styles.dropInner}>
          <div style={styles.icon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <div style={styles.dropText}>Tap to take a photo or pick from library</div>
          <div style={styles.dropHint}>You can also drag files here on desktop</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {total > 0 && (
        <>
          <div style={styles.progress}>
            <span style={styles.progressText}>
              {done + failed} of {total} done
            </span>
            {remaining > 0 && <span style={styles.muted}>· {remaining} to go</span>}
            {failed > 0 && <span style={styles.progressFail}>· {failed} failed</span>}
          </div>
          <ul style={styles.list}>
            {items.map((it) => (
              <li key={it.id} style={styles.row}>
                <span style={styles.rowName}>{it.name}</span>
                <span style={{ ...styles.badge, ...badgeStyle(it.state) }}>
                  {it.state === "queued" && "waiting…"}
                  {it.state === "uploading" && "uploading…"}
                  {it.state === "done" && "✓ done"}
                  {it.state === "error" && `✕ ${it.error}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function badgeStyle(state: UploadState): React.CSSProperties {
  if (state === "done") return { background: "#10331c", color: "#7be29c" };
  if (state === "error") return { background: "#3a1414", color: "#ff8b8b" };
  if (state === "queued") return { background: "#1f1f1f", color: "#999" };
  return { background: "#1a2740", color: "#7eb0ff" };
}

const styles: Record<string, React.CSSProperties> = {
  main: { maxWidth: 640, margin: "0 auto", padding: "24px 16px 80px", minHeight: "100vh" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -0.5 },
  link: { color: "var(--accent)", textDecoration: "none", fontSize: 16 },
  drop: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#333",
    borderRadius: 16,
    padding: "48px 16px",
    textAlign: "center",
    cursor: "pointer",
    transition: "border-color 120ms",
    background: "#121212",
  },
  dropInner: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8 },
  icon: { color: "#888", display: "flex", alignItems: "center", justifyContent: "center" },
  dropText: { fontSize: 17, fontWeight: 600 },
  dropHint: { fontSize: 13, color: "#888" },
  progress: { display: "flex", gap: 6, alignItems: "center", marginTop: 24, fontSize: 14, flexWrap: "wrap" },
  progressText: { fontWeight: 700 },
  progressFail: { color: "#ff8b8b", fontWeight: 600 },
  muted: { color: "#888" },
  list: { listStyle: "none", padding: 0, marginTop: 12, display: "flex", flexDirection: "column", gap: 8 },
  row: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 14px", background: "#121212", borderRadius: 10, fontSize: 14,
  },
  rowName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" },
  badge: { padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
};

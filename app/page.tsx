"use client";

import { useState, useRef } from "react";
import { supabase, BUCKET } from "@/lib/supabase";

type UploadStatus = { name: string; state: "uploading" | "done" | "error"; url?: string; error?: string };

export default function Home() {
  const [items, setItems] = useState<UploadStatus[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const startIndex = items.length;
    setItems((prev) => [
      ...prev,
      ...arr.map<UploadStatus>((f) => ({ name: f.name, state: "uploading" })),
    ]);

    await Promise.all(
      arr.map(async (file, i) => {
        const ext = file.name.split(".").pop() || "jpg";
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        const idx = startIndex + i;
        if (error) {
          setItems((prev) => {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], state: "error", error: error.message };
            return copy;
          });
          return;
        }
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
        setItems((prev) => {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], state: "done", url: data.publicUrl };
          return copy;
        });
      })
    );
  }

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
          accept="image/*,video/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {items.length > 0 && (
        <ul style={styles.list}>
          {items.map((it, i) => (
            <li key={i} style={styles.row}>
              <span style={styles.rowName}>{it.name}</span>
              <span style={{ ...styles.badge, ...badgeStyle(it.state) }}>
                {it.state === "uploading" && "uploading…"}
                {it.state === "done" && "✓ done"}
                {it.state === "error" && `✕ ${it.error}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function badgeStyle(state: UploadStatus["state"]): React.CSSProperties {
  if (state === "done") return { background: "#10331c", color: "#7be29c" };
  if (state === "error") return { background: "#3a1414", color: "#ff8b8b" };
  return { background: "#1a2740", color: "#7eb0ff" };
}

const styles: Record<string, React.CSSProperties> = {
  main: { maxWidth: 640, margin: "0 auto", padding: "24px 16px 80px", minHeight: "100vh" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -0.5 },
  link: { color: "var(--accent)", textDecoration: "none", fontSize: 16 },
  drop: {
    border: "2px dashed #333",
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
  list: { listStyle: "none", padding: 0, marginTop: 24, display: "flex", flexDirection: "column", gap: 8 },
  row: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 14px", background: "#121212", borderRadius: 10, fontSize: 14,
  },
  rowName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" },
  badge: { padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
};

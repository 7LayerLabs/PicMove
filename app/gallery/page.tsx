"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { supabase, BUCKET } from "@/lib/supabase";
import { SignOutButton } from "../AuthGate";

type FileItem = { name: string; path: string; url: string; size: number; createdAt: string };
type FolderCard = { key: string; label: string; count: number; coverUrl: string | null; isPrivate: boolean };
type Meta = {
  folderOrder: string[];
  photoOrder: Record<string, string[]>;
  privateFolders: Record<string, string>;
};
type EditStatus = "idle" | "editing" | "done" | "error";
type EditMode = "plate" | "cleanup" | "hero";
type EditDraft = {
  source: FileItem;
  mode: EditMode;
  referencePath: string;
  prompt: string;
  size: string;
  quality: string;
  status: EditStatus;
  error?: string;
  resultUrl?: string;
};

const UNSORTED = "__unsorted__";
const META_PATH = ".picmove-meta.json";
const EDIT_PRESETS = {
  plate:
    "Create a clean, appetizing, photorealistic restaurant menu photo. Keep the food item from the first image recognizable, remove hands and messy prep surfaces, and plate it naturally using the second image as the plate/background reference. Preserve realistic lighting, shadows, texture, and portion size.",
  cleanup:
    "Clean up this food photo for a restaurant menu. Remove hands, dirty cutting boards, crumbs, distracting background clutter, harsh glare, and unappetizing mess. Keep the food itself realistic and recognizable with natural shadows and lighting.",
  hero:
    "Turn this into a polished restaurant hero photo. Keep the same dish, improve composition, lighting, sharpness, and color, and place it on a clean food-safe surface. Make it look real, not overly glossy or artificial.",
};

// Photos live in a PRIVATE bucket, so we hand out short-lived signed URLs that
// only work while signed in. One hour is plenty for a browsing session; the
// 30s background refresh regenerates them well before they expire.
const SIGNED_URL_TTL = 60 * 60;

async function signedUrlMap(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
  for (const row of data || []) {
    if (row.path && row.signedUrl) map.set(row.path, row.signedUrl);
  }
  return map;
}

async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}

export default function Gallery() {
  const [folderCards, setFolderCards] = useState<FolderCard[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [items, setItems] = useState<FileItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [plateFolder, setPlateFolder] = useState<string>(UNSORTED);
  const [plateItems, setPlateItems] = useState<FileItem[]>([]);
  const [plateLoading, setPlateLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [meta, setMeta] = useState<Meta>({ folderOrder: [], photoOrder: {}, privateFolders: {} });
  const [dragKind, setDragKind] = useState<"folder" | "photo" | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [unlockedFolders, setUnlockedFolders] = useState<Set<string>>(new Set());

  // Refs let the background refresh read the latest values without re-creating
  // the interval on every meta change, and let us pause it mid-save/drag.
  const currentFolderRef = useRef(currentFolder);
  const photoOrderRef = useRef(meta.photoOrder);
  const savingRef = useRef(false);
  useEffect(() => {
    currentFolderRef.current = currentFolder;
  }, [currentFolder]);
  useEffect(() => {
    photoOrderRef.current = meta.photoOrder;
  }, [meta.photoOrder]);

  const loadMeta = useCallback(async (): Promise<Meta> => {
    const empty: Meta = { folderOrder: [], photoOrder: {}, privateFolders: {} };
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(META_PATH);
      if (error || !data) return empty;
      const j = JSON.parse(await data.text());
      return {
        folderOrder: Array.isArray(j.folderOrder) ? j.folderOrder : [],
        photoOrder: j.photoOrder && typeof j.photoOrder === "object" ? j.photoOrder : {},
        privateFolders:
          j.privateFolders && typeof j.privateFolders === "object" ? j.privateFolders : {},
      };
    } catch {
      return empty;
    }
  }, []);

  const saveMeta = useCallback(async (next: Meta) => {
    setMeta(next);
    photoOrderRef.current = next.photoOrder;
    savingRef.current = true;
    try {
      const blob = new Blob([JSON.stringify(next)], { type: "application/json" });
      await supabase.storage
        .from(BUCKET)
        .upload(META_PATH, blob, { upsert: true, contentType: "application/json" });
    } finally {
      savingRef.current = false;
    }
  }, []);

  const buildFolderCards = useCallback(
    async (
      folderNames: string[],
      folderOrder: string[],
      privateFolders: Record<string, string>
    ): Promise<FolderCard[]> => {
      const allKeys = [UNSORTED, ...folderNames];
      const ordered = [
        ...folderOrder.filter((k) => allKeys.includes(k)),
        ...allKeys.filter((k) => !folderOrder.includes(k)),
      ];

      return Promise.all(
        ordered.map(async (k) => {
          const prefix = k === UNSORTED ? "" : k;
          const isPrivate = !!privateFolders[k];
          const { data } = await supabase.storage
            .from(BUCKET)
            .list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
          const files = (data || []).filter(
            (e) => e.id !== null && !e.name.startsWith(".") && !e.name.endsWith("/")
          );
          let coverUrl: string | null = null;
          if (!isPrivate) {
            const cover = files[0];
            const coverPath = cover ? (prefix ? `${prefix}/${cover.name}` : cover.name) : null;
            coverUrl = coverPath ? await signedUrl(coverPath) : null;
          }
          const label = k === UNSORTED ? "Unsorted" : k;
          return { key: k, label, count: files.length, coverUrl, isPrivate };
        })
      );
    },
    []
  );

  const loadFolders = useCallback(async () => {
    const [{ data, error }, fresh] = await Promise.all([
      supabase.storage.from(BUCKET).list("", { limit: 1000 }),
      loadMeta(),
    ]);
    if (error) {
      setError(error.message);
      return;
    }
    const fs = (data || []).filter((e) => e.id === null).map((e) => e.name).sort();
    const cards = await buildFolderCards(fs, fresh.folderOrder, fresh.privateFolders);
    setFolderCards(cards);
    setMeta(fresh);
  }, [buildFolderCards, loadMeta]);

  const loadItems = useCallback(
    async (folder: string, photoOrder: Record<string, string[]>) => {
      setLoading(true);
      const prefix = folder === UNSORTED ? "" : folder;
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      const files = (data || []).filter(
        (e) => e.id !== null && !e.name.startsWith(".") && !e.name.endsWith("/")
      );
      const urls = await signedUrlMap(
        files.map((f) => (prefix ? `${prefix}/${f.name}` : f.name))
      );
      const mapped: FileItem[] = files.map((f) => {
        const path = prefix ? `${prefix}/${f.name}` : f.name;
        return {
          name: f.name,
          path,
          url: urls.get(path) ?? "",
          size: (f.metadata as any)?.size ?? 0,
          createdAt: f.created_at ?? "",
        };
      });

      const order = photoOrder[folder] || [];
      const byName = new Map(mapped.map((m) => [m.name, m]));
      const seen = new Set<string>();
      const sorted: FileItem[] = [];
      for (const name of order) {
        const it = byName.get(name);
        if (it) {
          sorted.push(it);
          seen.add(name);
        }
      }
      for (const it of mapped) if (!seen.has(it.name)) sorted.push(it);

      setItems(sorted);
      const livePaths = new Set(sorted.map((m) => m.path));
      setSelected((prev) => {
        const next = new Set<string>();
        prev.forEach((p) => {
          if (livePaths.has(p)) next.add(p);
        });
        return next;
      });
    },
    []
  );

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    if (currentFolder) loadItems(currentFolder, meta.photoOrder);
  }, [currentFolder, meta.photoOrder, loadItems]);

  useEffect(() => {
    const id = setInterval(() => {
      // Skip while hidden (battery/data) or mid-save (avoid clobbering a drag).
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (savingRef.current) return;
      loadFolders();
      const folder = currentFolderRef.current;
      if (folder) loadItems(folder, photoOrderRef.current);
    }, 30000);
    return () => clearInterval(id);
  }, [loadFolders, loadItems]);

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.path)));
  }

  function photoCountLabel(count: number) {
    return `${count} ${count === 1 ? "photo" : "photos"}`;
  }

  function folderLabel(key: string) {
    return key === UNSORTED ? "Unsorted" : key;
  }

  async function listFolderItems(folder: string, photoOrder: Record<string, string[]>) {
    const prefix = folder === UNSORTED ? "" : folder;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });

    if (error) throw new Error(error.message);

    const files = (data || []).filter(
      (e) => e.id !== null && !e.name.startsWith(".") && !e.name.endsWith("/")
    );
    const urls = await signedUrlMap(
      files.map((f) => (prefix ? `${prefix}/${f.name}` : f.name))
    );
    const mapped: FileItem[] = files.map((f) => {
      const path = prefix ? `${prefix}/${f.name}` : f.name;
      return {
        name: f.name,
        path,
        url: urls.get(path) ?? "",
        size: (f.metadata as any)?.size ?? 0,
        createdAt: f.created_at ?? "",
      };
    });

    const order = photoOrder[folder] || [];
    const byName = new Map(mapped.map((m) => [m.name, m]));
    const seen = new Set<string>();
    const sorted: FileItem[] = [];
    for (const name of order) {
      const it = byName.get(name);
      if (it) {
        sorted.push(it);
        seen.add(name);
      }
    }
    for (const it of mapped) if (!seen.has(it.name)) sorted.push(it);
    return sorted;
  }

  async function loadPlateItems(folder: string) {
    setPlateLoading(true);
    try {
      const nextItems = await listFolderItems(folder, meta.photoOrder);
      setPlateItems(nextItems);
    } catch (err) {
      setPlateItems([]);
      setEditDraft((prev) =>
        prev
          ? {
              ...prev,
              status: "error",
              error: err instanceof Error ? err.message : "Could not load that plate folder.",
            }
          : prev
      );
    } finally {
      setPlateLoading(false);
    }
  }

  async function sha256(s: string): Promise<string> {
    const buf = new TextEncoder().encode(s);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function randomSalt(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Stored as "salt:hash". Salting stops trivial reuse of a precomputed hash
  // if someone reads the (public) meta file. NOTE: this is cover-hiding, not
  // real privacy — the bucket is public so files stay reachable by direct URL.
  async function makeStoredPassword(pw: string): Promise<string> {
    const salt = randomSalt();
    return `${salt}:${await sha256(salt + pw)}`;
  }

  async function verifyPassword(pw: string, stored: string): Promise<boolean> {
    if (stored.includes(":")) {
      const [salt, hash] = stored.split(":");
      return (await sha256(salt + pw)) === hash;
    }
    return (await sha256(pw)) === stored; // legacy unsalted entries
  }

  async function newFolder() {
    const raw = prompt("New folder name (e.g. food, kids, restaurant):")?.trim();
    if (!raw) return;
    if (!/^[a-zA-Z0-9 _\-]+$/.test(raw)) {
      alert("Use letters, numbers, spaces, _ or -");
      return;
    }
    const slug = raw.toLowerCase().replace(/\s+/g, "-");
    const blob = new Blob([""], { type: "text/plain" });
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${slug}/.folder`, blob, { upsert: true });
    if (error) {
      alert(error.message);
      return;
    }
    const pw = prompt(
      "Password to hide this folder's cover preview? (Leave blank to skip. Note: photos stay reachable by direct link — this is not full privacy.)"
    )?.trim();
    let nextMeta = meta;
    if (pw) {
      const stored = await makeStoredPassword(pw);
      nextMeta = { ...meta, privateFolders: { ...meta.privateFolders, [slug]: stored } };
      await saveMeta(nextMeta);
      setUnlockedFolders((prev) => new Set([...prev, slug]));
    }
    await loadFolders();
    setCurrentFolder(slug);
  }

  async function openFolder(key: string) {
    const isPrivate = !!meta.privateFolders[key];
    if (isPrivate && !unlockedFolders.has(key)) {
      const pw = prompt(`Password for "${key}":`);
      if (!pw) return;
      if (!(await verifyPassword(pw, meta.privateFolders[key]))) {
        alert("Wrong password.");
        return;
      }
      setUnlockedFolders((prev) => new Set([...prev, key]));
    }
    setCurrentFolder(key);
  }

  async function toggleLock(folder: string) {
    const isPrivate = !!meta.privateFolders[folder];
    if (isPrivate) {
      const current = prompt("Enter current password to remove the lock:");
      if (!current) return;
      if (!(await verifyPassword(current, meta.privateFolders[folder]))) {
        alert("Wrong password.");
        return;
      }
      const next = { ...meta.privateFolders };
      delete next[folder];
      await saveMeta({ ...meta, privateFolders: next });
      setUnlockedFolders((prev) => {
        const ns = new Set(prev);
        ns.delete(folder);
        return ns;
      });
      await loadFolders();
    } else {
      const pw = prompt(
        "Password to hide this folder's cover preview? (Note: photos stay reachable by direct link — this is not full privacy.)"
      )?.trim();
      if (!pw) return;
      const stored = await makeStoredPassword(pw);
      await saveMeta({ ...meta, privateFolders: { ...meta.privateFolders, [folder]: stored } });
      setUnlockedFolders((prev) => new Set([...prev, folder]));
      await loadFolders();
    }
  }

  async function deleteFolder(folder: string) {
    if (!confirm(`Delete folder "${folder}"? Files inside will move to Unsorted.`)) return;
    const { data: contents, error: listErr } = await supabase.storage
      .from(BUCKET)
      .list(folder, { limit: 1000 });
    if (listErr) {
      alert(listErr.message);
      return;
    }

    const failures: string[] = [];
    for (const f of contents || []) {
      if (f.name.startsWith(".")) {
        const { error } = await supabase.storage.from(BUCKET).remove([`${folder}/${f.name}`]);
        if (error) failures.push(`${f.name}: ${error.message}`);
      } else {
        // If a same-named file already sits in Unsorted, move() fails — keep a
        // unique name so nothing is silently lost.
        let dest = f.name;
        let { error } = await supabase.storage.from(BUCKET).move(`${folder}/${f.name}`, dest);
        if (error) {
          dest = `${Date.now()}-${f.name}`;
          ({ error } = await supabase.storage.from(BUCKET).move(`${folder}/${f.name}`, dest));
        }
        if (error) failures.push(`${f.name}: ${error.message}`);
      }
    }

    if (failures.length) {
      // Do NOT strip the folder's metadata (incl. its password) if files are
      // still stranded — otherwise the folder reappears on next load, unlocked.
      alert(
        `Could not empty "${folder}" — ${failures.length} item(s) failed:\n\n${failures
          .slice(0, 6)
          .join("\n")}${failures.length > 6 ? `\n…and ${failures.length - 6} more` : ""}`
      );
      await loadFolders();
      return;
    }

    const nextOrder = meta.folderOrder.filter((k) => k !== folder);
    const nextPhotoOrder = { ...meta.photoOrder };
    delete nextPhotoOrder[folder];
    const nextPrivate = { ...meta.privateFolders };
    delete nextPrivate[folder];
    await saveMeta({ folderOrder: nextOrder, photoOrder: nextPhotoOrder, privateFolders: nextPrivate });
    await loadFolders();
    if (currentFolder === folder) setCurrentFolder(null);
  }

  async function moveSelected(toFolder: string) {
    if (selected.size === 0 || moving) return;
    setMoving(true);
    try {
      const targets = Array.from(selected);
      const failures: string[] = [];
      for (const path of targets) {
        const filename = path.split("/").pop()!;
        const newPath = toFolder === UNSORTED ? filename : `${toFolder}/${filename}`;
        if (path === newPath) continue;
        const { error } = await supabase.storage.from(BUCKET).move(path, newPath);
        if (error) {
          console.error("move failed:", path, "->", newPath, error);
          failures.push(`${filename}: ${error.message}`);
        }
      }
      if (failures.length) {
        alert(
          `${failures.length} file(s) failed:\n\n${failures.slice(0, 6).join("\n")}${
            failures.length > 6 ? `\n…and ${failures.length - 6} more` : ""
          }`
        );
      }
      if (currentFolder) await loadItems(currentFolder, meta.photoOrder);
      await loadFolders();
    } finally {
      setMoving(false);
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} item(s)? This cannot be undone.`)) return;
    const { error } = await supabase.storage.from(BUCKET).remove(Array.from(selected));
    if (error) {
      alert(error.message);
      return;
    }
    if (currentFolder) await loadItems(currentFolder, meta.photoOrder);
    await loadFolders();
  }

  async function renameOne(path: string) {
    const oldName = path.split("/").pop()!;
    const dot = oldName.lastIndexOf(".");
    const stem = dot > 0 ? oldName.slice(0, dot) : oldName;
    const ext = dot > 0 ? oldName.slice(dot) : "";
    const newStem = prompt("New name (without extension):", stem)?.trim();
    if (!newStem || newStem === stem) return;
    if (!/^[a-zA-Z0-9 _\-\.]+$/.test(newStem)) {
      alert("Use letters, numbers, spaces, _, -");
      return;
    }
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const safe = newStem.replace(/\s+/g, "-");
    const newName = `${safe}${ext}`;
    const newPath = dir ? `${dir}/${newName}` : newName;
    const { error } = await supabase.storage.from(BUCKET).move(path, newPath);
    if (error) {
      alert(error.message);
      return;
    }
    if (currentFolder) {
      const order = meta.photoOrder[currentFolder] || [];
      if (order.length) {
        const updated = order.map((n) => (n === oldName ? newName : n));
        await saveMeta({
          ...meta,
          photoOrder: { ...meta.photoOrder, [currentFolder]: updated },
        });
      }
      await loadItems(currentFolder, meta.photoOrder);
    }
  }

  function openEdit(source: FileItem) {
    const initialPlateFolder = currentFolder || UNSORTED;
    setPlateFolder(initialPlateFolder);
    setPlateItems([]);
    void loadPlateItems(initialPlateFolder);
    setEditDraft({
      source,
      mode: "plate",
      referencePath: "",
      prompt: EDIT_PRESETS.plate,
      size: "1024x1536",
      quality: "medium",
      status: "idle",
    });
  }

  function applyEditMode(mode: EditMode) {
    setEditDraft((prev) =>
      prev
        ? {
            ...prev,
            mode,
            prompt: EDIT_PRESETS[mode],
            referencePath: mode === "plate" ? prev.referencePath : "",
            error: undefined,
            resultUrl: undefined,
          }
        : prev
    );
  }

  async function runEdit() {
    if (!editDraft || editDraft.status === "editing") return;
    if (editDraft.mode === "plate" && !editDraft.referencePath) {
      setEditDraft((prev) =>
        prev
          ? {
              ...prev,
              status: "error",
              error: "Choose a plate/background image before using Plate it.",
            }
          : prev
      );
      return;
    }

    setEditDraft((prev) =>
      prev ? { ...prev, status: "editing", error: undefined, resultUrl: undefined } : prev
    );

    // AI edits are slow; abort after 90s so the modal can never get stuck.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const response = await fetch("/api/edit-photo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          sourcePath: editDraft.source.path,
          referencePath: editDraft.referencePath || undefined,
          prompt: editDraft.prompt,
          size: editDraft.size,
          quality: editDraft.quality,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEditDraft((prev) =>
          prev
            ? { ...prev, status: "error", error: result?.error || "Could not edit this photo." }
            : prev
        );
        return;
      }

      setEditDraft((prev) => (prev ? { ...prev, status: "done", resultUrl: result.url } : prev));
      if (currentFolder) await loadItems(currentFolder, meta.photoOrder);
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      setEditDraft((prev) =>
        prev
          ? {
              ...prev,
              status: "error",
              error: aborted
                ? "The edit took too long and timed out. Try a smaller size or lower quality."
                : err instanceof Error
                ? err.message
                : "Network error while editing.",
            }
          : prev
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  function reorder<T>(arr: T[], from: number, to: number): T[] {
    const next = arr.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }

  async function dropFolder(targetKey: string) {
    if (!dragKey || dragKind !== "folder" || dragKey === targetKey) {
      setDragKey(null);
      setDragOverKey(null);
      setDragKind(null);
      return;
    }
    const keys = folderCards.map((c) => c.key);
    const from = keys.indexOf(dragKey);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    const nextKeys = reorder(keys, from, to);
    const nextCards = nextKeys.map((k) => folderCards.find((c) => c.key === k)!);
    setFolderCards(nextCards);
    setDragKey(null);
    setDragOverKey(null);
    setDragKind(null);
    await saveMeta({ ...meta, folderOrder: nextKeys });
  }

  async function dropPhoto(targetPath: string) {
    if (!dragKey || dragKind !== "photo" || dragKey === targetPath || !currentFolder) {
      setDragKey(null);
      setDragOverKey(null);
      setDragKind(null);
      return;
    }
    const paths = items.map((i) => i.path);
    const from = paths.indexOf(dragKey);
    const to = paths.indexOf(targetPath);
    if (from < 0 || to < 0) return;
    const nextItems = reorder(items, from, to);
    setItems(nextItems);
    const names = nextItems.map((i) => i.name);
    setDragKey(null);
    setDragOverKey(null);
    setDragKind(null);
    await saveMeta({
      ...meta,
      photoOrder: { ...meta.photoOrder, [currentFolder]: names },
    });
  }

  if (!currentFolder) {
    return (
      <main style={styles.main}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>PicMove</h1>
            <p style={styles.subtitle}>Drag to reorder folders. Tap one to open.</p>
          </div>
          <div style={styles.headerActions}>
            <a href="/" style={styles.uploadBtn}>
              <Icon.Plus /> Upload
            </a>
            <SignOutButton />
          </div>
        </header>

        {error && <p style={styles.errorText}>{error}</p>}

        <div style={styles.folderGrid}>
          {folderCards.map((c) => {
            const isDragging = dragKey === c.key && dragKind === "folder";
            const isOver = dragOverKey === c.key && dragKind === "folder" && dragKey !== c.key;
            return (
              <div
                key={c.key}
                draggable
                onDragStart={(e) => {
                  setDragKind("folder");
                  setDragKey(c.key);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (dragKind === "folder") {
                    e.preventDefault();
                    if (dragOverKey !== c.key) setDragOverKey(c.key);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverKey === c.key) setDragOverKey(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropFolder(c.key);
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  setDragOverKey(null);
                  setDragKind(null);
                }}
                onClick={() => openFolder(c.key)}
                style={{
                  ...styles.folderCard,
                  ...(isDragging ? styles.cardDragging : {}),
                  ...(isOver ? styles.cardOver : {}),
                }}
                title={c.label}
              >
                <div style={styles.folderCover}>
                  {c.isPrivate ? (
                    <div style={styles.folderCoverPrivate}>
                      <Icon.BigX />
                    </div>
                  ) : c.coverUrl ? (
                    <Image
                      src={c.coverUrl}
                      alt={c.label}
                      fill
                      sizes="(max-width: 640px) 50vw, 200px"
                      style={{ objectFit: "cover" }}
                    />
                  ) : (
                    <div style={styles.folderCoverEmpty}>
                      <Icon.Folder />
                    </div>
                  )}
                  <span style={styles.folderCount}>{photoCountLabel(c.count)}</span>
                  {c.key !== UNSORTED && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLock(c.key);
                        }}
                        style={{ ...styles.folderLockBtn, ...(c.isPrivate ? styles.folderLockBtnOn : {}) }}
                        title={c.isPrivate ? "Remove password" : "Set password"}
                      >
                        {c.isPrivate ? <Icon.LockClosed /> : <Icon.LockOpen />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteFolder(c.key);
                        }}
                        style={styles.folderDeleteBtn}
                        title="Delete folder"
                      >
                        <Icon.Trash />
                      </button>
                    </>
                  )}
                </div>
                <div style={styles.folderLabel}>{c.label}</div>
              </div>
            );
          })}

          <button onClick={newFolder} style={styles.folderNewCard}>
            <div style={styles.folderNewInner}>
              <Icon.Plus />
              <span>New folder</span>
            </div>
          </button>
        </div>
      </main>
    );
  }

  const activeLabel = currentFolder === UNSORTED ? "Unsorted" : currentFolder;
  const otherFolderCards = folderCards.filter((c) => c.key !== currentFolder);
  const plateFolderOptions = folderCards.filter(
    (c) => !c.isPrivate || unlockedFolders.has(c.key) || c.key === currentFolder
  );

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <button onClick={() => setCurrentFolder(null)} style={styles.backBtn}>
            <Icon.ChevronLeft /> All folders
          </button>
          <h1 style={{ ...styles.title, marginTop: 4 }}>{activeLabel}</h1>
          <p style={styles.subtitle}>Drag photos to reorder.</p>
        </div>
        <div style={styles.headerActions}>
          <a href="/" style={styles.uploadBtn}>
            <Icon.Plus /> Upload
          </a>
          <SignOutButton />
        </div>
      </header>

      <div style={styles.actionsRow}>
        <button onClick={selectAll} style={styles.ghostBtn}>
          {selected.size === items.length && items.length > 0 ? "Clear all" : "Select all"}
        </button>
        <span style={styles.muted}>
          {items.length} {items.length === 1 ? "photo" : "photos"}
        </span>
      </div>

      {selected.size > 0 && (
        <div style={styles.toolbar}>
          <span style={styles.toolbarCount}>{selected.size} selected</span>
          <span style={styles.muted}>Move to:</span>
          {otherFolderCards.map((folder) => (
            <button
              key={folder.key}
              onClick={() => moveSelected(folder.key)}
              disabled={moving}
              style={{ ...styles.moveBtn, ...(moving ? styles.btnDisabled : {}) }}
            >
              <Icon.Folder />
              <span>{moving ? "Moving…" : folder.label}</span>
              <span style={styles.moveCountBadge}>{folder.count}</span>
            </button>
          ))}
          <button
            onClick={async () => {
              const raw = prompt("New folder name:")?.trim();
              if (!raw) return;
              if (!/^[a-zA-Z0-9 _\-]+$/.test(raw)) {
                alert("Letters, numbers, spaces, _, -");
                return;
              }
              const slug = raw.toLowerCase().replace(/\s+/g, "-");
              const { error } = await supabase.storage
                .from(BUCKET)
                .upload(`${slug}/.folder`, new Blob([""]), { upsert: true });
              if (error) {
                alert(error.message);
                return;
              }
              await loadFolders();
              await moveSelected(slug);
            }}
            style={styles.moveBtnNew}
          >
            <Icon.Plus /> New folder
          </button>
          <span style={styles.divider} />
          <button onClick={deleteSelected} style={styles.dangerBtn}>
            <Icon.Trash /> Delete
          </button>
          <button onClick={() => setSelected(new Set())} style={styles.ghostBtn}>
            Clear
          </button>
        </div>
      )}

      {error && <p style={styles.errorText}>{error}</p>}
      {loading && items.length === 0 && <p style={styles.muted}>Loading…</p>}
      {!loading && items.length === 0 && <p style={styles.muted}>No pictures here.</p>}

      <div style={styles.grid}>
        {items.map((it) => {
          const isSel = selected.has(it.path);
          const isDragging = dragKey === it.path && dragKind === "photo";
          const isOver = dragOverKey === it.path && dragKind === "photo" && dragKey !== it.path;
          return (
            <div
              key={it.path}
              draggable
              onDragStart={(e) => {
                setDragKind("photo");
                setDragKey(it.path);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragKind === "photo") {
                  e.preventDefault();
                  if (dragOverKey !== it.path) setDragOverKey(it.path);
                }
              }}
              onDragLeave={() => {
                if (dragOverKey === it.path) setDragOverKey(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropPhoto(it.path);
              }}
              onDragEnd={() => {
                setDragKey(null);
                setDragOverKey(null);
                setDragKind(null);
              }}
              onClick={() => toggleSelect(it.path)}
              style={{
                ...styles.card,
                ...(isSel ? styles.cardSel : {}),
                ...(isDragging ? styles.cardDragging : {}),
                ...(isOver ? styles.cardOver : {}),
              }}
            >
              <div style={styles.imgWrap}>
                <Image
                  src={it.url}
                  alt={it.name}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 200px"
                  style={{ objectFit: "cover" }}
                  unoptimized={false}
                />
              </div>
              <div style={{ ...styles.checkbox, ...(isSel ? styles.checkboxOn : {}) }}>
                {isSel && <Icon.Check />}
              </div>
              <div style={styles.cardFooter}>
                <span style={styles.cardName} title={it.name}>
                  {it.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    renameOne(it.path);
                  }}
                  style={styles.iconBtn}
                  title="Rename"
                >
                  <Icon.Pencil />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(it);
                  }}
                  style={styles.iconBtn}
                  title="AI edit"
                >
                  <Icon.Sparkles />
                </button>
                <a
                  href={it.url}
                  download
                  onClick={(e) => e.stopPropagation()}
                  style={styles.iconBtn}
                  title="Download"
                >
                  <Icon.Download />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {editDraft && (
        <div
          style={styles.modalBackdrop}
          onClick={() => (editDraft.status === "editing" ? undefined : setEditDraft(null))}
        >
          <section style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h2 style={styles.modalTitle}>AI photo edit</h2>
                <p style={styles.modalSub}>
                  Use a reference plate/background, clean the scene, and save the result to this
                  folder.
                </p>
              </div>
              <button
                onClick={() => setEditDraft(null)}
                disabled={editDraft.status === "editing"}
                style={styles.closeBtn}
                title="Close"
              >
                <Icon.X />
              </button>
            </div>

            <div style={styles.editGrid}>
              <div style={styles.previewPanel}>
                <span style={styles.fieldLabel}>Source</span>
                <div style={styles.previewImage}>
                  <Image
                    src={editDraft.source.url}
                    alt={editDraft.source.name}
                    fill
                    sizes="320px"
                    style={{ objectFit: "cover" }}
                  />
                </div>
                <span style={styles.previewName}>{editDraft.source.name}</span>
              </div>

              <div style={styles.editControls}>
                <div style={styles.presetRow}>
                  <button
                    onClick={() => applyEditMode("plate")}
                    style={{
                      ...styles.smallBtn,
                      ...(editDraft.mode === "plate" ? styles.smallBtnActive : {}),
                    }}
                  >
                    Plate it
                  </button>
                  <button
                    onClick={() => applyEditMode("cleanup")}
                    style={{
                      ...styles.smallBtn,
                      ...(editDraft.mode === "cleanup" ? styles.smallBtnActive : {}),
                    }}
                  >
                    Clean up
                  </button>
                  <button
                    onClick={() => applyEditMode("hero")}
                    style={{
                      ...styles.smallBtn,
                      ...(editDraft.mode === "hero" ? styles.smallBtnActive : {}),
                    }}
                  >
                    Hero shot
                  </button>
                </div>

                {editDraft.mode === "plate" ? (
                  <label style={styles.field}>
                    <span style={styles.fieldLabel}>Plate folder</span>
                    <select
                      value={plateFolder}
                      onChange={(e) => {
                        const nextFolder = e.target.value;
                        setPlateFolder(nextFolder);
                        setEditDraft((prev) =>
                          prev ? { ...prev, referencePath: "", error: undefined, resultUrl: undefined } : prev
                        );
                        void loadPlateItems(nextFolder);
                      }}
                      style={styles.formSelect}
                      disabled={editDraft.status === "editing"}
                    >
                      {plateFolderOptions.map((folder) => (
                        <option key={folder.key} value={folder.key}>
                          {folder.label} ({folder.count})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label style={styles.field}>
                    <span style={styles.fieldLabel}>Optional reference</span>
                    <select
                      value={editDraft.referencePath}
                      onChange={(e) =>
                        setEditDraft((prev) =>
                          prev ? { ...prev, referencePath: e.target.value } : prev
                        )
                      }
                      style={styles.formSelect}
                      disabled={editDraft.status === "editing"}
                    >
                      <option value="">No reference image</option>
                      {items
                        .filter((it) => it.path !== editDraft.source.path)
                        .map((it) => (
                          <option key={it.path} value={it.path}>
                            {it.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}

                {editDraft.mode === "plate" && (
                  <>
                    <div style={styles.platePickerHeader}>
                      <span style={styles.fieldLabel}>Pick plate image</span>
                      <span style={styles.muted}>
                        {plateLoading ? "Loading..." : `${plateItems.length} in ${folderLabel(plateFolder)}`}
                      </span>
                    </div>
                    <div style={styles.platePicker}>
                      {plateItems
                        .filter((it) => it.path !== editDraft.source.path)
                      .map((it) => {
                        const selectedPlate = editDraft.referencePath === it.path;
                        return (
                          <button
                            key={it.path}
                            onClick={() =>
                              setEditDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      referencePath: it.path,
                                      error: undefined,
                                      resultUrl: undefined,
                                    }
                                  : prev
                              )
                            }
                            disabled={editDraft.status === "editing"}
                            style={{
                              ...styles.plateOption,
                              ...(selectedPlate ? styles.plateOptionActive : {}),
                            }}
                            title={it.name}
                          >
                            <Image
                              src={it.url}
                              alt={it.name}
                              fill
                              sizes="96px"
                              style={{ objectFit: "cover" }}
                            />
                            {selectedPlate && (
                              <span style={styles.plateCheck}>
                                <Icon.Check />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {!plateLoading &&
                      plateItems.filter((it) => it.path !== editDraft.source.path).length === 0 && (
                        <p style={styles.muted}>No plate images in this folder.</p>
                      )}
                  </>
                )}

                {editDraft.mode !== "plate" &&
                  items
                    .filter((it) => it.path === editDraft.referencePath)
                    .map((it) => (
                      <div key={it.path} style={styles.referencePreview}>
                        <Image src={it.url} alt={it.name} fill sizes="160px" style={{ objectFit: "cover" }} />
                      </div>
                    ))}

                <label style={styles.field}>
                  <span style={styles.fieldLabel}>Prompt</span>
                  <textarea
                    value={editDraft.prompt}
                    onChange={(e) =>
                      setEditDraft((prev) => (prev ? { ...prev, prompt: e.target.value } : prev))
                    }
                    style={styles.textarea}
                    rows={5}
                    disabled={editDraft.status === "editing"}
                  />
                </label>

                <div style={styles.twoCol}>
                  <label style={styles.field}>
                    <span style={styles.fieldLabel}>Size</span>
                    <select
                      value={editDraft.size}
                      onChange={(e) =>
                        setEditDraft((prev) => (prev ? { ...prev, size: e.target.value } : prev))
                      }
                      style={styles.formSelect}
                      disabled={editDraft.status === "editing"}
                    >
                      <option value="1024x1536">Portrait</option>
                      <option value="1024x1024">Square</option>
                      <option value="1536x1024">Landscape</option>
                    </select>
                  </label>
                  <label style={styles.field}>
                    <span style={styles.fieldLabel}>Quality</span>
                    <select
                      value={editDraft.quality}
                      onChange={(e) =>
                        setEditDraft((prev) => (prev ? { ...prev, quality: e.target.value } : prev))
                      }
                      style={styles.formSelect}
                      disabled={editDraft.status === "editing"}
                    >
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                </div>

                {editDraft.error && <p style={styles.errorText}>{editDraft.error}</p>}

                <button
                  onClick={runEdit}
                  disabled={editDraft.status === "editing"}
                  style={styles.primaryBtn}
                >
                  <Icon.Sparkles />{" "}
                  {editDraft.status === "editing" ? "Editing photo..." : "Generate edited copy"}
                </button>
              </div>
            </div>

            {editDraft.resultUrl && (
              <div style={styles.resultPanel}>
                <span style={styles.fieldLabel}>Saved result</span>
                <a
                  href={editDraft.resultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.resultLink}
                >
                  Open generated image
                </a>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

const Icon = {
  Folder: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Plus: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Trash: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Pencil: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  Download: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  Sparkles: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24 8.56 7.9 4.9 9.24l3.66 1.34 1.34 3.66 1.34-3.66 3.66-1.34-3.66-1.34z" />
      <path d="M18 12.5 17.2 15 15 15.8l2.2.8.8 2.4.8-2.4 2.2-.8-2.2-.8z" />
      <path d="M18.5 2.5 18 4l-1.5.5L18 5l.5 1.5L19 5l1.5-.5L19 4z" />
    </svg>
  ),
  X: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  ),
  ChevronLeft: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  LockClosed: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  LockOpen: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  ),
  BigX: () => (
    <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#ff3b3b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  ),
};

const styles: Record<string, React.CSSProperties> = {
  main: { maxWidth: 1280, margin: "0 auto", padding: "24px 16px 80px" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20 },
  headerActions: { display: "flex", gap: 8, alignItems: "center", flexShrink: 0 },
  title: { fontSize: 32, fontWeight: 700, margin: 0, letterSpacing: -0.5 },
  subtitle: { margin: "6px 0 0", color: "#888", fontSize: 13 },
  uploadBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: "var(--accent)", color: "#fff", border: "1px solid var(--accent)",
    padding: "10px 16px", borderRadius: 999, fontSize: 14, fontWeight: 600,
    textDecoration: "none", whiteSpace: "nowrap",
  },
  backBtn: {
    display: "inline-flex", alignItems: "center", gap: 4,
    background: "transparent", color: "#bbb", border: "none",
    padding: "4px 0", fontSize: 13, cursor: "pointer",
  },

  folderGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: 14,
  },
  folderCard: {
    position: "relative",
    background: "#121212",
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: 14,
    overflow: "hidden",
    cursor: "pointer",
    transition: "border-color 120ms, transform 80ms",
  },
  folderCover: {
    position: "relative", width: "100%", aspectRatio: "1",
    background: "#1a1a1a",
  },
  folderCoverEmpty: {
    width: "100%", height: "100%",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "#444",
  },
  folderCount: {
    position: "absolute", bottom: 8, left: 8,
    background: "rgba(0,0,0,0.72)", color: "#fff",
    padding: "2px 8px", borderRadius: 999,
    fontSize: 12, fontWeight: 700,
  },
  folderDeleteBtn: {
    position: "absolute", top: 8, right: 8,
    width: 28, height: 28, borderRadius: "50%",
    background: "rgba(0,0,0,0.6)", color: "#ff8b8b",
    border: "none", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  folderLockBtn: {
    position: "absolute", top: 8, right: 44,
    width: 28, height: 28, borderRadius: "50%",
    background: "rgba(0,0,0,0.6)", color: "#bbb",
    border: "none", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  folderLockBtnOn: { color: "#ffd166" },
  folderCoverPrivate: {
    width: "100%", height: "100%",
    background: "#1a0606",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  folderLabel: {
    padding: "10px 12px",
    fontSize: 14, fontWeight: 600, color: "#eee",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    textTransform: "capitalize",
  },
  folderNewCard: {
    background: "transparent",
    border: "2px dashed #2d4a85",
    borderRadius: 14,
    color: "var(--accent)",
    cursor: "pointer",
    aspectRatio: "1",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  folderNewInner: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
    fontSize: 14, fontWeight: 600,
  },

  cardDragging: { opacity: 0.4 },
  cardOver: { borderColor: "var(--accent)", transform: "scale(1.02)" },

  actionsRow: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 16px" },
  muted: { color: "#888", fontSize: 13 },
  errorText: { color: "#ff8b8b" },

  toolbar: {
    position: "sticky", top: 8, zIndex: 5,
    display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
    background: "#1a1a1a", border: "1px solid #2a2a2a",
    padding: "10px 14px", borderRadius: 12, marginBottom: 16,
  },
  toolbarCount: { fontSize: 14, fontWeight: 600 },
  formSelect: {
    background: "#0b0b0b", color: "#f5f5f5",
    border: "1px solid #2a2a2a", borderRadius: 8, padding: "6px 10px", fontSize: 14,
  },
  dangerBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: "#3a1414", color: "#ff8b8b", border: "1px solid #5a2a2a",
    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600,
  },
  ghostBtn: {
    background: "transparent", color: "#bbb", border: "1px solid #2a2a2a",
    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 14,
  },
  moveBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: "#1a2740", color: "#7eb0ff", border: "1px solid #2d4a85",
    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600,
  },
  moveCountBadge: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    minWidth: 20, height: 20, padding: "0 6px",
    background: "rgba(126,176,255,0.16)", color: "#d6e5ff",
    border: "1px solid rgba(126,176,255,0.28)", borderRadius: 999,
    fontSize: 12, fontWeight: 800, lineHeight: 1,
  },
  moveBtnNew: {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: "transparent", color: "var(--accent)", border: "1px dashed #2d4a85",
    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 14,
  },
  divider: { width: 1, height: 24, background: "#2a2a2a", margin: "0 4px" },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 },
  card: {
    position: "relative", background: "#121212", borderRadius: 12, overflow: "hidden",
    cursor: "pointer", borderWidth: 2, borderStyle: "solid", borderColor: "transparent",
    transition: "border-color 120ms, transform 80ms",
  },
  cardSel: { borderColor: "var(--accent)" },
  imgWrap: { position: "relative", width: "100%", aspectRatio: "1", background: "#1a1a1a" },
  checkbox: {
    position: "absolute", top: 8, left: 8,
    width: 26, height: 26, borderRadius: "50%",
    background: "rgba(0,0,0,0.5)", border: "2px solid white",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "white",
  },
  checkboxOn: { background: "var(--accent)", borderColor: "var(--accent)" },

  cardFooter: { display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", fontSize: 12 },
  cardName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ddd" },
  iconBtn: {
    background: "transparent", color: "#bbb", border: "none", cursor: "pointer",
    padding: 4, display: "inline-flex", alignItems: "center", justifyContent: "center",
    textDecoration: "none",
  },
  modalBackdrop: {
    position: "fixed", inset: 0, zIndex: 20,
    background: "rgba(0,0,0,0.72)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 16,
  },
  modal: {
    width: "min(920px, 100%)", maxHeight: "92vh", overflow: "auto",
    background: "#101010", border: "1px solid #2a2a2a", borderRadius: 12,
    padding: 18, boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
  },
  modalHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 16 },
  modalTitle: { margin: 0, fontSize: 22, fontWeight: 700 },
  modalSub: { margin: "6px 0 0", color: "#999", fontSize: 13, lineHeight: 1.4 },
  closeBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 36, height: 36, flex: "0 0 auto",
    background: "#171717", color: "#ddd", border: "1px solid #2a2a2a",
    borderRadius: 8, cursor: "pointer",
  },
  editGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 16 },
  previewPanel: { minWidth: 0 },
  previewImage: { position: "relative", width: "100%", aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "#1a1a1a", margin: "8px 0" },
  previewName: { display: "block", color: "#bbb", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  editControls: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  fieldLabel: { color: "#aaa", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  textarea: {
    width: "100%", resize: "vertical", background: "#090909", color: "#f5f5f5",
    border: "1px solid #2a2a2a", borderRadius: 8, padding: "10px 12px",
    fontSize: 14, lineHeight: 1.4,
  },
  referencePreview: { position: "relative", width: 120, aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "#1a1a1a" },
  presetRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  smallBtn: {
    background: "#171717", color: "#d8d8d8",
    borderWidth: 1, borderStyle: "solid", borderColor: "#303030",
    borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontSize: 13,
  },
  smallBtnActive: {
    background: "#1a2740", color: "#fff", borderColor: "var(--accent)",
  },
  platePickerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  platePicker: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
    gap: 8,
    maxHeight: 180,
    overflow: "auto",
    padding: 2,
  },
  plateOption: {
    position: "relative",
    width: "100%",
    aspectRatio: "1",
    borderRadius: 8,
    overflow: "hidden",
    background: "#171717",
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "#2a2a2a",
    cursor: "pointer",
  },
  plateOptionActive: { borderColor: "var(--accent)" },
  plateCheck: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: "var(--accent)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  twoCol: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 },
  primaryBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    width: "100%", background: "var(--accent)", color: "#fff", border: "1px solid var(--accent)",
    borderRadius: 8, padding: "11px 14px", cursor: "pointer", fontSize: 14, fontWeight: 700,
  },
  resultPanel: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
    marginTop: 16, borderTop: "1px solid #242424", paddingTop: 14,
  },
  resultLink: { color: "var(--accent)", fontSize: 14, textDecoration: "none", fontWeight: 700 },
};

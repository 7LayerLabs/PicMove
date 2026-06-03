"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) setError(error.message);
  }

  if (!ready) {
    return (
      <main style={styles.center}>
        <p style={styles.muted}>Loading…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main style={styles.center}>
        <form onSubmit={signIn} style={styles.card}>
          <h1 style={styles.title}>PicMove</h1>
          <p style={styles.sub}>Sign in to continue.</p>
          <label style={styles.label}>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              required
            />
          </label>
          <label style={styles.label}>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              required
            />
          </label>
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" disabled={busy} style={styles.button}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  return <>{children}</>;
}

export function SignOutButton({ style }: { style?: React.CSSProperties }) {
  return (
    <button
      onClick={() => supabase.auth.signOut()}
      style={{
        background: "transparent",
        color: "#bbb",
        border: "1px solid #2a2a2a",
        padding: "8px 14px",
        borderRadius: 999,
        fontSize: 13,
        cursor: "pointer",
        whiteSpace: "nowrap",
        ...style,
      }}
      title="Sign out"
    >
      Sign out
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  center: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    width: "min(360px, 100%)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    background: "#121212",
    border: "1px solid #2a2a2a",
    borderRadius: 16,
    padding: 24,
  },
  title: { fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -0.5 },
  sub: { margin: "0 0 4px", color: "#888", fontSize: 14 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#aaa" },
  input: {
    background: "#0b0b0b",
    color: "#f5f5f5",
    border: "1px solid #2a2a2a",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 16,
  },
  button: {
    marginTop: 4,
    background: "var(--accent)",
    color: "#fff",
    border: "1px solid var(--accent)",
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
  },
  error: { color: "#ff8b8b", fontSize: 13, margin: 0 },
  muted: { color: "#888", fontSize: 14 },
};

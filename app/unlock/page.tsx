"use client";

import { useState } from "react";

export default function Unlock() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const code = new FormData(e.currentTarget).get("code");
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      const next = new URLSearchParams(location.search).get("next") || "/";
      location.href = next.startsWith("/") ? next : "/";
    } else {
      const data = await res.json().catch(() => ({}));
      setErr(data.error || "Falscher Code / Неверный код");
      setBusy(false);
    }
  }

  return (
    <main className="unlock">
      <form onSubmit={submit}>
        <h1>Zugang zur Demo</h1>
        <p>Bitte den Zugangscode eingeben. / Введите код доступа.</p>
        <input name="code" type="password" autoComplete="current-password" required autoFocus aria-label="Code" />
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn btn-primary" disabled={busy}>Öffnen / Открыть</button>
      </form>
    </main>
  );
}

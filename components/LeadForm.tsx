"use client";

import { useState } from "react";
import { T, type Lang } from "@/lib/i18n";

export default function LeadForm({ lang, onDone }: { lang: Lang; onDone?: () => void }) {
  const t = T[lang];
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError("");
    setState("sending");
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.get("name"),
          phone: f.get("phone"),
          district: f.get("district"),
          concern: f.get("concern"),
          consent: f.get("consent") === "on",
          language: lang,
          source: "chat",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "error");
      setState("done");
      onDone?.();
    } catch (err) {
      setError(err instanceof Error && err.message !== "error" ? err.message : t.errorGeneric);
      setState("idle");
    }
  }

  if (state === "done") return <div className="lead lead-done" role="status">{t.leadDone}</div>;

  return (
    <form className="lead" onSubmit={submit}>
      <h3>{t.leadTitle}</h3>
      <p className="lead-text">{t.leadText}</p>
      <label>
        <span>{t.leadName}</span>
        <input name="name" required minLength={2} maxLength={80} autoComplete="name" />
      </label>
      <label>
        <span>{t.leadPhone}</span>
        <input name="phone" required type="tel" inputMode="tel" maxLength={40} autoComplete="tel" />
      </label>
      <label>
        <span>{t.leadDistrict}</span>
        <input name="district" maxLength={80} autoComplete="address-level2" />
      </label>
      <label>
        <span>{t.leadConcern}</span>
        <textarea name="concern" rows={2} maxLength={400} />
      </label>
      <label className="consent">
        <input type="checkbox" name="consent" required />
        <span>{t.leadConsent}</span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={state === "sending"}>
        {state === "sending" ? t.leadSending : t.leadSubmit}
      </button>
    </form>
  );
}

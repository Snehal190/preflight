"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Booking } from "@/lib/types";
import type { BookingState, Evaluation } from "@/lib/booking/state";
import type { ParseWarning } from "@/lib/parse";
import { saveBatch, type StoredBatch } from "@/lib/client/store";

interface UploadResponse {
  batch: { id: string; createdAt: string; files: string[]; warnings: ParseWarning[]; bookings: { booking: Booking; label: string; state: BookingState; evaluation: Evaluation }[] };
}

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({ error: "The server had a problem reading the upload. Please try again." }))) as UploadResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      const at = data.batch.createdAt;
      const batch: StoredBatch = {
        ...data.batch,
        bookings: data.batch.bookings.map((b) => ({
          key: b.booking.key,
          label: b.label,
          booking: b.booking,
          state: b.state,
          evaluation: b.evaluation,
          versions: [{ n: 1, at, booking: b.booking, state: b.state, chips: [], cause: "Uploaded" }],
        })),
      };
      if (!saveBatch(batch)) throw new Error("Couldn't save the results in this browser (storage full or blocked).");
      router.push(`/batch/${batch.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-1">
        <p className="eyebrow">New booking · spreadsheets</p>
        <h1 className="text-[34px]">Upload your sheets</h1>
        <p className="max-w-xl text-ink-2">
          The Bookings sheet and the Items sheet — one .xlsx workbook with both, two files, or two CSVs. We check every booking against all 10 rules.
        </p>
      </div>
      <form onSubmit={submit} className="card space-y-4 p-5">
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-mist px-6 py-10 text-center transition-colors hover:border-accent"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-xl text-accent" aria-hidden>⬆</span>
          <span className="font-semibold">Drop your files here, or click to choose</span>
          <span className="mono text-xs text-ink-3">.xlsx or .csv · max 4 MB · 2,000 rows per sheet</span>
          <input type="file" multiple accept=".xlsx,.csv" className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </label>
        {files.length > 0 && (
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.name} className="mono flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[12.5px]">
                <span className="truncate">{f.name}</span>
                <span className="text-ink-3">{(f.size / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn" disabled={busy || files.length === 0}>
            {busy ? "Checking…" : "▶ Check my bookings"}
          </button>
          <span className="text-xs text-ink-3">Product descriptions are also checked by AI for dangerous goods. Nothing is sent to a carrier.</span>
        </div>
        {error && <p role="alert" className="font-semibold text-bad">{error}</p>}
      </form>
    </div>
  );
}

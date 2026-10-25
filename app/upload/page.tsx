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
    <div className="space-y-6">
      <h1 className="text-5xl">Upload your sheets</h1>
      <p className="text-ink/70 max-w-xl">
        Choose the Bookings sheet and the Items sheet: one .xlsx workbook with both, two files, or two CSVs. Max 4 MB, 2,000 rows per sheet.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <input
          type="file"
          multiple
          accept=".xlsx,.csv"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-sm file:mr-4 file:rounded-lg file:border file:border-ink file:bg-accent file:px-4 file:py-2 file:font-semibold"
        />
        {files.length > 0 && <p className="text-sm">{files.map((f) => f.name).join(", ")}</p>}
        <button type="submit" className="btn" disabled={busy || files.length === 0}>
          {busy ? "Checking…" : "Check my bookings"}
        </button>
      </form>
      {error && <p role="alert" className="text-bad font-semibold">{error}</p>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { HistoryEntry } from "@/lib/history";
import { loadBatch } from "@/lib/client/store";
import { fmtGBP } from "@/lib/format";
import { StatusBadge } from "@/app/components/StatusBadge";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Every shipment checked on this PreFlight, by any seller, newest first. */
export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seller, setSeller] = useState("");
  const [here, setHere] = useState<Set<string>>(new Set());
  const [persistent, setPersistent] = useState(true);

  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json() as Promise<{ entries: HistoryEntry[]; persistent: boolean }>)
      .then((d) => {
        setEntries(d.entries);
        setPersistent(d.persistent);
        // Bookings saved in this browser can be opened; others are a record only.
        setHere(new Set(d.entries.filter((e) => loadBatch(e.batchId)?.bookings.some((b) => b.key === e.key)).map((e) => e.id)));
      })
      .catch(() => setError("Couldn't load the history. Please refresh."));
  }, []);

  const sellers = [...new Set((entries ?? []).map((e) => e.seller).filter(Boolean))].sort();
  const shown = (entries ?? []).filter((e) => !seller || e.seller === seller);
  const count = (s: string) => shown.filter((e) => e.status === s).length;

  return (
    <div className="space-y-8 pb-16">
      <div className="space-y-3 pt-4">
        <p className="eyebrow">History</p>
        <h1 className="text-[34px] sm:text-[44px]">Shipment history</h1>
        <p className="max-w-2xl text-ink-2">Every booking checked here, from uploaded sheets or by voice and chat, newest first. Anyone using this PreFlight sees the same list.</p>
      </div>

      {!persistent && (
        <p role="status" className="rounded-xl border border-accent bg-accent-soft p-4 text-sm">
          <b>Temporary history:</b> on this website the history is kept for a while and then cleared, until the database is connected.
        </p>
      )}
      {error && <p role="alert" className="font-semibold text-bad">{error}</p>}
      {entries === null && !error && <p className="text-ink-3">Loading…</p>}

      {entries && entries.length === 0 && (
        <div className="card space-y-4 p-8 text-center">
          <p className="text-lg font-semibold">No shipments yet.</p>
          <p className="text-ink-2">Upload your sheets or speak a booking, and it will appear here.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/chat" className="btn">Speak or type</Link>
            <Link href="/upload" className="btn btn-dark">Upload sheets</Link>
          </div>
        </div>
      )}

      {entries && entries.length > 0 && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="block font-semibold">Seller</span>
              <select className="mt-1 rounded-lg border border-ink/25 bg-paper p-2" value={seller} onChange={(e) => setSeller(e.target.value)}>
                <option value="">All sellers ({entries.length})</option>
                {sellers.map((s) => (
                  <option key={s} value={s}>
                    {s} ({entries.filter((e) => e.seller === s).length})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full border border-line bg-paper px-3 py-1.5"><b>{shown.length}</b> shipments</span>
              <span className="rounded-full border border-line bg-paper px-3 py-1.5"><b>{count("ready")}</b> ready</span>
              <span className="rounded-full border border-line bg-paper px-3 py-1.5"><b>{count("check")}</b> to check</span>
              <span className="rounded-full border border-line bg-paper px-3 py-1.5"><b>{count("blocked")}</b> blocked</span>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Booking", "Seller", "Route", "Status", "Carrier", "How it came in", "Last change", "Updated"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="border-b border-line/60 align-top">
                    <td className="whitespace-nowrap px-4 py-3">
                      {here.has(e.id) ? (
                        <Link className="font-semibold underline" href={`/batch/${e.batchId}/${encodeURIComponent(e.key)}`}>{e.bookingId || "Booking"}</Link>
                      ) : (
                        <span className="font-semibold" title="Made in another browser">{e.bookingId || "Booking"}</span>
                      )}
                      <span className="block text-xs text-ink-3">{e.items} product{e.items === 1 ? "" : "s"}</span>
                    </td>
                    <td className="px-4 py-3">{e.seller || "-"}</td>
                    <td className="whitespace-nowrap px-4 py-3">{e.route}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={e.status} />
                      <span className="mt-1 block text-xs text-ink-3">{e.headline}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{e.carrier ? `${e.carrier}${e.cost ? ` · ${fmtGBP(e.cost)}` : ""}` : "-"}</td>
                    <td className="px-4 py-3">{e.source === "chat" ? "Voice or chat" : `Upload${e.files.length ? `: ${e.files.join(", ")}` : ""}`}</td>
                    <td className="px-4 py-3 text-ink-2">{e.lastChange}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-2">
                      {when(e.updatedAt)}
                      {e.updatedAt !== e.createdAt && <span className="block text-xs text-ink-3">first {when(e.createdAt)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

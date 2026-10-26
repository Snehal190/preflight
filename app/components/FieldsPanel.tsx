"use client";

import { useState } from "react";
import type { Booking, FieldValue } from "@/lib/types";
import { BOOKING_EDITABLE, ITEM_EDITABLE } from "@/lib/booking/edit";
import { fmtDateField, fmtNum } from "@/lib/format";
import { itemName, locationText } from "@/lib/rules/helpers";
import { ASSUMPTIONS, type AssumptionId } from "@/lib/reference/assumptions";

function display(field: string, f: FieldValue<unknown>): string {
  if (f.value === null) return f.raw ? `"${f.raw}" — ${f.problem ?? "unreadable"}` : "(blank)";
  if (field === "readyDate") return fmtDateField(String(f.value));
  if (typeof f.value === "number") return fmtNum(f.value);
  return String(f.value);
}

const SOURCE_CLS: Record<string, string> = {
  file: "bg-sage/30",
  stated: "bg-sage/30",
  derived: "bg-accent-soft text-accent",
  confirmed: "bg-sage/50",
  assumed: "bg-accent font-bold",
  fixed: "bg-ink text-white",
};

function Row({ label, field, f, onSave, busy }: { label: string; field: string; f: FieldValue<unknown>; onSave: (text: string) => void; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  return (
    <tr className="border-t border-ink/10 align-top">
      <td className="py-1 pr-3 font-semibold whitespace-nowrap">{label}</td>
      <td className="py-1 pr-3">
        {editing ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              onSave(text);
            }}
          >
            <input autoFocus className="border border-ink/30 rounded px-2 py-0.5 w-full min-w-0" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn text-xs py-0.5" type="submit" disabled={busy}>Save</button>
            <button className="btn btn-ghost text-xs py-0.5" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        ) : (
          <span className={f.value === null ? "text-bad" : ""}>{display(field, f)}</span>
        )}
        {f.source === "assumed" && f.assumptionId && (
          <p className="text-xs"><strong>ASSUMPTION: {ASSUMPTIONS[f.assumptionId as AssumptionId]?.label}</strong></p>
        )}
        {f.formula && <p className="text-xs text-ink/70">= {f.formula}</p>}
      </td>
      <td className="py-1 pr-3"><span className={`rounded px-1.5 text-xs ${SOURCE_CLS[f.source] ?? ""}`}>{f.source}</span></td>
      <td className="py-1 pr-3 text-xs text-ink/60">{locationText(f.location)}</td>
      <td className="py-1">
        {!editing && (
          <button
            type="button"
            className="underline text-xs"
            disabled={busy}
            onClick={() => {
              setText(field === "readyDate" && f.value ? fmtDateField(String(f.value)) : f.value !== null ? String(f.value) : (f.raw ?? ""));
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}

export function FieldsPanel({
  booking,
  busy,
  onEditBooking,
  onEditItem,
}: {
  booking: Booking;
  busy: boolean;
  onEditBooking: (field: string, text: string, label: string) => void;
  onEditItem: (itemId: string, field: string, text: string, label: string) => void;
}) {
  const rec = booking as unknown as Record<string, FieldValue<unknown>>;
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(BOOKING_EDITABLE).map(([field, def]) => (
              <Row key={field} label={def.label} field={field} f={rec[field]} busy={busy} onSave={(t) => onEditBooking(field, t, def.label)} />
            ))}
          </tbody>
        </table>
      </div>
      {booking.items.map((it) => {
        const irec = it as unknown as Record<string, FieldValue<unknown>>;
        return (
          <div key={it.itemId} className="overflow-x-auto">
            <h4 className="font-semibold mb-1">Item: {itemName(it)}</h4>
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(ITEM_EDITABLE).map(([field, def]) => (
                  <Row key={field} label={def.label} field={field} f={irec[field]} busy={busy} onSave={(t) => onEditItem(it.itemId, field, t, `${itemName(it)} ${def.label}`)} />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="text-xs text-ink/60">Dates: type day first, DD-MM-YYYY. Edits are checked with the same rules as an upload.</p>
    </div>
  );
}

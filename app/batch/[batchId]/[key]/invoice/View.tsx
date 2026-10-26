"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useBooking } from "@/lib/client/useBooking";
import { buildInvoice, emptyExtra, INCOTERMS, REQUIRED_EXTRA, type Invoice, type InvoiceExtra } from "@/lib/invoice";
import { fmtDateField, fmtDateLong, fmtNum } from "@/lib/format";

// Seller details are remembered in this browser for the next invoice; buyer details per booking.
const SELLER_KEYS = ["sellerAddress", "sellerEori", "sellerVat", "sellerEmail", "sellerPhone"] as const;
const sellerKey = "preflight:seller-details";
const invoiceKey = (batchId: string, key: string) => `preflight:invoice:${batchId}:${key}`;

function load<T>(k: string): Partial<T> {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "{}") as Partial<T>;
  } catch {
    return {};
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable: the invoice still works for this visit */
  }
}

/** A value, or a highlighted placeholder saying what to add. */
function V({ v, add }: { v: string; add: string }) {
  return v ? <>{v}</> : <span className="rounded bg-accent-soft px-1 font-semibold text-black">[{add}]</span>;
}

function Field({ label, value, onChange, required, multiline, hint }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; multiline?: boolean; hint?: string }) {
  const cls = `mt-1 w-full rounded-lg border p-2 text-sm ${required && !value.trim() ? "border-accent bg-accent-soft/40" : "border-ink/25"}`;
  return (
    <label className="block text-sm">
      <span className="font-semibold">
        {label}
        {required && <span className="text-ink-3"> (needed)</span>}
      </span>
      {multiline ? <textarea className={cls} rows={3} value={value} onChange={(e) => onChange(e.target.value)} /> : <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} />}
      {hint && <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Sheet({ inv }: { inv: Invoice }) {
  const s = inv.seller;
  const initials = s.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return (
    <article className="invoice mx-auto w-full max-w-[820px] bg-white p-8 text-[13px] leading-relaxed text-[#111] shadow-sm sm:p-12 print:max-w-none print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="grid h-20 w-20 place-items-center rounded-md bg-[#111] text-2xl font-extrabold text-[#ffd21f]">{initials}</div>
        <div className="text-right">
          <p>
            <b className="text-[15px]">{s.name}</b>
          </p>
          <p className="whitespace-pre-line">
            <V v={s.address} add="Your business address" />
          </p>
          <p>
            <b>EORI No.</b> <V v={s.eori} add="Your EORI number" />
          </p>
          {s.vat && (
            <p>
              <b>VAT No.</b> {s.vat}
            </p>
          )}
          {(s.email || s.phone) && (
            <p>
              {s.email && (
                <>
                  <b>Email:</b> {s.email}
                </>
              )}
              {s.email && s.phone && "  "}
              {s.phone && (
                <>
                  <b>Phone:</b> {s.phone}
                </>
              )}
            </p>
          )}
        </div>
      </header>

      <hr className="my-6 border-[#bbb]" />

      <section className="flex flex-wrap justify-between gap-6">
        <div className="flex gap-6">
          <span className="font-semibold">Bill to:</span>
          <div>
            <p>
              <V v={inv.buyer.name} add="Buyer name" />
            </p>
            <p className="whitespace-pre-line">
              <V v={inv.buyer.address} add="Buyer address" />
            </p>
            <p>{inv.buyer.country}</p>
            {inv.buyer.vat && <p>VAT No. {inv.buyer.vat}</p>}
          </div>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-10 gap-y-1">
          <dt className="text-[15px] font-bold">Commercial invoice:</dt>
          <dd className="text-right">
            <V v={inv.number} add="Invoice number" />
          </dd>
          <dt>Invoice date:</dt>
          <dd className="text-right">{fmtDateField(inv.date).replace(/-/g, "/")}</dd>
          <dt>Incoterms:</dt>
          <dd className="text-right">
            <V v={inv.incoterms} add="Incoterms" />
          </dd>
          <dt>Currency:</dt>
          <dd className="text-right">{inv.currency}</dd>
        </dl>
      </section>

      <hr className="mb-2 mt-6 border-[#bbb]" />

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[#bbb] text-left">
            <th className="py-2 pr-2 font-semibold">Description</th>
            <th className="py-2 pr-2 font-semibold">HS code</th>
            <th className="py-2 pr-2 font-semibold">Origin</th>
            <th className="py-2 pr-2 text-right font-semibold">Quantity</th>
            <th className="py-2 pr-2 text-right font-semibold">Unit</th>
            <th className="py-2 pr-2 text-right font-semibold">Price</th>
            <th className="py-2 pr-2 text-right font-semibold">VAT</th>
            <th className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.sku + l.description} className="border-b border-[#e3e3e3] align-top">
              <td className="py-2 pr-2">
                {l.description}
                <span className="block text-[11px] text-[#666]">
                  SKU {l.sku} · net {l.netKg} kg
                </span>
              </td>
              <td className="py-2 pr-2 font-mono">{l.hsCode}</td>
              <td className="py-2 pr-2">{l.origin}</td>
              <td className="py-2 pr-2 text-right">{fmtNum(l.quantity)}</td>
              <td className="py-2 pr-2 text-right">unit</td>
              <td className="py-2 pr-2 text-right">{l.unitPrice}</td>
              <td className="py-2 pr-2 text-right">0%</td>
              <td className="py-2 text-right">{l.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="ml-auto mt-4 w-full max-w-[330px]">
        <div className="flex justify-between py-1">
          <span>Subtotal without VAT</span>
          <span>{inv.subtotal}</span>
        </div>
        <div className="flex justify-between py-1">
          <span>VAT 0% of {inv.subtotal}</span>
          <span>{inv.vat}</span>
        </div>
        <div className="flex justify-between border-b border-[#bbb] py-1 font-bold">
          <span>Total GBP</span>
          <span>{inv.total}</span>
        </div>
        <div className="flex justify-between py-3 text-[17px] font-bold">
          <span>Invoice value (GBP)</span>
          <span>{inv.total}</span>
        </div>
      </section>

      <section className="mt-6 grid gap-x-8 gap-y-1 text-[12px] sm:grid-cols-2">
        <p className="col-span-full mb-1 text-[13px] font-bold">Shipment</p>
        <p>
          <b>From:</b> {inv.shipment.from}
        </p>
        <p>
          <b>To:</b> {inv.shipment.to}
        </p>
        <p>
          <b>Carrier:</b> {inv.shipment.carrier ?? "-"}
        </p>
        <p>
          <b>Collection:</b> {inv.shipment.collection ? fmtDateLong(inv.shipment.collection) : "-"}
        </p>
        <p>
          <b>Packages:</b> {inv.shipment.pallets ?? "-"} pallets, {inv.shipment.cartons ?? "-"} cartons
        </p>
        <p>
          <b>Weight:</b> gross {inv.shipment.grossKg ?? "-"} kg, net {inv.shipment.netKg ?? "-"} kg
        </p>
      </section>

      <section className="mt-8 text-[12px]">
        <p className="text-[13px] font-bold">Terms &amp; Conditions</p>
        <p>
          Reason for export: <V v={inv.reasonForExport} add="Reason for export" />. Zero-rated export of goods from the United Kingdom.
        </p>
        <p>I declare that the information on this invoice is true and correct, and that the goods originate as stated.</p>
        <div className="mt-10 flex flex-wrap justify-between gap-6">
          <p className="min-w-[220px] border-t border-[#999] pt-1">Signature</p>
          <p className="min-w-[220px] border-t border-[#999] pt-1">Name and date</p>
        </div>
      </section>
    </article>
  );
}

export default function View() {
  const { batchId, key: rawKey } = useParams<{ batchId: string; key: string }>();
  const key = decodeURIComponent(rawKey);
  const bk = useBooking(batchId, key);
  const [extra, setExtra] = useState<InvoiceExtra | null>(null);

  useEffect(() => {
    if (!bk.entry || extra) return;
    setExtra({ ...emptyExtra(bk.entry.booking), ...load<InvoiceExtra>(sellerKey), ...load<InvoiceExtra>(invoiceKey(batchId, key)) });
  }, [bk.entry, extra, batchId, key]);

  if (!bk.loaded) return null;
  if (!bk.entry) return <p>Booking not found in this browser.</p>;
  const back = `/batch/${batchId}/${encodeURIComponent(key)}`;
  const { booking, evaluation: e } = bk.entry;
  if (e.status !== "ready") {
    return (
      <p>
        The invoice is made once the booking is ready for take-off ({e.headline}). <Link className="underline" href={back}>Back to the checks</Link>.
      </p>
    );
  }
  if (!extra) return null;

  const set = (k: keyof InvoiceExtra) => (v: string) => {
    const next = { ...extra, [k]: v };
    setExtra(next);
    save(invoiceKey(batchId, key), next);
    save(sellerKey, Object.fromEntries(SELLER_KEYS.map((s) => [s, next[s]])));
  };
  const inv = buildInvoice(booking, e, extra, e.today);
  const required = new Set(REQUIRED_EXTRA.map((f) => f.key));

  return (
    <div className="space-y-6 pb-16">
      <div className="space-y-2 pt-4 print:hidden">
        <Link href={`${back}/takeoff`} className="text-sm underline">
          ← Take-off summary
        </Link>
        <p className="eyebrow">Commercial invoice</p>
        <h1 className="text-[34px] sm:text-[40px]">Your invoice for {bk.entry.label}</h1>
        <p className="text-ink-2">Everything from your booking is filled in. Add the details we don&apos;t have, then save it as a PDF.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <form className="card h-fit space-y-4 p-5 print:hidden" onSubmit={(ev) => ev.preventDefault()}>
          {inv.missing.length > 0 ? (
            <p className="rounded-lg bg-accent-soft p-3 text-sm">
              <b>Still to add:</b> {inv.missing.join(", ")}. They show as yellow placeholders on the invoice.
            </p>
          ) : (
            <p className="rounded-lg bg-good-soft p-3 text-sm font-semibold text-good">✓ Everything customs needs is on the invoice.</p>
          )}
          <Field label="Invoice number" value={extra.invoiceNumber} onChange={set("invoiceNumber")} required={required.has("invoiceNumber")} />
          <p className="eyebrow pt-2">You (exporter)</p>
          <Field label="Business address" value={extra.sellerAddress} onChange={set("sellerAddress")} required multiline />
          <Field label="EORI number" value={extra.sellerEori} onChange={set("sellerEori")} required hint="Starts with GB, e.g. GB123456789000. Customs needs it for every export." />
          <Field label="VAT number" value={extra.sellerVat} onChange={set("sellerVat")} />
          <Field label="Email" value={extra.sellerEmail} onChange={set("sellerEmail")} />
          <Field label="Phone" value={extra.sellerPhone} onChange={set("sellerPhone")} />
          <p className="eyebrow pt-2">Buyer (consignee)</p>
          <Field label="Name" value={extra.buyerName} onChange={set("buyerName")} required />
          <Field label="Address" value={extra.buyerAddress} onChange={set("buyerAddress")} required multiline hint={`The country is filled in: ${booking.destinationCountry.value ?? "-"}.`} />
          <Field label="VAT number" value={extra.buyerVat} onChange={set("buyerVat")} />
          <p className="eyebrow pt-2">Terms</p>
          <label className="block text-sm">
            <span className="font-semibold">
              Incoterms <span className="text-ink-3">(needed)</span>
            </span>
            <select className={`mt-1 w-full rounded-lg border p-2 text-sm ${extra.incoterms ? "border-ink/25" : "border-accent bg-accent-soft/40"}`} value={extra.incoterms} onChange={(ev) => set("incoterms")(ev.target.value)}>
              <option value="">Choose who pays for what…</option>
              {INCOTERMS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <Field label="Reason for export" value={extra.reasonForExport} onChange={set("reasonForExport")} required />
          <button type="button" className="btn w-full" onClick={() => window.print()}>
            Save as PDF or print
          </button>
          <p className="text-xs text-ink-3">
            VAT is shown as 0% because exports of goods from the UK are normally zero-rated. <b>ASSUMPTION:</b> this is a direct export; check with your accountant if not.
          </p>
        </form>

        <div className="overflow-x-auto rounded-2xl border border-line bg-mist p-3 sm:p-6 print:overflow-visible print:border-0 print:bg-white print:p-0">
          <Sheet inv={inv} />
        </div>
      </div>
    </div>
  );
}

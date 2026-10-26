import type { Booking } from "../types";
import type { Evaluation } from "../booking/state";
import { dec, sum, type Decimal } from "../num";
import { fmtNum } from "../format";
import { netWeight } from "../rules/weights";

// Commercial invoice (spec E, rules checklist 86), laid out like the product owner's template.
// Everything we know comes from the checked booking. What we never collect (buyer, addresses,
// EORI, Incoterms) the seller types in; until then it shows as a clearly labelled placeholder.

export const INCOTERMS = [
  { code: "DAP", label: "DAP: Delivered at Place (you pay transport, the buyer pays import duty and VAT)" },
  { code: "DDP", label: "DDP: Delivered Duty Paid (you pay transport, duty and VAT)" },
  { code: "CPT", label: "CPT: Carriage Paid To (you pay transport; risk passes at handover)" },
  { code: "FCA", label: "FCA: Free Carrier (the buyer pays transport from collection)" },
  { code: "EXW", label: "EXW: Ex Works (the buyer arranges everything)" },
] as const;

export interface InvoiceExtra {
  invoiceNumber: string;
  sellerAddress: string;
  sellerEori: string;
  sellerVat: string;
  sellerEmail: string;
  sellerPhone: string;
  buyerName: string;
  buyerAddress: string;
  buyerVat: string;
  incoterms: string;
  reasonForExport: string;
}

export function emptyExtra(b: Booking): InvoiceExtra {
  return {
    invoiceNumber: `INV-${b.bookingId.value ?? b.key}`,
    sellerAddress: "",
    sellerEori: "",
    sellerVat: "",
    sellerEmail: "",
    sellerPhone: "",
    buyerName: "",
    buyerAddress: "",
    buyerVat: "",
    incoterms: "",
    reasonForExport: "Sale of goods",
  };
}

/** Fields customs needs on a commercial invoice that the booking doesn't hold. */
export const REQUIRED_EXTRA: { key: keyof InvoiceExtra; label: string }[] = [
  { key: "invoiceNumber", label: "Invoice number" },
  { key: "sellerAddress", label: "Your business address" },
  { key: "sellerEori", label: "Your EORI number" },
  { key: "buyerName", label: "Buyer (consignee) name" },
  { key: "buyerAddress", label: "Buyer (consignee) address" },
  { key: "incoterms", label: "Incoterms" },
  { key: "reasonForExport", label: "Reason for export" },
];

export interface InvoiceLine {
  sku: string;
  description: string;
  hsCode: string;
  origin: string;
  quantity: number;
  unitPrice: string;
  amount: string;
  netKg: string;
}

export interface Invoice {
  number: string;
  date: string;
  seller: { name: string; address: string; eori: string; vat: string; email: string; phone: string };
  buyer: { name: string; address: string; vat: string; country: string };
  lines: InvoiceLine[];
  subtotal: string;
  vat: string;
  total: string;
  currency: "GBP";
  incoterms: string;
  reasonForExport: string;
  shipment: {
    from: string;
    to: string;
    carrier: string | null;
    collection: string | null;
    delivery: string | null;
    pallets: number | null;
    cartons: number | null;
    grossKg: string | null;
    netKg: string | null;
  };
  /** Labels of required fields still empty (shown as placeholders). */
  missing: string[];
}

/** £1,234.50 style: always two decimals on an invoice. */
export function money(v: Decimal | string): string {
  return fmtNum(dec(v), 2);
}

export function buildInvoice(b: Booking, e: Evaluation, extra: InvoiceExtra, today: string): Invoice {
  const lines: InvoiceLine[] = b.items.map((it) => {
    const qty = it.quantity.value ?? 0;
    const price = dec(it.unitPrice.value ?? "0");
    return {
      sku: it.sku.value ?? "",
      description: it.description.value ?? "",
      hsCode: it.hsCode.value ?? "",
      origin: it.countryOfOrigin.value ?? "",
      quantity: qty,
      unitPrice: money(price),
      amount: money(price.times(qty)),
      netKg: fmtNum(dec(it.unitWeightKg.value ?? "0").times(qty), 2),
    };
  });
  const subtotal = sum(b.items.map((it) => dec(it.unitPrice.value ?? "0").times(it.quantity.value ?? 0)));
  const chosen = e.carrier.rows.find((r) => r.id === e.carrier.chosen) ?? null;
  const net = netWeight(b);
  const t = (s: string) => s.trim();
  return {
    number: t(extra.invoiceNumber),
    date: today,
    seller: { name: b.sellerName.value ?? "", address: t(extra.sellerAddress), eori: t(extra.sellerEori), vat: t(extra.sellerVat), email: t(extra.sellerEmail), phone: t(extra.sellerPhone) },
    buyer: { name: t(extra.buyerName), address: t(extra.buyerAddress), vat: t(extra.buyerVat), country: b.destinationCountry.value ?? "" },
    lines,
    subtotal: money(subtotal),
    vat: money("0"),
    total: money(subtotal),
    currency: "GBP",
    incoterms: t(extra.incoterms),
    reasonForExport: t(extra.reasonForExport),
    shipment: {
      from: [b.originCity.value, b.originCountry.value].filter(Boolean).join(", "),
      to: [b.destinationCity.value, b.destinationCountry.value].filter(Boolean).join(", "),
      carrier: chosen ? `${chosen.name}, ${chosen.service}` : null,
      collection: e.dates?.collection ?? null,
      delivery: e.dates?.delivery ?? null,
      pallets: b.pallets.value,
      cartons: b.cartons.value,
      grossKg: b.grossWeightKg.value ? fmtNum(dec(b.grossWeightKg.value), 2) : null,
      netKg: net ? fmtNum(net, 2) : null,
    },
    missing: REQUIRED_EXTRA.filter((f) => !t(extra[f.key])).map((f) => f.label),
  };
}

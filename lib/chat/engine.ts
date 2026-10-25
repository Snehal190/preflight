import type { Booking, FieldValue, Item } from "../types";
import type { AiResult } from "../ai/client";
import { verifiedOperations, type ExtractOperation, type Extraction } from "../ai";
import { countryOfCity, type DestinationCity } from "../reference/allowed";
import { ASSUMPTIONS, EMPTY_PALLET_KG, type AssumptionId } from "../reference/assumptions";
import { Decimal, dec, sum } from "../num";
import { fmtDateField, fmtDateSpoken, fmtGBP, fmtKg, fmtNum } from "../format";
import { itemName } from "../rules/helpers";
import { matchAllowed, parseAmount, type AmountKind, type ListKind } from "./normalize";
import { resolveDate } from "./dates";
import { blank, isGiven, type ChatSession } from "./session";

// The chat engine (spec §12). Deterministic: Gemini's extraction is the only AI input, and every
// value is verified and interpreted here. Replies are built from templates — never by the model.

export interface TurnDeps {
  today: string;
  /** AI HS suggestion for a product (advice only). */
  suggestHs: (description: string) => Promise<{ code: string; reason: string } | null>;
}

export interface TurnResult {
  session: ChatSession;
  reply: string;
  /** True on the turn the seller confirmed the full read-back. */
  justConfirmed: boolean;
}

type FieldKind = { kind: "text" } | { kind: "list"; list: ListKind } | { kind: "amount"; amount: AmountKind } | { kind: "date" } | { kind: "hs" } | { kind: "currency" };

const BOOKING_SPEC: Record<string, { label: string; kind: FieldKind }> = {
  sellerName: { label: "Seller", kind: { kind: "text" } },
  originCity: { label: "From", kind: { kind: "list", list: "originCity" } },
  destinationCity: { label: "To", kind: { kind: "list", list: "destinationCity" } },
  destinationCountry: { label: "Destination country", kind: { kind: "list", list: "destinationCountry" } },
  destinationType: { label: "Destination type", kind: { kind: "list", list: "destinationType" } },
  readyDate: { label: "Ready to ship", kind: { kind: "date" } },
  priority: { label: "Priority", kind: { kind: "list", list: "priority" } },
  pallets: { label: "Pallets", kind: { kind: "amount", amount: "int" } },
  cartons: { label: "Total cartons", kind: { kind: "amount", amount: "int" } },
  declaredValue: { label: "Total declared value", kind: { kind: "amount", amount: "money" } },
  currency: { label: "Currency", kind: { kind: "currency" } },
  grossWeightKg: { label: "Total gross weight", kind: { kind: "amount", amount: "weight" } },
  palletWeightKg: { label: "Empty pallet weight", kind: { kind: "amount", amount: "weight" } },
  appointmentBooked: { label: "Delivery appointment booked", kind: { kind: "list", list: "yesNo" } },
};

const ITEM_SPEC: Record<string, { label: string; kind: FieldKind }> = {
  sku: { label: "SKU", kind: { kind: "text" } },
  description: { label: "description", kind: { kind: "text" } },
  hsCode: { label: "HS code", kind: { kind: "hs" } },
  quantity: { label: "quantity", kind: { kind: "amount", amount: "int" } },
  unitPrice: { label: "unit price", kind: { kind: "amount", amount: "money" } },
  unitsPerCarton: { label: "units per carton", kind: { kind: "amount", amount: "int" } },
  cartons: { label: "cartons", kind: { kind: "amount", amount: "int" } },
  unitWeightKg: { label: "unit weight", kind: { kind: "amount", amount: "weight" } },
  cartonWeightKg: { label: "carton weight", kind: { kind: "amount", amount: "weight" } },
  countryOfOrigin: { label: "country of origin", kind: { kind: "list", list: "countryOfOrigin" } },
};

const ITEM_ONLY = new Set(["sku", "description", "hsCode", "quantity", "unitPrice", "unitsPerCarton", "unitWeightKg", "cartonWeightKg", "countryOfOrigin"]);
const INT_FIELDS = new Set(["pallets", "cartons", "quantity", "unitsPerCarton"]);

const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** Voice read-back: "15" → "15 (one-five)" so fifteen/fifty can't be confused (spec §12.6). */
export function spoken(n: string, voice: boolean): string {
  const shown = /^\d+(\.\d+)?$/.test(n) ? fmtNum(n) : n;
  if (!voice) return shown;
  const digits = n.replace(/[^0-9.]/g, "");
  if (digits.replace(".", "").length < 2) return shown;
  return `${shown} (${digits.split("").map((c) => (c === "." ? "point" : DIGIT_WORDS[Number(c)])).join("-")})`;
}

type Rec = Record<string, FieldValue<unknown>>;
const rec = (x: Booking | Item) => x as unknown as Rec;

function stated(value: unknown, raw: string, messageId: string): FieldValue<unknown> {
  return { value, raw, source: "stated", location: { kind: "chat", messageId } };
}

/** Values the seller gave or confirmed are never overwritten by code (spec §4.2). */
function codeMayWrite(f: FieldValue<unknown>): boolean {
  return !isGiven(f) || f.source === "derived" || f.source === "assumed";
}

function newItem(s: ChatSession, description: string | null, messageId: string): Item {
  s.flags.itemCounter += 1;
  const it: Item = {
    itemId: `c${s.flags.itemCounter}`,
    sku: blank(),
    description: description ? (stated(description, description, messageId) as FieldValue<string>) : blank(),
    hsCode: blank(),
    hsWasNumeric: false,
    quantity: blank(),
    unitPrice: blank(),
    unitsPerCarton: blank(),
    cartons: blank(),
    unitWeightKg: blank(),
    countryOfOrigin: blank(),
  };
  s.booking.items.push(it);
  return it;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type ItemPick = { item: Item } | { create: string | null } | { ambiguous: Item[] };

function pickItem(b: Booking, ref: string | null, op: ExtractOperation["op"]): ItemPick {
  if (op === "add_item") return { create: ref };
  if (!ref) {
    if (b.items.length === 1) return { item: b.items[0] };
    if (b.items.length === 0) return { create: null };
    return { ambiguous: b.items };
  }
  const r = norm(ref);
  const bySku = b.items.filter((it) => it.sku.value && norm(it.sku.value) === r);
  if (bySku.length === 1) return { item: bySku[0] };
  const words = r.split(" ").filter((w) => w.length > 2).map((w) => w.replace(/s$/, ""));
  const byDesc = b.items.filter((it) => {
    const d = norm(it.description.value ?? "");
    return d === r || d.includes(r) || (words.length > 0 && words.every((w) => d.includes(w)));
  });
  if (byDesc.length === 1) return { item: byDesc[0] };
  if (byDesc.length > 1) return { ambiguous: byDesc };
  if (b.items.length === 1 && !b.items[0].description.value) return { item: b.items[0] };
  return { create: ref };
}

interface Notes {
  recorded: string[];
  problems: string[];
  /** Things to ask about besides missing fields (ambiguities, totals that no longer match). */
  asks: string[];
  changed: boolean;
  dateChanged: boolean;
  itemsChanged: boolean;
}

function interpret(kind: FieldKind, op: ExtractOperation, today: string): { ok: true; value: unknown; shown: string; note: string | null } | { ok: false; why: string } {
  const raw = op.value ?? "";
  switch (kind.kind) {
    case "text":
      return raw.trim() ? { ok: true, value: raw.trim(), shown: raw.trim(), note: null } : { ok: false, why: "That was empty." };
    case "list": {
      const m = matchAllowed(kind.list, raw);
      if (!m.ok) return { ok: false, why: `"${raw}" isn't an option I can use.` };
      const note = m.how === "synonym" ? `from "${raw}"` : m.how === "fuzzy" ? `I read "${raw}" as ${m.value} — tell me if that's wrong` : null;
      return { ok: true, value: m.value, shown: m.value, note };
    }
    case "amount": {
      const a = parseAmount(raw, op.unit, kind.amount);
      if (!a.ok) return { ok: false, why: a.why };
      const value = kind.amount === "int" ? Number(a.value) : a.value;
      const shown = kind.amount === "money" ? fmtGBP(a.value) : kind.amount === "weight" ? fmtKg(dec(a.value).toDecimalPlaces(3)) : fmtNum(a.value);
      return { ok: true, value, shown, note: a.note };
    }
    case "date": {
      const iso = resolveDate(raw, today);
      if (!iso) return { ok: false, why: `I couldn't work out the date from "${raw}". Please give it as DD-MM-YYYY.` };
      return { ok: true, value: iso, shown: fmtDateSpoken(iso), note: null };
    }
    case "hs": {
      const digits = raw.replace(/[\s.\-]/g, "");
      if (!/^\d+$/.test(digits)) return { ok: false, why: `"${raw}" doesn't look like an HS code (digits only).` };
      return { ok: true, value: digits, shown: digits, note: null };
    }
    case "currency":
      return { ok: false, why: "currency" };
  }
}

function listOptions(list: ListKind): string {
  const opts: Record<ListKind, string> = {
    originCity: "I can only book from London, Manchester, Birmingham or Leeds.",
    destinationCity: "I can only deliver to Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam.",
    destinationCountry: "I can only deliver to Germany, France or the Netherlands.",
    destinationType: "Is it a warehouse or a business address?",
    priority: "Please choose cheapest, fastest, most reliable or balanced.",
    yesNo: "Please answer yes or no.",
    countryOfOrigin: "I can accept United Kingdom, China, India, Vietnam, Turkey or Germany as the country of origin.",
  };
  return opts[list];
}

async function applyOp(s: ChatSession, opIn: ExtractOperation, messageId: string, deps: TurnDeps, voice: boolean, notes: Notes): Promise<void> {
  let op = opIn;
  const b = s.booking;
  const field = op.field;
  const isItem = op.op === "add_item" || op.op === "remove_item" || op.itemRef !== null || (field !== null && ITEM_ONLY.has(field));

  if (op.op === "remove_item") {
    const p = pickItem(b, op.itemRef, op.op);
    if ("item" in p) {
      b.items = b.items.filter((x) => x !== p.item);
      notes.recorded.push(`Removed ${itemName(p.item)}${p.item.description.value ? ` (${p.item.description.value})` : ""}.`);
      notes.changed = notes.itemsChanged = true;
    } else if ("ambiguous" in p) {
      notes.asks.push(`Which product should I remove: ${p.ambiguous.map((x) => x.description.value ?? itemName(x)).join(" or ")}?`);
    } else {
      notes.problems.push(`I couldn't find "${op.itemRef}" in this booking.`);
    }
    return;
  }

  if (!isItem) {
    if (!field || !(field in BOOKING_SPEC)) return;
    const spec = BOOKING_SPEC[field];
    if (op.op === "unknown") {
      if (field === "grossWeightKg") s.flags.grossUnknown = true;
      else if (field === "palletWeightKg") s.flags.palletWeightUnknown = true;
      else if (!s.flags.declined.includes(field)) s.flags.declined.push(field);
      notes.changed = true;
      return;
    }
    if (spec.kind.kind === "currency") {
      if (/^(gbp|£|pounds?|sterling|british pounds?)$/i.test((op.value ?? "").trim())) return;
      notes.problems.push("Please give the value in GBP.");
      return;
    }
    if (op.op === "increment" || op.op === "decrement") {
      const cur = rec(b)[field];
      if (!INT_FIELDS.has(field) || typeof cur.value !== "number") {
        notes.problems.push(`I can't ${op.op === "increment" ? "add to" : "take from"} ${spec.label.toLowerCase()} — it isn't set yet. What should it be?`);
        return;
      }
      const by = parseAmount(op.value ?? "1", null, "int");
      if (!by.ok) return void notes.problems.push(by.why);
      const next = cur.value + (op.op === "increment" ? 1 : -1) * Number(by.value);
      if (next <= 0) return void notes.problems.push(`${spec.label} can't go to ${next}.`);
      rec(b)[field] = stated(next, `${op.quote}`, messageId);
      notes.recorded.push(`${spec.label}: ${spoken(String(cur.value), voice)} → ${spoken(String(next), voice)}`);
      notes.changed = true;
      return;
    }
    const v = interpret(spec.kind, op, deps.today);
    if (!v.ok) {
      notes.problems.push(spec.kind.kind === "list" ? `${v.why} ${listOptions(spec.kind.list)}` : v.why);
      return;
    }
    if (field === "palletWeightKg") {
      s.flags.palletWeightKg = String(v.value);
      notes.recorded.push(`Empty pallet weight: ${v.shown}${v.note ? ` (${v.note})` : ""}`);
      notes.changed = true;
      return;
    }
    rec(b)[field] = stated(v.value, op.value ?? "", messageId);
    if (field === "grossWeightKg") s.flags.grossUnknown = false;
    s.flags.declined = s.flags.declined.filter((d) => d !== field);
    notes.changed = true;
    if (field === "readyDate") {
      notes.dateChanged = true;
      const past = String(v.value) < deps.today;
      notes.recorded.push(`Ready to ship: ${v.shown}${past ? " — that date is in the past" : ""}`);
      return;
    }
    const numeric = spec.kind.kind === "amount" ? spoken(String(v.value), voice) : v.shown;
    const shown = spec.kind.kind === "amount" && spec.kind.amount !== "int" ? v.shown : numeric;
    notes.recorded.push(`${spec.label}: ${shown}${v.note ? ` (${v.note})` : ""}`);
    return;
  }

  // Item operations.
  const pick = pickItem(b, op.itemRef, op.op);
  if ("ambiguous" in pick) {
    notes.asks.push(`You said "${op.quote}" — which product is that for: ${pick.ambiguous.map((x) => x.description.value ?? itemName(x)).join(" or ")}?`);
    return;
  }
  let it: Item;
  if ("create" in pick) {
    const desc = op.op === "add_item" ? (op.itemRef ?? (field === "description" ? op.value : null)) : pick.create;
    it = newItem(s, desc, messageId);
    notes.recorded.push(`Added a product${desc ? `: ${desc}` : ""}.`);
    notes.changed = notes.itemsChanged = true;
    if (op.op === "add_item" && (!field || field === "description")) return;
  } else {
    it = pick.item;
  }
  if (!field || !(field in ITEM_SPEC)) return;
  const spec = ITEM_SPEC[field];
  const name = it.description.value ?? itemName(it);
  const key = `${field}:${it.itemId}`;

  // "No SKU" is an answer, not a SKU. Don't replace one we just generated either.
  if (field === "sku" && op.op === "set" && /^(no|none|nope|n\/?a|nil|-+|no sku|not? (one|any)|don'?t have( one| any)?)$/i.test((op.value ?? "").trim())) {
    if (it.sku.assumptionId === "A4") return;
    op = { ...op, op: "unknown" };
  }

  if (op.op === "unknown") {
    notes.changed = true;
    if (field === "sku") {
      s.flags.generatedSkus += 1;
      const sku = `ITEM-${s.flags.generatedSkus}`;
      it.sku = { value: sku, raw: null, source: "assumed", location: null, assumptionId: "A4", formula: "no SKU given" };
      notes.recorded.push(`**ASSUMPTION:** no SKU given, using ${sku} for ${name}.`);
      return;
    }
    if (field === "hsCode") {
      const sug = await deps.suggestHs(name);
      if (sug) {
        s.flags.pendingHs = { itemId: it.itemId, code: sug.code, reason: sug.reason };
      } else {
        if (!s.flags.declined.includes(key)) s.flags.declined.push(key);
        notes.recorded.push(`No HS code for ${name} — it will show as R-01 (Red) until you add one.`);
      }
      return;
    }
    if (!s.flags.declined.includes(key)) s.flags.declined.push(key);
    if (field === "countryOfOrigin") notes.recorded.push(`No country of origin for ${name} — it will show as R-09 (Amber).`);
    return;
  }

  if (op.op === "increment" || op.op === "decrement") {
    const cur = rec(it)[field];
    if (!INT_FIELDS.has(field) || typeof cur.value !== "number") {
      notes.problems.push(`I can't change ${name} ${spec.label} — it isn't set yet. What should it be?`);
      return;
    }
    const by = parseAmount(op.value ?? "1", null, "int");
    if (!by.ok) return void notes.problems.push(by.why);
    const next = cur.value + (op.op === "increment" ? 1 : -1) * Number(by.value);
    if (next <= 0) return void notes.problems.push(`${name} ${spec.label} can't go to ${next}.`);
    rec(it)[field] = stated(next, op.quote, messageId);
    notes.recorded.push(`${name} ${spec.label}: ${spoken(String(cur.value), voice)} → ${spoken(String(next), voice)}`);
    notes.changed = notes.itemsChanged = true;
    return;
  }

  const v = interpret(spec.kind, op, deps.today);
  if (!v.ok) {
    notes.problems.push(spec.kind.kind === "list" ? `${v.why} ${listOptions(spec.kind.list)}` : v.why);
    return;
  }
  if (field === "cartonWeightKg") {
    s.flags.cartonWeights[it.itemId] = String(v.value);
    notes.recorded.push(`${name} carton weight: ${v.shown}${v.note ? ` (${v.note})` : ""}`);
    notes.changed = notes.itemsChanged = true;
    return;
  }
  rec(it)[field] = stated(v.value, op.value ?? "", messageId);
  if (field === "hsCode") it.hsWasNumeric = false;
  s.flags.declined = s.flags.declined.filter((d) => d !== key);
  notes.changed = notes.itemsChanged = true;
  const shown = spec.kind.kind === "amount" && spec.kind.amount === "int" ? spoken(String(v.value), voice) : v.shown;
  notes.recorded.push(`${field === "description" ? "Product" : `${name} ${spec.label}`}: ${shown}${v.note ? ` (${v.note})` : ""}`);
}

// --- Derivations (spec §12.5): only "derived"/"assumed" values are ever recomputed.

function setDerived(target: Rec, field: string, value: unknown, formula: string, assumptionId?: AssumptionId): boolean {
  const cur = target[field];
  if (!codeMayWrite(cur)) return false;
  const next: FieldValue<unknown> = {
    value,
    raw: null,
    source: assumptionId ? "assumed" : "derived",
    location: null,
    formula,
    ...(assumptionId ? { assumptionId } : {}),
  };
  const changed = cur.value !== value || cur.formula !== formula;
  target[field] = next;
  return changed;
}

function clearDerived(target: Rec, field: string): void {
  const cur = target[field];
  if (isGiven(cur) && (cur.source === "derived" || cur.source === "assumed")) target[field] = blank();
}

export function derive(s: ChatSession): string[] {
  const b = s.booking;
  const out: string[] = [];
  const note = (changed: boolean, text: string) => changed && out.push(text);

  // Destination country from the city (every allowed city is in exactly one country).
  if (b.destinationCity.value) {
    const c = countryOfCity(b.destinationCity.value as DestinationCity);
    note(setDerived(rec(b), "destinationCountry", c, `${b.destinationCity.value} is in ${c}`), `Destination country: ${c} (from the city).`);
  }

  for (const it of b.items) {
    const r = rec(it);
    const name = it.description.value ?? itemName(it);
    const given = (f: string) => isGiven(r[f]) && r[f].source !== "derived" && r[f].value !== null;
    const q = it.quantity.value;
    const u = it.unitsPerCarton.value;
    const c = it.cartons.value;
    const g = ["quantity", "unitsPerCarton", "cartons"].filter(given);
    if (g.length === 2) {
      if (!g.includes("quantity") && u !== null && c !== null) {
        note(setDerived(r, "quantity", u * c, `${fmtNum(u)} per carton × ${fmtNum(c)} cartons`), `I worked out ${name} quantity = ${fmtNum(u)} × ${fmtNum(c)} = ${fmtNum(u * c)}.`);
      } else if (!g.includes("cartons") && q !== null && u !== null) {
        if (q % u === 0) note(setDerived(r, "cartons", q / u, `${fmtNum(q)} units ÷ ${fmtNum(u)} per carton`), `I worked out ${name} cartons = ${fmtNum(q)} ÷ ${fmtNum(u)} = ${fmtNum(q / u)}.`);
        else clearDerived(r, "cartons");
      } else if (!g.includes("unitsPerCarton") && q !== null && c !== null) {
        if (q % c === 0) note(setDerived(r, "unitsPerCarton", q / c, `${fmtNum(q)} units ÷ ${fmtNum(c)} cartons`), `I worked out ${name} units per carton = ${fmtNum(q)} ÷ ${fmtNum(c)} = ${fmtNum(q / c)}.`);
        else clearDerived(r, "unitsPerCarton");
      }
    } else if (g.length < 2) {
      for (const f of ["quantity", "unitsPerCarton", "cartons"]) if (!given(f)) clearDerived(r, f);
    }

    const cw = s.flags.cartonWeights[it.itemId];
    if (cw && it.unitsPerCarton.value) {
      const unit = dec(cw).div(it.unitsPerCarton.value);
      note(
        setDerived(r, "unitWeightKg", unit.toFixed(), `${fmtKg(cw)} per carton ÷ ${fmtNum(it.unitsPerCarton.value)} units`, "A6"),
        `**ASSUMPTION:** ${name} unit weight = ${fmtKg(cw)} ÷ ${fmtNum(it.unitsPerCarton.value)} = ${fmtKg(unit.toDecimalPlaces(3))} — ${ASSUMPTIONS.A6.label}. Please confirm.`,
      );
    }
  }

  const items = b.items;
  if (items.length && items.every((it) => it.cartons.value !== null)) {
    const total = items.reduce((n, it) => n + (it.cartons.value ?? 0), 0);
    note(setDerived(rec(b), "cartons", total, items.map((it) => fmtNum(it.cartons.value!)).join(" + ")), `Total cartons: ${fmtNum(total)} (added up from the products).`);
  }
  if (items.length && items.every((it) => it.quantity.value !== null && it.unitPrice.value !== null)) {
    const total = sum(items.map((it) => dec(it.quantity.value!).times(it.unitPrice.value!)));
    note(
      setDerived(rec(b), "declaredValue", total.toFixed(), items.map((it) => `${fmtNum(it.quantity.value!)} × ${fmtGBP(it.unitPrice.value!)}`).join(" + ")),
      `Total declared value: ${fmtGBP(total)} (quantity × unit price for each product).`,
    );
  }

  // Gross weight can't be derived — only estimated after the seller says they don't know it.
  const net = items.length && items.every((it) => it.unitWeightKg.value !== null && it.quantity.value !== null) ? sum(items.map((it) => dec(it.unitWeightKg.value!).times(it.quantity.value!))) : null;
  if (s.flags.grossUnknown && net && b.pallets.value) {
    const p = b.pallets.value;
    if (s.flags.palletWeightKg) {
      const est = net.plus(dec(s.flags.palletWeightKg).times(p));
      note(
        setDerived(rec(b), "grossWeightKg", est.toFixed(), `${fmtKg(net)} of products + ${p} pallets × ${fmtKg(s.flags.palletWeightKg)}`),
        `Estimated gross weight ${fmtKg(est)} = ${fmtKg(net)} of products + ${p} pallets × ${fmtKg(s.flags.palletWeightKg)}. Carton packaging is not included. Please confirm or give the real weight.`,
      );
    } else if (s.flags.palletWeightUnknown) {
      const est = net.plus(dec(EMPTY_PALLET_KG).times(p));
      note(
        setDerived(rec(b), "grossWeightKg", est.toFixed(), `${fmtKg(net)} of products + ${p} pallets × ${EMPTY_PALLET_KG} kg`, "A1"),
        `**ASSUMPTION:** estimated gross weight ${fmtKg(est)} = ${fmtKg(net)} of products + ${p} pallets × ${EMPTY_PALLET_KG} kg (standard UK empty pallet). Carton packaging is not included. Please confirm or give the real weight.`,
      );
    }
  }

  // Business address → no appointment needed (A7). Warehouse → it must be asked.
  if (b.destinationType.value === "Business address") {
    setDerived(rec(b), "appointmentBooked", "No", "business address — appointments are for warehouses only", "A7");
  } else if (b.destinationType.value === "Warehouse" && b.appointmentBooked.assumptionId === "A7") {
    b.appointmentBooked = blank();
  }
  return out;
}

// --- Questions (spec §12.4): only what's missing, grouped, max 3, in a fixed order.

interface Question {
  key: string;
  text: string;
}

export function missingQuestions(s: ChatSession): Question[] {
  const b = s.booking;
  const q: Question[] = [];
  const declined = (k: string) => s.flags.declined.includes(k);
  const ask = (key: string, text: string, isMissing: boolean) => isMissing && !declined(key) && q.push({ key, text });
  const missing = (f: FieldValue<unknown>) => f.value === null;

  // 1 route
  ask("originCity", "Which UK city is it collected from — London, Manchester, Birmingham or Leeds?", missing(b.originCity));
  ask("destinationCity", "Where is it going — Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam?", missing(b.destinationCity));
  // 2 items
  if (b.items.length === 0) ask("items", "What are you shipping? A short description of each product, with how many units and the price per unit.", true);
  for (const it of b.items) {
    const n = it.description.value ?? itemName(it);
    ask(`description:${it.itemId}`, `What is the product ${itemName(it)}?`, missing(it.description));
    ask(`quantity:${it.itemId}`, `How many units of ${n}?`, missing(it.quantity) && !(it.unitsPerCarton.value && it.cartons.value));
    ask(`unitPrice:${it.itemId}`, `What's the price per unit of ${n}, in GBP?`, missing(it.unitPrice));
  }
  // 3 packing
  for (const it of b.items) {
    const n = it.description.value ?? itemName(it);
    const known = [it.quantity.value, it.unitsPerCarton.value, it.cartons.value].filter((v) => v !== null).length;
    ask(`unitsPerCarton:${it.itemId}`, `How many units of ${n} go in each carton?`, missing(it.unitsPerCarton) && known < 2);
    ask(`cartons:${it.itemId}`, `How many cartons of ${n}?`, missing(it.cartons) && (known < 2 || (it.quantity.value !== null && it.unitsPerCarton.value !== null && it.quantity.value % it.unitsPerCarton.value !== 0)));
  }
  ask("pallets", "How many pallets?", missing(b.pallets));
  // 4 weights
  for (const it of b.items) {
    const n = it.description.value ?? itemName(it);
    ask(`unitWeightKg:${it.itemId}`, `How much does one unit of ${n} weigh, in kg? (A carton weight works too.)`, missing(it.unitWeightKg) && !s.flags.cartonWeights[it.itemId]);
  }
  if (missing(b.grossWeightKg)) {
    if (!s.flags.grossUnknown) ask("grossWeightKg", "What's the total gross weight in kg — products, cartons and pallets together?", true);
    else if (!s.flags.palletWeightKg && !s.flags.palletWeightUnknown) ask("palletWeightKg", "No problem. What does an empty pallet weigh?", true);
  }
  // 5 HS code, origin, SKU
  for (const it of b.items) {
    const n = it.description.value ?? itemName(it);
    if (s.flags.pendingHs?.itemId !== it.itemId) ask(`hsCode:${it.itemId}`, `What's the HS code for ${n}? If you don't know, say so and I can suggest one.`, missing(it.hsCode));
    ask(`countryOfOrigin:${it.itemId}`, `Where was ${n} made? (The country of origin — not where it ships from.)`, missing(it.countryOfOrigin));
    ask(`sku:${it.itemId}`, `Does ${n} have a SKU?`, missing(it.sku) && !s.flags.skuAsked.includes(it.itemId));
  }
  // 6–9
  ask("readyDate", "When will it be ready to ship?", missing(b.readyDate));
  ask("priority", "What matters most: cheapest, fastest, most reliable, or balanced?", missing(b.priority));
  ask("destinationType", "Is it going to a warehouse or a business address?", missing(b.destinationType));
  if (b.destinationType.value === "Warehouse") ask("appointmentBooked", "Have you booked a delivery appointment with the warehouse?", missing(b.appointmentBooked));
  ask("sellerName", "Finally, what's the seller (company) name?", missing(b.sellerName));
  return q;
}

// --- Read-back (spec §12.6).

function show(f: FieldValue<unknown>, fmt: (v: unknown) => string = String): string {
  if (f.value === null) return "— (missing)";
  const v = fmt(f.value);
  if (f.source === "assumed" && f.assumptionId) return `${v} **(ASSUMPTION: ${ASSUMPTIONS[f.assumptionId as AssumptionId].label})**`;
  if (f.source === "derived" && f.formula) return `${v} (worked out: ${f.formula})`;
  return v;
}

export function readBack(s: ChatSession, voice: boolean): string {
  const b = s.booking;
  const n = (v: unknown) => spoken(String(v), voice);
  const lines = [
    "Here's the full booking — please check every line:",
    `• Seller: ${show(b.sellerName)}`,
    `• Route: ${show(b.originCity)}, United Kingdom → ${show(b.destinationCity)}, ${show(b.destinationCountry)}`,
    `• Destination type: ${show(b.destinationType)}${b.destinationType.value === "Warehouse" ? ` · appointment booked: ${show(b.appointmentBooked)}` : ""}`,
    `• Ready to ship: ${show(b.readyDate, (v) => fmtDateSpoken(String(v)))}`,
    `• Priority: ${show(b.priority)}`,
    `• Pallets: ${show(b.pallets, n)} · total cartons: ${show(b.cartons, n)}`,
    `• Total declared value: ${show(b.declaredValue, (v) => fmtGBP(String(v)))} (GBP)`,
    `• Total gross weight: ${show(b.grossWeightKg, (v) => fmtKg(dec(String(v)).toDecimalPlaces(3)))}`,
  ];
  for (const it of b.items) {
    lines.push(
      `• ${show(it.sku)} — ${show(it.description)}: ${show(it.quantity, n)} units × ${show(it.unitPrice, (v) => fmtGBP(String(v)))}, ${show(it.unitsPerCarton, n)} per carton, ${show(it.cartons, n)} cartons, ${show(it.unitWeightKg, (v) => fmtKg(String(v)))} each, HS ${show(it.hsCode)}, made in ${show(it.countryOfOrigin)}`,
    );
  }
  lines.push("Is everything correct? Reply **yes** to confirm, or tell me what to change.");
  return lines.join("\n");
}

function confirmAll(s: ChatSession): void {
  const promote = (r: Rec) => {
    for (const k of Object.keys(r)) {
      const f = r[k];
      if (f && typeof f === "object" && "source" in f && (f.source === "derived" || f.source === "assumed") && f.value !== null && k !== "originCountry" && k !== "currency" && k !== "bookingId" && f.assumptionId !== "A7") {
        r[k] = { ...f, source: "confirmed" };
      }
    }
  };
  promote(rec(s.booking));
  for (const it of s.booking.items) promote(rec(it));
  s.flags.readbackConfirmed = true;
  s.flags.dateConfirmed = true;
}

type YesNoKind = "readback" | "hs" | "date" | "sku";

/** The yes/no questions that were in the last bot message, in the order they were asked. */
function pendingYesNo(s: ChatSession, asked: string): { kind: YesNoKind; item?: Item }[] {
  const out: { kind: YesNoKind; item?: Item; at: number }[] = [];
  if (s.flags.readbackShown && !s.flags.readbackConfirmed && asked === READBACK_QUESTION) out.push({ kind: "readback", at: 0 });
  if (s.flags.pendingHs && asked.includes("Shall I use it?")) out.push({ kind: "hs", at: asked.indexOf("Shall I use it?") });
  if (s.booking.readyDate.value && !s.flags.dateConfirmed && asked.includes("Ready to ship") && asked.includes("— correct?")) out.push({ kind: "date", at: asked.indexOf("Ready to ship") });
  for (const it of s.booking.items) {
    const q = `Does ${it.description.value ?? itemName(it)} have a SKU?`;
    if (it.sku.value === null && asked.includes(q)) out.push({ kind: "sku", item: it, at: asked.indexOf(q) });
  }
  return out.sort((a, b) => a.at - b.at);
}

const READBACK_QUESTION = "Is everything in the read-back correct?";
const AFFIRM = /^(yes|yep|yeah|yup|y|correct|that'?s (right|correct)|right|confirm(ed)?|ok(ay)?|sure|all good|looks good|go ahead|use it)\b/i;
const NEGATE = /^(no|nope|nah|n|wrong|incorrect|not right|don'?t)\b/i;

export async function handleTurn(prev: ChatSession, text: string, transcript: boolean, extraction: AiResult<Extraction>, deps: TurnDeps): Promise<TurnResult> {
  const s: ChatSession = structuredClone(prev);
  const at = new Date().toISOString();
  const messageId = `m${s.messages.length + 1}`;
  s.messages.push({ id: messageId, role: "user", text, transcript, at });
  const say = (reply: string, justConfirmed = false): TurnResult => {
    s.messages.push({ id: `m${s.messages.length + 1}`, role: "assistant", text: reply, transcript: false, at: new Date().toISOString() });
    return { session: s, reply, justConfirmed };
  };

  if (!extraction.ok) {
    s.aiUnavailable = true;
    return say("The assistant is unavailable right now — you can fill in the booking form instead. Nothing you've told me is lost.");
  }
  s.aiUnavailable = false;
  const ex = extraction.data;
  const short = text.trim().length <= 60;
  const hasOps = ex.operations.length > 0;

  // Yes/no answers go to the yes/no question we actually asked last (never guessed from flags).
  // With other details in the same message ("yes, use it — made in China"), the yes/no applies
  // only when exactly one yes/no question was pending.
  const asked = s.lastQuestion ?? "";
  const trimmed = text.trim();
  const yesNo = AFFIRM.test(trimmed) ? "yes" : NEGATE.test(trimmed) ? "no" : null;
  const pending = pendingYesNo(s, asked);
  const yesNoNotes: string[] = [];
  if (yesNo && (hasOps ? pending.length === 1 && pending[0].kind !== "readback" : short && pending.length >= 1)) {
    const q = pending[0];
    const yes = yesNo === "yes";
    if (q.kind === "readback") {
      if (yes) {
        confirmAll(s);
        return say("Thanks — everything's confirmed.", true);
      }
      s.lastQuestion = "What would you like to change?";
      return say("What would you like to change?");
    }
    if (q.kind === "hs") {
      const p = s.flags.pendingHs!;
      s.flags.pendingHs = null;
      const it = s.booking.items.find((x) => x.itemId === p.itemId);
      if (it && yes) {
        it.hsCode = { value: p.code, raw: p.code, source: "confirmed", location: { kind: "chat", messageId }, formula: "AI suggestion you confirmed" };
        s.flags.readbackConfirmed = false;
        s.flags.readbackShown = false;
      } else if (it && !s.flags.declined.includes(`hsCode:${it.itemId}`)) {
        s.flags.declined.push(`hsCode:${it.itemId}`);
      }
      yesNoNotes.push(yes ? `OK — HS code ${p.code} recorded for ${it?.description.value ?? "that product"} (you confirmed it; you're responsible for it).` : "OK — no HS code for now. R-01 will stay Red until you add one.");
    } else if (q.kind === "date") {
      if (yes) {
        s.flags.dateConfirmed = true;
        yesNoNotes.push(`Great — ready to ship ${fmtDateSpoken(s.booking.readyDate.value!)}.`);
      } else {
        s.booking.readyDate = blank();
        if (!hasOps) {
          s.lastQuestion = "When will it be ready to ship?";
          return say("OK — when will it be ready to ship? (DD-MM-YYYY is safest.)");
        }
      }
    } else if (q.kind === "sku") {
      const skuItem = q.item!;
      if (!s.flags.skuAsked.includes(skuItem.itemId)) s.flags.skuAsked.push(skuItem.itemId);
      if (yes && !hasOps) {
        s.lastQuestion = `What's the SKU for ${skuItem.description.value ?? itemName(skuItem)}?`;
        return say(s.lastQuestion);
      }
      if (!yes) {
        s.flags.generatedSkus += 1;
        const sku = `ITEM-${s.flags.generatedSkus}`;
        skuItem.sku = { value: sku, raw: null, source: "assumed", location: null, assumptionId: "A4", formula: "no SKU given" };
        s.flags.readbackShown = false;
        s.flags.readbackConfirmed = false;
        yesNoNotes.push(`**ASSUMPTION:** no SKU given, using ${sku}.`);
      }
    }
    if (!hasOps) return say(nextStep(s, yesNoNotes, transcript));
  }

  if (ex.newShipment) {
    return say("It sounds like you're describing a second shipment. Each chat holds one booking — press **Start a new booking** for the other one. I haven't changed this booking.");
  }

  // SKU question was asked: remember so it's asked only once.
  for (const it of s.booking.items) if (s.lastQuestion?.includes(`Does ${it.description.value ?? itemName(it)} have a SKU?`) && !s.flags.skuAsked.includes(it.itemId)) s.flags.skuAsked.push(it.itemId);

  const { kept, discarded } = verifiedOperations(text, ex);
  const notes: Notes = { recorded: [], problems: [], asks: [], changed: false, dateChanged: false, itemsChanged: false };
  const before = { cartons: s.booking.cartons, declared: s.booking.declaredValue };
  for (const op of kept) await applyOp(s, op, messageId, deps, transcript, notes);
  for (const a of ex.ambiguities) notes.asks.push(`You said "${a.quote}" — ${a.about}. Which detail is that?`);
  const derivedNotes = derive(s);

  // Discarded values (quote not in the message) are only worth mentioning if still missing.
  const stillMissing = (o: ExtractOperation): boolean => {
    if (!o.field) return false;
    if (o.itemRef === null && o.field in BOOKING_SPEC && !ITEM_ONLY.has(o.field)) return rec(s.booking)[o.field]?.value === null;
    const p = pickItem(s.booking, o.itemRef, "set");
    return "item" in p ? rec(p.item)[o.field]?.value === null : true;
  };
  if (discarded.some(stillMissing)) notes.problems.push("I couldn't match part of your message to exact words, so I've left those details out — I'll ask for them.");

  // A stated total stays as stated when products change; flag the difference (spec §12.7).
  if (notes.itemsChanged) {
    const b = s.booking;
    const itemCartons = b.items.every((it) => it.cartons.value !== null) ? b.items.reduce((n, it) => n + (it.cartons.value ?? 0), 0) : null;
    if (!codeMayWrite(b.cartons) && before.cartons === b.cartons && b.cartons.value !== null && itemCartons !== null && itemCartons !== b.cartons.value) {
      notes.asks.push(`You said ${fmtNum(b.cartons.value as number)} cartons total; the products now add up to ${fmtNum(itemCartons)}. Update the total to ${fmtNum(itemCartons)}?`);
    }
    const itemValue = b.items.every((it) => it.quantity.value !== null && it.unitPrice.value !== null) ? sum(b.items.map((it) => dec(it.quantity.value!).times(it.unitPrice.value!))) : null;
    if (!codeMayWrite(b.declaredValue) && before.declared === b.declaredValue && b.declaredValue.value !== null && itemValue !== null && !itemValue.eq(String(b.declaredValue.value))) {
      notes.asks.push(`You said the total declared value is ${fmtGBP(String(b.declaredValue.value))}; the products now add up to ${fmtGBP(itemValue)}. Update it to ${fmtGBP(itemValue)}?`);
    }
  }

  if (notes.changed) {
    s.flags.readbackShown = false;
    s.flags.readbackConfirmed = false;
  }
  if (notes.dateChanged) s.flags.dateConfirmed = false;

  const head: string[] = [...yesNoNotes];
  if (notes.recorded.length) head.push(`Got it:\n${notes.recorded.map((r) => `• ${r}`).join("\n")}`);
  if (derivedNotes.length) head.push(derivedNotes.map((d) => `• ${d}`).join("\n"));
  head.push(...notes.problems);
  if (!head.length && !notes.recorded.length && !notes.problems.length && !derivedNotes.length && !notes.asks.length && !s.flags.pendingHs) {
    head.push("I didn't catch any booking details in that.");
  }
  return say(nextStep(s, head, transcript, notes.asks, notes.dateChanged));
}

/** Questions for this turn (max 3), or the read-back when nothing is missing. */
function nextStep(s: ChatSession, head: string[], voice: boolean, asks: string[] = [], dateJustSet = false): string {
  const questions: string[] = [...asks];
  if (s.flags.pendingHs) {
    const it = s.booking.items.find((x) => x.itemId === s.flags.pendingHs!.itemId);
    questions.push(
      `**Suggestion — please verify; you are legally responsible for the code:** HS ${s.flags.pendingHs.code} for ${it?.description.value ?? "that product"} (${s.flags.pendingHs.reason}). Shall I use it?`,
    );
  }
  if (dateJustSet && s.booking.readyDate.value && !s.flags.dateConfirmed) {
    questions.unshift(`Ready to ship ${fmtDateSpoken(s.booking.readyDate.value)} (${fmtDateField(s.booking.readyDate.value)}) — correct?`);
  }
  for (const m of missingQuestions(s)) {
    if (questions.length >= 3) break;
    questions.push(m.text);
  }
  const parts = [...head];
  if (questions.length) {
    parts.push(questions.slice(0, 3).map((q, i) => (questions.length > 1 ? `${i + 1}. ${q}` : q)).join("\n"));
    s.lastQuestion = questions.slice(0, 3).join(" ");
  } else if (!s.flags.readbackConfirmed) {
    parts.push(readBack(s, voice));
    s.flags.readbackShown = true;
    s.lastQuestion = READBACK_QUESTION;
  } else {
    parts.push("Everything is confirmed.");
    s.lastQuestion = null;
  }
  return parts.join("\n\n");
}

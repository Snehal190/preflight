import { describe, expect, it } from "vitest";
import { handleTurn, missingQuestions, spoken, type TurnDeps } from "@/lib/chat/engine";
import { newChatSession, type ChatSession } from "@/lib/chat/session";
import { matchAllowed, parseAmount } from "@/lib/chat/normalize";
import { resolveDate } from "@/lib/chat/dates";
import type { ExtractOperation } from "@/lib/ai";
import { runChecks } from "@/lib/rules";
import { changeChips } from "@/lib/booking/changes";
import { evaluateBooking } from "@/lib/booking/evaluate";
import { emptyState } from "@/lib/booking/state";

// Gemini is mocked: each test hands the engine the extraction directly.
const TODAY = "2026-10-25"; // a Sunday
const deps: TurnDeps = { today: TODAY, suggestHs: async () => ({ code: "691200", reason: "ceramic tableware" }) };

function op(field: ExtractOperation["field"], value: string | null, quote: string, extra: Partial<ExtractOperation> = {}): ExtractOperation {
  return { op: "set", field, itemRef: null, value, unit: null, quote, ...extra };
}
const ok = (operations: ExtractOperation[], extra: { newShipment?: boolean; ambiguities?: { about: string; quote: string }[] } = {}) =>
  ({ ok: true as const, data: { operations, ambiguities: extra.ambiguities ?? [], newShipment: extra.newShipment ?? false } });

async function turn(s: ChatSession, text: string, ops: ExtractOperation[], extra = {}) {
  return handleTurn(s, text, false, ok(ops, extra), deps);
}

const questionsIn = (reply: string) => reply.split("\n").filter((l) => /^\d\. /.test(l) || l.trim().endsWith("?"));

/** A complete BK-001-like conversation, in a few turns. */
async function fullBooking(): Promise<ChatSession> {
  let s = newChatSession("abc123");
  const m1 = "Sending 1,080 ceramic mugs from Manchester to Frankfurt, £5 each, 12 per box, 3 pallets";
  s = (
    await turn(s, m1, [
      op("originCity", "Manchester", "from Manchester"),
      op("destinationCity", "Frankfurt", "to Frankfurt"),
      op("description", "ceramic mugs", "ceramic mugs", { op: "add_item", itemRef: "ceramic mugs" }),
      op("quantity", "1,080", "1,080 ceramic mugs", { itemRef: "ceramic mugs" }),
      op("unitPrice", "£5", "£5 each", { itemRef: "ceramic mugs" }),
      op("unitsPerCarton", "12", "12 per box", { itemRef: "ceramic mugs" }),
      op("pallets", "3", "3 pallets"),
    ])
  ).session;
  const m2 = "each mug is 0.5 kg, gross 620 kg, HS 691200, made in the UK";
  s = (
    await turn(s, m2, [
      op("unitWeightKg", "0.5", "0.5 kg", { itemRef: "mug", unit: "kg" }),
      op("grossWeightKg", "620", "gross 620 kg", { unit: "kg" }),
      op("hsCode", "691200", "HS 691200", { itemRef: "mug" }),
      op("countryOfOrigin", "UK", "made in the UK", { itemRef: "mug" }),
    ])
  ).session;
  s = (await turn(s, "SKU is MUG-01, ready 05-11-2026", [op("sku", "MUG-01", "SKU is MUG-01", { itemRef: "mug" }), op("readyDate", "05-11-2026", "ready 05-11-2026")])).session;
  s = (await turn(s, "yes", [])).session; // confirms the date read-back
  s = (await turn(s, "cheapest please, it's going to an Amazon warehouse, slot booked", [op("priority", "cheapest", "cheapest"), op("destinationType", "Amazon warehouse", "Amazon warehouse"), op("appointmentBooked", "yes", "slot booked")])).session;
  return s;
}

describe("interpreting values in code", () => {
  it("fuzzy-matches misspellings but never guesses a different city", () => {
    expect(matchAllowed("destinationCity", "Frankfrut")).toMatchObject({ ok: true, value: "Frankfurt", how: "fuzzy" });
    expect(matchAllowed("destinationCity", "Munich").ok).toBe(false);
    expect(matchAllowed("originCity", "Bristol").ok).toBe(false);
    expect(matchAllowed("originCity", "Munich").ok).toBe(false); // Fuse alone would say Manchester
    expect(matchAllowed("destinationCountry", "Holland")).toMatchObject({ value: "Netherlands", how: "synonym" });
    expect(matchAllowed("priority", "cheap")).toMatchObject({ value: "Cheapest", how: "synonym" });
    expect(matchAllowed("destinationType", "3PL")).toMatchObject({ value: "Warehouse" });
    expect(matchAllowed("destinationType", "shop")).toMatchObject({ value: "Business address" });
    expect(matchAllowed("countryOfOrigin", "made here")).toMatchObject({ value: "United Kingdom" });
  });

  it("converts units and shows the conversion", () => {
    expect(parseAmount("5k", null, "int")).toEqual({ ok: true, value: "5000", note: "5k = 5,000" });
    expect(parseAmount("300", "lb", "weight")).toEqual({ ok: true, value: "136.077711", note: "300 lb × 0.45359237 = 136.08 kg" });
    expect(parseAmount("1.2", "tonnes", "weight")).toMatchObject({ ok: true, value: "1200" });
    expect(parseAmount("2.5", null, "int").ok).toBe(false);
    expect(parseAmount("400", "tons", "weight").ok).toBe(false);
  });

  it("never converts currencies", () => {
    expect(parseAmount("€5000", null, "money")).toEqual({ ok: false, why: "Please give the value in GBP." });
    expect(parseAmount("5000", "USD", "money")).toEqual({ ok: false, why: "Please give the value in GBP." });
    expect(parseAmount("£5,000", null, "money")).toMatchObject({ ok: true, value: "5000" });
  });

  it("resolves dates from today in Europe/London (Sun 25 Oct 2026)", () => {
    expect(resolveDate("tomorrow", TODAY)).toBe("2026-10-26");
    expect(resolveDate("next Thursday", TODAY)).toBe("2026-10-29");
    expect(resolveDate("Thursday", TODAY)).toBe("2026-10-29");
    expect(resolveDate("the 5th", TODAY)).toBe("2026-11-05");
    expect(resolveDate("5th November", TODAY)).toBe("2026-11-05");
    expect(resolveDate("November 5", TODAY)).toBe("2026-11-05");
    expect(resolveDate("5/11", TODAY)).toBe("2026-11-05");
    expect(resolveDate("05-11-2026", TODAY)).toBe("2026-11-05");
    expect(resolveDate("31-02-2026", TODAY)).toBeNull();
    expect(resolveDate("soonish", TODAY)).toBeNull();
  });

  it("reads numbers back digit by digit in voice mode", () => {
    expect(spoken("15", true)).toBe("15 (one-five)");
    expect(spoken("15", false)).toBe("15");
    expect(spoken("3", true)).toBe("3");
  });
});

describe("asking only for what's missing (spec §19)", () => {
  it("asks at most 3 questions, in the route → items → … order", async () => {
    const r = await turn(newChatSession("x"), "I want to ship some stuff", []);
    const qs = questionsIn(r.reply);
    expect(qs.length).toBeLessThanOrEqual(3);
    expect(r.reply).toContain("Which UK city");
    expect(r.reply).toContain("Where is it going");
    expect(r.reply).toContain("What are you shipping?");
  });

  it("never asks again for a value already given", async () => {
    const r = await turn(newChatSession("x"), "From Leeds to Paris", [op("originCity", "Leeds", "From Leeds"), op("destinationCity", "Paris", "to Paris")]);
    expect(r.reply).not.toContain("Which UK city");
    expect(r.reply).not.toContain("Where is it going");
    expect(r.session.booking.destinationCountry).toMatchObject({ value: "France", source: "derived" });
  });

  it("confirms a fuzzy match in the reply", async () => {
    const r = await turn(newChatSession("x"), "to Frankfrut", [op("destinationCity", "Frankfrut", "to Frankfrut")]);
    expect(r.reply).toContain(`I read "Frankfrut" as Frankfurt`);
  });

  it("refuses a city outside the list instead of guessing", async () => {
    const r = await turn(newChatSession("x"), "from Bristol", [op("originCity", "Bristol", "from Bristol")]);
    expect(r.session.booking.originCity.value).toBeNull();
    expect(r.reply).toContain("I can only book from London, Manchester, Birmingham or Leeds.");
  });

  it("a quote not found in the message → value discarded and asked for", async () => {
    const r = await turn(newChatSession("x"), "3 pallets please", [op("pallets", "4", "4 pallets")]);
    expect(r.session.booking.pallets.value).toBeNull();
    expect(r.reply).toContain("I couldn't match part of your message");
  });

  it("currency other than GBP → asks for GBP", async () => {
    const s = (await turn(newChatSession("x"), "mugs", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" })])).session;
    const r = await turn(s, "they cost €5 each", [op("unitPrice", "€5", "€5 each", { itemRef: "mugs" })]);
    expect(r.session.booking.items[0].unitPrice.value).toBeNull();
    expect(r.reply).toContain("Please give the value in GBP.");
  });

  it("Business address → no appointment question; appointment set by A7", async () => {
    const r = await turn(newChatSession("x"), "to a shop", [op("destinationType", "shop", "to a shop")]);
    expect(r.session.booking.appointmentBooked).toMatchObject({ value: "No", source: "assumed", assumptionId: "A7" });
    expect(missingQuestions(r.session).some((q) => q.key === "appointmentBooked")).toBe(false);
  });

  it("Warehouse → asks about the appointment", async () => {
    const r = await turn(newChatSession("x"), "to a fulfilment centre", [op("destinationType", "fulfilment centre", "fulfilment centre")]);
    expect(missingQuestions(r.session).some((q) => q.key === "appointmentBooked")).toBe(true);
  });

  it("dates are read back with the weekday and confirmed", async () => {
    const r = await turn(newChatSession("x"), "ready next Thursday", [op("readyDate", "next Thursday", "next Thursday")]);
    expect(r.reply).toContain("Ready to ship Thursday 29 Oct 2026 (29-10-2026), correct?");
    const y = await turn(r.session, "yes", []);
    expect(y.session.flags.dateConfirmed).toBe(true);
  });

  it("says straight away when a date is in the past", async () => {
    const r = await turn(newChatSession("x"), "ready on 01-10-2026", [op("readyDate", "01-10-2026", "01-10-2026")]);
    expect(r.reply).toContain("that date is in the past");
  });
});

describe("derived vs stated (spec §12.5)", () => {
  it("derives the third of quantity / units per carton / cartons", async () => {
    const s = await fullBooking();
    expect(s.booking.items[0].cartons).toMatchObject({ value: 90, source: "derived" });
    expect(s.booking.cartons).toMatchObject({ value: 90, source: "derived" });
    expect(s.booking.declaredValue).toMatchObject({ value: "5400", source: "derived" });
  });

  it("keeps all three when all three are stated, so R-03 catches the mismatch", async () => {
    let s = (await turn(newChatSession("x"), "mugs", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" })])).session;
    s = (
      await turn(s, "1800 mugs, 12 per carton, 90 cartons", [
        op("quantity", "1800", "1800 mugs", { itemRef: "mugs" }),
        op("unitsPerCarton", "12", "12 per carton", { itemRef: "mugs" }),
        op("cartons", "90", "90 cartons", { itemRef: "mugs" }),
      ])
    ).session;
    expect(s.booking.items[0].quantity).toMatchObject({ value: 1800, source: "stated" });
    const r03 = runChecks(s.booking, { today: TODAY }).results.find((r) => r.ruleId === "R-03")!;
    expect(r03.status).toBe("fail");
  });

  it("gross weight: ask → pallet weight → 25 kg ASSUMPTION A1", async () => {
    let s = await fullBooking();
    s = structuredClone(s);
    s.booking.grossWeightKg = { value: null, raw: null, source: "stated", location: null };
    let r = await turn(s, "no idea of the gross weight", [op("grossWeightKg", null, "no idea of the gross weight", { op: "unknown" })]);
    expect(r.reply).toContain("What does an empty pallet weigh?");
    r = await turn(r.session, "don't know that either", [op("palletWeightKg", null, "don't know that either", { op: "unknown" })]);
    expect(r.session.booking.grossWeightKg).toMatchObject({ value: "615", source: "assumed", assumptionId: "A1" });
    expect(r.reply).toContain("**ASSUMPTION:** estimated gross weight 615 kg = 540 kg of products + 3 pallets × 25 kg");
  });

  it("carton weight → unit weight with the packaging assumption (A6)", async () => {
    let s = (await turn(newChatSession("x"), "mugs", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" })])).session;
    s = (await turn(s, "12 per carton, a carton weighs 6.6 kg", [op("unitsPerCarton", "12", "12 per carton", { itemRef: "mugs" }), op("cartonWeightKg", "6.6", "6.6 kg", { itemRef: "mugs", unit: "kg" })])).session;
    expect(s.booking.items[0].unitWeightKg).toMatchObject({ value: "0.55", source: "assumed", assumptionId: "A6" });
  });

  it("no SKU after asking once → ITEM-1 (ASSUMPTION A4)", async () => {
    let s = await fullBooking();
    s = structuredClone(s);
    s.booking.items[0].sku = { value: null, raw: null, source: "stated", location: null };
    s.flags.readbackShown = false;
    s.lastQuestion = "Does ceramic mugs have a SKU?";
    const r = await turn(s, "no", []);
    expect(r.session.booking.items[0].sku).toMatchObject({ value: "ITEM-1", source: "assumed", assumptionId: "A4" });
  });

  it("HS code unknown → labelled AI suggestion, used only if confirmed", async () => {
    let s = (await turn(newChatSession("x"), "mugs", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" })])).session;
    const r = await turn(s, "don't know the HS code", [op("hsCode", null, "don't know the HS code", { op: "unknown", itemRef: "mugs" })]);
    expect(r.reply).toContain("**Suggestion: please verify; you are legally responsible for the code:** HS 691200");
    expect(r.session.booking.items[0].hsCode.value).toBeNull();
    s = (await turn(r.session, "yes", [])).session;
    expect(s.booking.items[0].hsCode).toMatchObject({ value: "691200", source: "confirmed" });
  });

  it("'No, leave it for now.' declines the HS suggestion instead of asking again", async () => {
    const s = (await turn(newChatSession("x"), "mugs", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" })])).session;
    const r = await turn(s, "don't know the HS code", [op("hsCode", null, "don't know the HS code", { op: "unknown", itemRef: "mugs" })]);
    const n = await turn(r.session, "No, leave it for now.", []);
    expect(n.reply).toContain("OK, no HS code for now.");
    expect(n.reply).not.toContain("Shall I use it?");
    expect(n.session.booking.items[0].hsCode.value).toBeNull();
  });

  it("country of origin is never filled from the shipping country", async () => {
    const r = await turn(newChatSession("x"), "mugs from Leeds", [op("originCity", "Leeds", "from Leeds"), op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" })]);
    expect(r.session.booking.items[0].countryOfOrigin.value).toBeNull();
  });
});

describe("read-back and corrections (spec §12.6–12.7)", () => {
  it("shows a full read-back when nothing is missing; 'yes' confirms derived values", async () => {
    let s = await fullBooking();
    const r = await turn(s, "Northfield Goods", [op("sellerName", "Northfield Goods", "Northfield Goods")]);
    expect(r.reply).toContain("Here's the full booking. Please check every line:");
    expect(r.reply).toContain("• Pallets: 3 · total cartons: 90 (worked out: sum of product cartons: 90)");
    const y = await turn(r.session, "yes that's right", []);
    expect(y.justConfirmed).toBe(true);
    s = y.session;
    expect(s.booking.cartons.source).toBe("confirmed");
    expect(runChecks(s.booking, { today: TODAY }).status).toBe("ready");
  });

  it("'add a pallet' → pallets + 1, with change chips", async () => {
    const s = await fullBooking();
    const r = await turn(s, "add a pallet", [op("pallets", "1", "add a pallet", { op: "increment" })]);
    expect(r.session.booking.pallets.value).toBe(4);
    expect(r.reply).toContain("Pallets: 3 → 4");
    const holidays = async () => null;
    const before = await evaluateBooking(s.booking, emptyState(), TODAY, holidays);
    const after = await evaluateBooking(r.session.booking, emptyState(), TODAY, holidays);
    expect(changeChips(s.booking, before, r.session.booking, after)).toEqual(["Pallets 3 → 4", "Cost £540 → £720", "Carrier unchanged"]);
  });

  it("a stated total stays when a product is added, and is flagged", async () => {
    let s = await fullBooking();
    s = (await turn(s, "90 cartons in total", [op("cartons", "90", "90 cartons in total")])).session;
    expect(s.booking.cartons.source).toBe("stated");
    const r = await turn(s, "also 30 cartons of plates, 10 per carton", [
      op("description", "plates", "plates", { op: "add_item", itemRef: "plates" }),
      op("cartons", "30", "30 cartons of plates", { itemRef: "plates" }),
      op("unitsPerCarton", "10", "10 per carton", { itemRef: "plates" }),
    ]);
    expect(r.session.booking.cartons).toMatchObject({ value: 90, source: "stated" });
    expect(r.reply).toContain("You said 90 cartons total; the products now add up to 120. Update the total to 120?");
  });

  it("a derived total recomputes when a product is added", async () => {
    const s = await fullBooking();
    const r = await turn(s, "also 30 cartons of plates, 10 per carton", [
      op("description", "plates", "plates", { op: "add_item", itemRef: "plates" }),
      op("cartons", "30", "30 cartons of plates", { itemRef: "plates" }),
      op("unitsPerCarton", "10", "10 per carton", { itemRef: "plates" }),
    ]);
    expect(r.session.booking.cartons).toMatchObject({ value: 120, source: "derived" });
  });

  it("an ambiguous correction asks which field", async () => {
    const s = await fullBooking();
    const r = await turn(s, "make it 4", [], { ambiguities: [{ about: "4 could be pallets or cartons", quote: "make it 4" }] });
    expect(r.reply).toContain('You said "make it 4", 4 could be pallets or cartons. Which detail is that?');
    expect(r.session.booking.pallets.value).toBe(3);
  });

  it("a second shipment → offers a new booking, changes nothing", async () => {
    const s = await fullBooking();
    const r = await turn(s, "I also have another order to Berlin", [op("destinationCity", "Berlin", "to Berlin")], { newShipment: true });
    expect(r.reply).toContain("Start a new booking");
    expect(r.session.booking.destinationCity.value).toBe("Frankfurt");
  });

  it("AI unavailable → points to the form, keeps everything", async () => {
    const s = await fullBooking();
    const r = await handleTurn(s, "hello", false, { ok: false, reason: "unavailable" }, deps);
    expect(r.reply).toBe("The assistant is unavailable right now, you can fill in the booking form instead. Nothing you've told me is lost.");
    expect(r.session.aiUnavailable).toBe(true);
    expect(r.session.booking.pallets.value).toBe(3);
  });
});

describe("money with a GBP unit", () => {
  it("accepts '£' or 'GBP' in the unit field", () => {
    expect(parseAmount("5", "£", "money")).toMatchObject({ ok: true, value: "5" });
    expect(parseAmount("5400", "GBP", "money")).toMatchObject({ ok: true, value: "5400" });
    expect(parseAmount("5", "€", "money").ok).toBe(false);
  });
});

describe("yes/no mixed with other details", () => {
  it("'yes, use it, made in China' accepts the HS suggestion and records the origin", async () => {
    let s = (await turn(newChatSession("x"), "mugs", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" })])).session;
    s = (await turn(s, "no idea about the HS code", [op("hsCode", null, "no idea about the HS code", { op: "unknown", itemRef: "mugs" })])).session;
    const r = await turn(s, "Yes, use it. They're made in China", [op("countryOfOrigin", "China", "made in China", { itemRef: "mugs" })]);
    expect(r.session.booking.items[0].hsCode).toMatchObject({ value: "691200", source: "confirmed" });
    expect(r.session.booking.items[0].countryOfOrigin.value).toBe("China");
    expect(r.reply).toContain("HS code 691200 recorded");
  });
});

describe("no-SKU answers", () => {
  it("'No SKU' never becomes the SKU 'No'", async () => {
    let s = (await turn(newChatSession("x"), "mugs", [op("description", "mugs", "mugs", { op: "add_item", itemRef: "mugs" })])).session;
    s.lastQuestion = "Does mugs have a SKU?";
    const r = await turn(s, "No SKU. Cheapest please", [op("sku", "No", "No SKU", { itemRef: "mugs" }), op("priority", "Cheapest", "Cheapest")]);
    expect(r.session.booking.items[0].sku).toMatchObject({ value: "ITEM-1", assumptionId: "A4" });
    expect(r.session.booking.priority.value).toBe("Cheapest");
  });
});

describe("found by the live voice run", () => {
  it("'24 to a box' and 'two pallets' are numbers", () => {
    expect(parseAmount("24", "to a box", "int")).toMatchObject({ ok: true, value: "24" });
    expect(parseAmount("24", "box", "int")).toMatchObject({ ok: true, value: "24" });
    expect(parseAmount("two", null, "int")).toMatchObject({ ok: true, value: "2" });
    expect(parseAmount("twenty-four", null, "int")).toMatchObject({ ok: true, value: "24" });
    expect(parseAmount("a dozen", null, "int")).toMatchObject({ ok: true, value: "12" });
  });

  it("'10 euros' never becomes £10, even if the price arrives without its currency", async () => {
    let s = (await turn(newChatSession("x"), "candles at £8", [op("description", "candles", "candles", { op: "add_item", itemRef: "candles" }), op("unitPrice", "8", "£8", { itemRef: "candles" })])).session;
    const r = await turn(s, "Sorry, the price is actually 10 euros each.", [op("unitPrice", "10", "10 euros each", { itemRef: "candles" }), op("currency", "euros", "euros")]);
    s = r.session;
    expect(s.booking.items[0].unitPrice.value).toBe("8");
    expect(r.reply).toContain("Please give the value in GBP");
  });

  it("an empty SKU answer means no SKU", async () => {
    const s = (await turn(newChatSession("x"), "candles", [op("description", "candles", "candles", { op: "add_item", itemRef: "candles" })])).session;
    const r = await turn(s, "There's no SKU.", [op("sku", "", "There's no SKU", { itemRef: "candles" })]);
    expect(r.session.booking.items[0].sku).toMatchObject({ value: "ITEM-1", assumptionId: "A4" });
    expect(r.reply).not.toContain("That was empty");
  });

  it("ignores an ambiguity whose quote isn't in this message", async () => {
    const r = await turn(newChatSession("x"), "Yes, that's all correct.", [], { ambiguities: [{ about: "'4' could be pallets", quote: "Make it 4." }] });
    expect(r.reply).not.toContain("Make it 4");
  });
});

describe("several yes/no questions open", () => {
  it("'Yes, use that code' answers the HS suggestion even when a SKU question is also open", async () => {
    let s = (await turn(newChatSession("x"), "candles", [op("description", "candles", "candles", { op: "add_item", itemRef: "candles" })])).session;
    s = (await turn(s, "don't know the HS code", [op("hsCode", null, "don't know the HS code", { op: "unknown", itemRef: "candles" })])).session;
    s.lastQuestion = `${s.lastQuestion} Does candles have a SKU?`;
    // The AI also "extracts" the code from the yes, its quote has no number, so it's discarded.
    const r = await turn(s, "Yes, use that code.", [op("hsCode", "691200", "use that code", { itemRef: "candles" })]);
    expect(r.session.booking.items[0].hsCode).toMatchObject({ value: "691200", source: "confirmed" });
    expect(r.reply).not.toContain("couldn't match");
  });
});

describe("problems asked back as plain questions", () => {
  async function mugs(extra: ExtractOperation[] = []) {
    let s = (await turn(newChatSession("x"), "mugs", [op("description", "ceramic mugs", "mugs", { op: "add_item", itemRef: "mugs" })])).session;
    s = (await turn(s, "x", [])).session;
    return { s, extra };
  }

  it("offers the tested fix for a mismatch, and 'yes' applies it", async () => {
    const { s } = await mugs();
    const r = await turn(s, "1800 mugs, 12 per carton, 90 cartons", [
      op("quantity", "1800", "1800 mugs", { itemRef: "mugs" }),
      op("unitsPerCarton", "12", "12 per carton", { itemRef: "mugs" }),
      op("cartons", "90", "90 cartons", { itemRef: "mugs" }),
    ]);
    expect(r.reply).toContain("mugs: 12 per carton × 90 cartons = 1,080, but quantity says 1,800. Did you mean: change mugs quantity from 1,800 to 1,080? (Looks like two digits were swapped.)");
    expect(r.reply).not.toMatch(/R-0\d/);
    const y = await turn(r.session, "yes", []);
    expect(y.session.booking.items[0].quantity).toMatchObject({ value: 1080, source: "fixed" });
    expect(y.reply).toContain("Done: change mugs quantity from 1,800 to 1,080.");
  });

  it("asks before removing a dangerous product", async () => {
    const { s } = await mugs();
    const r = await turn(s, "also power banks 10000mAh", [op("description", "power banks 10000mAh", "power banks 10000mAh", { op: "add_item", itemRef: "power banks 10000mAh" })]);
    expect(r.reply).toContain("Shall I remove power banks 10000mAh from this booking?");
    const y = await turn(r.session, "yes remove it", []);
    expect(y.session.booking.items.map((it) => it.description.value)).toEqual(["mugs"]);
  });

  it("asks about a warehouse slot and records the answer", async () => {
    const r = await turn(newChatSession("x"), "to an Amazon warehouse, no slot booked", [op("destinationType", "Amazon warehouse", "Amazon warehouse"), op("appointmentBooked", "no", "no slot booked")]);
    expect(r.reply).toContain("have you booked a slot?");
    const y = await turn(r.session, "yes, booked it now", []);
    expect(y.session.booking.appointmentBooked.value).toBe("Yes");
  });

  it("asks the battery question in plain words and records 'no'", async () => {
    const r = await turn(newChatSession("x"), "portable chargers, HS 850760", [
      op("description", "Portable charger", "portable chargers", { op: "add_item", itemRef: "portable chargers" }),
      op("hsCode", "850760", "HS 850760", { itemRef: "portable chargers" }),
    ]);
    expect(r.reply).toContain("Does 'portable chargers' contain a lithium battery?");
    const n = await turn(r.session, "no", []);
    expect(Object.values(n.session.state.answers)).toEqual(["no"]);
    expect(n.reply).toContain("noted that it doesn't");
  });

  it("never shows rule codes in any reply", async () => {
    const s = await fullBooking();
    const r = await turn(s, "Northfield Goods", [op("sellerName", "Northfield Goods", "Northfield Goods")]);
    expect(r.reply).not.toMatch(/R-\d\d/);
  });
});

describe("'What to tell us' checklist", () => {
  it("ticks off what's been given and marks 'don't know' answers", async () => {
    const { tellUsChecklist } = await import("@/lib/chat/checklist");
    const empty = tellUsChecklist(newChatSession("x").booking, newChatSession("x").flags);
    expect(empty.flatMap((g) => g.items).every((i) => i.state === "todo")).toBe(true);
    const s = await fullBooking();
    const items = tellUsChecklist(s.booking, s.flags).flatMap((g) => g.items);
    const state = (label: string) => items.find((i) => i.label === label)!.state;
    expect(state("Collection city")).toBe("done");
    expect(state("Units per box")).toBe("done");
    expect(state("Seller (company) name")).toBe("todo");
    const unknown = structuredClone(s);
    unknown.booking.grossWeightKg = { value: null, raw: null, source: "stated", location: null };
    unknown.flags.grossUnknown = true;
    expect(tellUsChecklist(unknown.booking, unknown.flags).flatMap((g) => g.items).find((i) => i.label === "Total weight")!.state).toBe("unknown");
  });
});

describe("found by the mixed right/wrong speech", () => {
  it("'12 to a box, 90 boxes' for one product is the product's box count, so 1,800 is caught", async () => {
    const r = await turn(newChatSession("x"), "1,800 plates, 12 to a box, 90 boxes", [
      op("description", "plates", "plates", { op: "add_item", itemRef: "plates" }),
      op("quantity", "1,800", "1,800 plates", { itemRef: "plates" }),
      op("unitsPerCarton", "12", "12 to a box", { itemRef: "plates" }),
      op("cartons", "90", "90 boxes"),
    ]);
    expect(r.session.booking.items[0].cartons).toMatchObject({ value: 90, source: "stated" });
    expect(r.reply).toContain("Did you mean: change plates quantity from 1,800 to 1,080?");
  });

  it("a recent day+month with no year is this year, and flagged as past", () => {
    expect(resolveDate("20th of October", "2026-10-26")).toBe("2026-10-20");
    expect(resolveDate("5th November", "2026-10-26")).toBe("2026-11-05");
    expect(resolveDate("3rd March", "2026-10-26")).toBe("2027-03-03");
  });

  it("'Yes, 1,080 is right' doesn't confirm a pending date question", async () => {
    let s = (await turn(newChatSession("x"), "ready 05-11-2026", [op("readyDate", "05-11-2026", "05-11-2026")])).session;
    s = (await turn(s, "plates", [op("description", "plates", "plates", { op: "add_item", itemRef: "plates" })])).session;
    s.lastQuestion = "Ready to ship Thursday 05 Nov 2026 (05-11-2026), correct?";
    const r = await turn(s, "Yes, 1,080 is right.", [op("quantity", "1,080", "1,080", { itemRef: "plates" })]);
    expect(r.session.flags.dateConfirmed).toBe(false);
    expect(r.session.booking.items[0].quantity.value).toBe(1080);
  });
});

describe("a yes with extra words", () => {
  it("'Yes, 1,080 is right' (no extracted detail) doesn't answer the date question", async () => {
    const s = (await turn(newChatSession("x"), "ready 05-11-2026", [op("readyDate", "05-11-2026", "05-11-2026")])).session;
    const r = await turn(s, "Yes, 1,080 is right.", []);
    expect(r.session.flags.dateConfirmed).toBe(false);
  });
  it("a plain 'Yes.' still does", async () => {
    const s = (await turn(newChatSession("x"), "ready 05-11-2026", [op("readyDate", "05-11-2026", "05-11-2026")])).session;
    expect((await turn(s, "Yes.", [])).session.flags.dateConfirmed).toBe(true);
  });
});

describe("plain yes variants", () => {
  it("'yes that's right', 'Yes, please.' and 'No thanks' count as plain answers", async () => {
    for (const t of ["yes that's right", "Yes, please.", "yep, correct"]) {
      const s = (await turn(newChatSession("x"), "ready 05-11-2026", [op("readyDate", "05-11-2026", "05-11-2026")])).session;
      expect((await turn(s, t, [])).session.flags.dateConfirmed).toBe(true);
    }
  });
});

describe("the Harbour Home Goods speech (reported by the product owner)", () => {
  const SPEECH = "Hi, this is Harbour Home Goods. I'm sending 1,800 ceramic dinner plates from Birmingham to Hamburg. They're £6 each, packed 12 to a box, 90 boxes, on 2 pallets. Each plate weighs 0.8 kilos and the whole shipment weighs 900 kilos. The HS code is 69120 and they're made in China. It's ready on the 20th of October. Cheapest please. It's going to a warehouse and we haven't booked a delivery slot yet.";
  const P = "ceramic dinner plates";
  const ops = [
    op("sellerName", "Harbour Home Goods", "Harbour Home Goods"),
    op("description", P, P, { op: "add_item", itemRef: P }),
    op("description", P, P, { itemRef: P }),
    op("quantity", "1,800", "1,800 ceramic dinner plates", { itemRef: P }),
    op("originCity", "Birmingham", "from Birmingham"),
    op("destinationCity", "Hamburg", "to Hamburg"),
    op("unitPrice", "£6", "£6 each", { itemRef: P }),
    op("unitsPerCarton", "12", "12 to a box", { itemRef: P }),
    op("cartons", "90", "90 boxes"),
    op("pallets", "2", "2 pallets"),
    op("unitWeightKg", "0.8", "0.8 kilos", { itemRef: P, unit: "kilos" }),
    op("grossWeightKg", "900", "900 kilos", { unit: "kilos" }),
    op("hsCode", "69120", "HS code is 69120", { itemRef: P }),
    op("countryOfOrigin", "China", "made in China", { itemRef: P }),
    op("readyDate", "20th of October", "20th of October"),
    op("priority", "Cheapest", "Cheapest"),
    op("destinationType", "warehouse", "a warehouse"),
    op("appointmentBooked", "no", "haven't booked a delivery slot"),
  ];

  it("lists every problem, asks the must-fix ones first, and doesn't ask 'correct?' about a past date", async () => {
    const r = await turn(newChatSession("x"), SPEECH, ops);
    expect(r.reply).toContain("**I spotted 5 things to fix:**");
    for (const t of ["Customs (HS) code", "Units, boxes and quantity add up", "Total weight is realistic", "Warehouse delivery slot", "Ready date"]) {
      expect(r.reply).toContain(`• ${t} · `);
    }
    expect(r.reply).toContain("1. ceramic dinner plates: HS code 69120 has only 5 digits.");
    expect(r.reply).toContain("2. ceramic dinner plates: 12 per carton × 90 cartons = 1,080, but quantity says 1,800. Did you mean");
    expect(r.reply).not.toContain(", correct?");
    expect(r.reply).not.toContain("Product: ceramic dinner plates");
    expect(r.session.booking.originCity.value).toBe("Birmingham");
  });
});

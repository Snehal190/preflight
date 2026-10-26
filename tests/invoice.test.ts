import { describe, expect, it } from "vitest";
import { buildInvoice, emptyExtra } from "@/lib/invoice";
import { evaluateBooking } from "@/lib/booking/evaluate";
import { emptyState } from "@/lib/booking/state";
import { bk001, TODAY } from "./fixtures/bookings";

const noHolidays = async () => null;

describe("commercial invoice", () => {
  it("fills everything it can from the booking and lists what's still needed", async () => {
    const b = bk001();
    const e = await evaluateBooking(b, emptyState(), TODAY, noHolidays as never);
    const inv = buildInvoice(b, e, emptyExtra(b), TODAY);
    expect(inv.number).toBe("INV-BK-001");
    expect(inv.seller.name).toBe("Northfield Goods");
    expect(inv.lines[0]).toMatchObject({ sku: "MUG-01", hsCode: "691200", quantity: 1080, unitPrice: "5.00", amount: "5,400.00" });
    expect(inv.total).toBe("5,400.00");
    expect(inv.vat).toBe("0.00");
    expect(inv.buyer.country).toBe("Germany");
    expect(inv.missing).toEqual(["Your business address", "Your EORI number", "Buyer (consignee) name", "Buyer (consignee) address", "Incoterms"]);
  });

  it("nothing missing once the seller adds their details", async () => {
    const b = bk001();
    const e = await evaluateBooking(b, emptyState(), TODAY, noHolidays as never);
    const extra = { ...emptyExtra(b), sellerAddress: "1 High St, Leeds", sellerEori: "GB123456789000", buyerName: "Business ABC", buyerAddress: "Kurfürstendamm 567, Berlin", incoterms: "DAP" };
    expect(buildInvoice(b, e, extra, TODAY).missing).toEqual([]);
  });
});

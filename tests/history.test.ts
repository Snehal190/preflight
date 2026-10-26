import { describe, expect, it } from "vitest";
import { historyEntry, mergeHistory } from "@/lib/history";
import { evaluateBooking } from "@/lib/booking/evaluate";
import { emptyState } from "@/lib/booking/state";
import { bk001, TODAY } from "./fixtures/bookings";

const noHolidays = async () => null;

describe("shipment history", () => {
  it("one row per booking: a later change updates it, keeping when and how it first came in", async () => {
    const b = bk001();
    const e = await evaluateBooking(b, emptyState(), TODAY, noHolidays as never);
    const first = historyEntry({ batchId: "b1", source: "upload", files: ["Bookings.xlsx"], booking: b, evaluation: e, at: "2026-10-26T10:00:00Z", lastChange: "Uploaded" });
    expect(first).toMatchObject({ id: `b1/${b.key}`, bookingId: "BK-001", seller: "Northfield Goods", route: "Leeds → Frankfurt, Germany", status: e.status });
    const later = { ...first, source: "chat" as const, files: [], updatedAt: "2026-10-26T11:00:00Z", lastChange: "Typed: the quantity is 200" };
    const merged = mergeHistory([first], [later]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ createdAt: "2026-10-26T10:00:00Z", source: "upload", files: ["Bookings.xlsx"], lastChange: "Typed: the quantity is 200" });
  });

  it("newest first", () => {
    const row = (id: string, at: string) => ({ id, batchId: "b", key: id, source: "upload" as const, files: [], bookingId: id, seller: "S", route: "r", items: 1, status: "ready" as const, headline: "", carrier: "", cost: "", createdAt: at, updatedAt: at, lastChange: "" });
    expect(mergeHistory([row("a", "2026-10-26T09:00:00Z")], [row("b", "2026-10-26T12:00:00Z")]).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

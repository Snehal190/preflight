import { describe, expect, it } from "vitest";
import { isSealed } from "@/lib/stage/flaps";

describe("the box closes only when every check passes", () => {
  it("stays open at 9 of 10, seals at 10", () => {
    expect(isSealed(0)).toBe(false);
    expect(isSealed(9)).toBe(false);
    expect(isSealed(10)).toBe(true);
  });
});

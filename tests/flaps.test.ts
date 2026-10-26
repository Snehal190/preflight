import { describe, expect, it } from "vitest";
import { flapsClosed, isSealed } from "@/lib/stage/flaps";

describe("box flaps close as checks are packed", () => {
  it.each([
    [0, 0],
    [2, 0],
    [3, 1],
    [5, 2],
    [7, 2],
    [8, 3],
    [9, 3],
    [10, 4],
  ])("%i packed → %i flaps closed", (packed, flaps) => {
    expect(flapsClosed(packed)).toBe(flaps);
  });
  it("is only taped shut when all ten pass", () => {
    expect(isSealed(9)).toBe(false);
    expect(isSealed(10)).toBe(true);
  });
});

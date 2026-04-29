import { describe, expect, it } from "vitest";
import { computeReadTimeMinutes } from "../../src/lib/read-time.js";

// Unit tests for the read-time helper (#125). The AC enumerates the
// exact inputs — keep the table literal so a future refactor can't
// silently change the contract.
describe("computeReadTimeMinutes", () => {
  it("returns 1 for an empty body", () => {
    expect(computeReadTimeMinutes("")).toBe(1);
  });

  it("returns 1 for whitespace-only body", () => {
    expect(computeReadTimeMinutes("   \n\t  ")).toBe(1);
  });

  it("returns 1 for a single word", () => {
    expect(computeReadTimeMinutes("hello")).toBe(1);
  });

  it("returns 1 for 237 words (just under the 1-min cap)", () => {
    const body = Array.from({ length: 237 }, (_, i) => `w${i}`).join(" ");
    expect(computeReadTimeMinutes(body)).toBe(1);
  });

  it("returns 1 for exactly 238 words (boundary: 238/238 = 1)", () => {
    const body = Array.from({ length: 238 }, (_, i) => `w${i}`).join(" ");
    expect(computeReadTimeMinutes(body)).toBe(1);
  });

  it("returns 2 for 239 words (one over the 1-min cap rounds up)", () => {
    const body = Array.from({ length: 239 }, (_, i) => `w${i}`).join(" ");
    expect(computeReadTimeMinutes(body)).toBe(2);
  });

  it("returns 43 for 10000 words (ceil(10000/238) = 43)", () => {
    const body = Array.from({ length: 10000 }, (_, i) => `w${i}`).join(" ");
    expect(computeReadTimeMinutes(body)).toBe(43);
  });

  it("treats mixed whitespace (tabs, newlines) as word separators", () => {
    const body = "one\ttwo\nthree four\n\nfive";
    expect(computeReadTimeMinutes(body)).toBe(1);
  });
});

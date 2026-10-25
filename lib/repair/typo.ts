import { Decimal } from "../num";

// Typo patterns between an original number and a candidate (spec §9.4). Plain-English names.

function digitsOnly(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

function canonicalString(v: string): string {
  return new Decimal(v).toFixed();
}

function adjacentSwap(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
  return diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]];
}

/** Levenshtein distance is exactly 1. */
function oneDigitEdit(a: string, b: string): "added" | "removed" | "different" | null {
  if (a === b) return null;
  if (a.length === b.length) {
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d === 1 ? "different" : null;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long.length - short.length !== 1) return null;
  for (let i = 0; i < long.length; i++) {
    if (long.slice(0, i) + long.slice(i + 1) === short) return a.length < b.length ? "removed" : "added";
  }
  return null;
}

/**
 * Describe how `original` could be a typo of `candidate` (the value the evidence points to).
 * Returns null when no known pattern matches.
 */
export function typoPattern(original: string, candidate: string): string | null {
  const o = canonicalString(original);
  const c = canonicalString(candidate);
  if (o === c) return null;
  const od = digitsOnly(o);
  const cd = digitsOnly(c);
  if (adjacentSwap(od, cd) && o.includes(".") === c.includes(".")) return "Looks like two digits were swapped.";

  const ratio = new Decimal(o).div(c);
  const hasDecimal = original.includes(".") || candidate.includes(".") || o.includes(".") || c.includes(".");
  const ZERO_PATTERNS: [string, string][] = [
    ["10", "Looks like an extra zero was typed."],
    ["100", "Looks like two extra zeros were typed."],
    ["0.1", "Looks like a zero was left out."],
    ["0.01", "Looks like two zeros were left out."],
  ];
  for (const [k, text] of ZERO_PATTERNS) {
    if (ratio.eq(k)) return hasDecimal ? "Looks like the decimal point moved." : text;
  }

  const one = oneDigitEdit(od, cd);
  if (one === "different") return "Looks like one digit was mistyped.";
  if (one === "added") return "Looks like an extra digit was typed.";
  if (one === "removed") return "Looks like a digit was left out.";
  return null;
}

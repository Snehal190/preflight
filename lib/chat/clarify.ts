import type { Booking } from "../types";
import type { CheckResult, Patch } from "../rules/types";

// Turns check problems into plain questions for the seller (no rule codes). Missing fields are
// asked by the field questions instead, so they're skipped here.

export type IssueAction =
  | { kind: "fix"; patches: Patch[]; summary: string; clears: string[] }
  | { kind: "dg"; answerKey: string }
  | { kind: "remove"; itemId: string; name: string }
  | { kind: "appointment" };

export interface IssueQuestion {
  resultId: string;
  ruleId: string;
  /** Plain rule name, for the "I spotted…" list. */
  title: string;
  found: string;
  /** 0 = must fix, 1 = question for you, 2 = please check. Asked in that order. */
  rank: number;
  /** Asked once per distinct finding: changes when the numbers change. */
  signature: string;
  text: string;
  /** Present when a plain yes/no answer can resolve it. */
  action: IssueAction | null;
}

export function issueQuestions(results: CheckResult[], b: Booking, acknowledged: readonly string[]): IssueQuestion[] {
  const out: IssueQuestion[] = [];
  for (const r of results) {
    if (r.ruleId === "INFO" || r.ruleId === "DATA" || r.status === "missing_data" || r.status === "pass" || r.status === "not_applicable") continue;
    if (r.nonBlocking || acknowledged.includes(r.id)) continue;
    const sig = `${r.id}|${r.status}|${r.found}`;
    const item = r.scope.kind === "item" ? b.items.find((it) => r.scope.kind === "item" && it.itemId === r.scope.itemId) : undefined;
    const top = r.fix.tested?.[0];
    const rank = r.status === "fail" && r.severity === "red" ? 0 : r.status === "needs_answer" ? 1 : 2;
    const push = (text: string, action: IssueAction | null = null) => out.push({ resultId: r.id, ruleId: r.ruleId, title: r.title, found: r.found, rank, signature: sig, text, action });

    switch (r.ruleId) {
      case "R-01":
        // A blank code is asked as a field question; this is for a code that's there but wrong.
        if (item && item.hsCode.value === null && !(item.hsCode.raw ?? "").trim()) break;
        push(`${r.found} What's the full customs code (at least 6 digits)?${r.fix.hint ? ` ${r.fix.hint}` : ""}`);
        break;
      case "R-02":
      case "R-03":
      case "R-04":
        if (top) push(`${r.found} Did you mean: ${top.summary.charAt(0).toLowerCase()}${top.summary.slice(1)}?${top.typo ? ` (${top.typo.replace(/\.$/, "")}.)` : ""}`, { kind: "fix", patches: top.patches, summary: top.summary, clears: top.clears });
        else push(`${r.found} Which number is right?`);
        break;
      case "R-05":
        push(`${r.found} ${r.fix.text} How many pallets should it be?`);
        break;
      case "R-06":
        if (r.status === "needs_answer" && r.question) push(r.question.prompt, { kind: "dg", answerKey: r.question.answerKey });
        else if (item) push(`${r.found} That can't go on a normal road shipment. Shall I remove ${item.description.value ?? "it"} from this booking?`, { kind: "remove", itemId: item.itemId, name: item.description.value ?? "that product" });
        break;
      case "R-07":
        push(`${r.found.replace(/\.$/, "")}, that can't be right, because the total has to include the products, boxes and pallets. What's the real total gross weight?`);
        break;
      case "R-08":
        push("It's going to a warehouse, but no delivery slot is booked. Warehouses turn away trucks without one, have you booked a slot?", { kind: "appointment" });
        break;
      case "R-09":
        // Blank origin is asked as a field question.
        break;
      case "R-10":
        push(`${r.found} When will it actually be ready to ship?`);
        break;
    }
  }
  // Must-fix first, then questions, then things to check (stable within each group).
  return out.map((q, i) => ({ q, i })).sort((a, b) => a.q.rank - b.q.rank || a.i - b.i).map((x) => x.q);
}

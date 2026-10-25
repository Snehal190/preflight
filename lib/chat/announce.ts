import type { Evaluation } from "../booking/state";

/** Red failures and questions that weren't there before this turn, as one line each. */
export function newBlockingIssues(before: Evaluation, after: Evaluation): string[] {
  const was = new Set(before.results.filter((r) => r.status === "fail" || r.status === "needs_answer").map((r) => `${r.id}|${r.status}`));
  return after.results
    .filter((r) => ((r.status === "fail" && r.severity === "red" && !r.nonBlocking) || r.status === "needs_answer") && !was.has(`${r.id}|${r.status}`))
    .map((r) => `${r.title}${r.status === "needs_answer" ? " (needs your answer)" : " (Red)"}: ${r.found}`);
}

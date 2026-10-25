"use client";

import { useState } from "react";
import type { CheckResult, Patch } from "@/lib/rules/types";
import { ASSUMPTIONS, type AssumptionId } from "@/lib/reference/assumptions";
import { locationText } from "@/lib/rules/helpers";

export function stateLabel(r: CheckResult): { text: string; cls: string } {
  switch (r.status) {
    case "missing_data":
      return { text: "Missing data", cls: "bg-ink text-white" };
    case "needs_answer":
      return { text: "Needs your answer", cls: "bg-accent text-ink border border-ink" };
    case "pass":
      return { text: "Pass", cls: "bg-sage/40 text-ink" };
    case "not_applicable":
      return { text: "Not applicable", cls: "bg-sage/30 text-ink" };
    case "fail":
      if (r.severity === "red") return { text: r.nonBlocking ? "Red — doesn't block" : "Red", cls: "bg-bad text-white" };
      if (r.severity === "amber") return { text: "Amber", cls: "bg-warn text-white" };
      return { text: "Info", cls: "bg-note text-white" };
  }
}

export function AssumptionLine({ id }: { id: AssumptionId }) {
  const a = ASSUMPTIONS[id];
  return (
    <p className="text-sm">
      <strong>ASSUMPTION: {a.label}.</strong> <span className="text-ink/70">{a.why}</span>
    </p>
  );
}

interface Props {
  r: CheckResult;
  busy: boolean;
  acknowledgedBy?: { name: string; at: string };
  onApply: (patches: Patch[], summary: string) => void;
  onAnswer: (key: string, v: "yes" | "no", prompt: string) => void;
  onAcknowledge: (id: string, name: string) => void;
  onUnacknowledge: (id: string) => void;
  /** Only for R-01 cards on a blank code with a description. */
  onSuggestHs?: () => void;
}

export function IssueCard({ r, busy, acknowledgedBy, onApply, onAnswer, onAcknowledge, onUnacknowledge, onSuggestHs }: Props) {
  const [name, setName] = useState("");
  const st = stateLabel(r);
  const where = [...new Set(r.why.inputs.map((i) => locationText(i.location, i.sku)).filter(Boolean))];
  const isAmber = r.status === "fail" && r.severity === "amber";
  const border = r.status === "fail" && r.severity === "red" ? "border-bad/50" : isAmber ? "border-warn/50" : "border-ink/15";

  return (
    <article className={`rounded-xl border ${border} p-4 space-y-3`} id={r.id}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{r.title}</h3>
        <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${st.cls}`}>{st.text}</span>
      </header>

      <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="font-semibold">What we found</dt>
        <dd>{r.found}</dd>
        {where.length > 0 && (
          <>
            <dt className="font-semibold">Where</dt>
            <dd>{where.join(" · ")}</dd>
          </>
        )}
        <dt className="font-semibold">What it should be</dt>
        <dd>{r.shouldBe}</dd>
        {r.whyItMatters && (
          <>
            <dt className="font-semibold">Why it matters</dt>
            <dd>{r.whyItMatters}</dd>
          </>
        )}
        {(r.fix.text || r.fix.tested?.length || r.fix.noApplyReason) && r.status !== "pass" && r.status !== "not_applicable" && (
          <>
            <dt className="font-semibold">How to fix it</dt>
            <dd className="space-y-2">
              {r.fix.text && <p>{r.fix.text}</p>}
              {r.fix.hint && <p className="font-semibold">{r.fix.hint}</p>}
              {r.fix.suggestion && (
                <p className="rounded border border-ink/20 p-2">
                  <strong>{r.fix.suggestion.label}</strong> HS code <code>{r.fix.suggestion.value}</code> — {r.fix.suggestion.reason}
                </p>
              )}
              {onSuggestHs && !r.fix.suggestion && (
                <button type="button" className="btn btn-ghost text-xs" onClick={onSuggestHs} disabled={busy}>
                  Ask AI for an HS code suggestion
                </button>
              )}
              {r.fix.tested?.map((f, i) => (
                <div key={i} className="rounded border border-ink/20 p-3 space-y-1">
                  <p className="font-semibold">{f.summary}</p>
                  {f.typo && <p>{f.typo}</p>}
                  <p className="text-ink/80">{f.evidence}</p>
                  <p className="text-xs">✓ {f.badge}</p>
                  <button type="button" className="btn text-sm" disabled={busy} onClick={() => onApply(f.patches, f.summary)}>
                    Apply fix
                  </button>
                </div>
              ))}
              {r.fix.noApplyReason && !r.fix.tested?.length && <p className="text-ink/70">{r.fix.noApplyReason}</p>}
            </dd>
          </>
        )}
      </dl>

      {r.assumptions?.map((a) => <AssumptionLine key={a} id={a} />)}

      {r.question && r.status === "needs_answer" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{r.question.prompt}</p>
          <button type="button" className="btn text-sm" disabled={busy} onClick={() => onAnswer(r.question!.answerKey, "yes", r.question!.prompt)}>Yes</button>
          <button type="button" className="btn btn-ghost text-sm" disabled={busy} onClick={() => onAnswer(r.question!.answerKey, "no", r.question!.prompt)}>No</button>
        </div>
      )}

      {isAmber && (
        <div className="rounded border border-warn/40 p-3 text-sm space-y-2">
          {acknowledgedBy ? (
            <p>
              ✓ Acknowledged by <strong>{acknowledgedBy.name}</strong> on {new Date(acknowledgedBy.at).toLocaleString("en-GB")}.{" "}
              <button type="button" className="underline" disabled={busy} onClick={() => onUnacknowledge(r.id)}>Undo</button>
            </p>
          ) : (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) onAcknowledge(r.id, name.trim());
              }}
            >
              <label className="flex items-center gap-2">
                <input type="checkbox" required /> I understand this risk and want to continue
              </label>
              <input className="border border-ink/30 rounded px-2 py-1" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
              <button type="submit" className="btn btn-ghost text-sm" disabled={busy}>Acknowledge</button>
            </form>
          )}
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Why?</summary>
        <div className="mt-2 space-y-2">
          <p><span className="font-semibold">Formula:</span> {r.why.formula}</p>
          {r.why.inputs.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left"><th className="pr-2">Input</th><th className="pr-2">Value</th><th className="pr-2">Source</th><th>Where</th></tr>
              </thead>
              <tbody>
                {r.why.inputs.map((i, n) => (
                  <tr key={n} className="border-t border-ink/10">
                    <td className="pr-2">{i.label}</td>
                    <td className="pr-2">{i.value}</td>
                    <td className="pr-2">{i.source ?? "—"}</td>
                    <td>{locationText(i.location, i.sku) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p><span className="font-semibold">Result:</span> {r.why.result}</p>
        </div>
      </details>
    </article>
  );
}

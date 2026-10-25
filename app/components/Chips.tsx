export function Chips({ chips }: { chips: string[] }) {
  if (!chips.length) return null;
  return (
    <div role="status" className="flex flex-wrap gap-2">
      {chips.map((c, i) => (
        <code key={i} className="rounded bg-accent/50 border border-ink/20 px-2 py-0.5 text-xs">{c}</code>
      ))}
    </div>
  );
}

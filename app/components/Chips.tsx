export function Chips({ chips }: { chips: string[] }) {
  if (!chips.length) return null;
  return (
    <div role="status" className="flex flex-wrap gap-2">
      {chips.map((c, i) => (
        <code key={i} className="mono rounded-full bg-accent-soft text-accent-ink border border-accent/20 px-2.5 py-0.5 text-[11.5px] font-semibold">{c}</code>
      ))}
    </div>
  );
}

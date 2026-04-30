type CardRow = {
  id: string;
  playerName: string;
  cardNumber: string;
  variation: string | null;
};

type Group = {
  team: string;
  cards: CardRow[];
};

export default function CardListBoard({ groups }: { groups: Group[] }) {
  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const counts = countByVariation(g.cards);
        return (
          <section
            key={g.team}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-ink px-5 py-3 text-white">
              <h3 className="text-base font-bold tracking-tight-2">{g.team}</h3>
              <div className="text-[11px] font-semibold uppercase tracking-tight-2 text-white/70">
                {g.cards.length} {g.cards.length === 1 ? "card" : "cards"}
                {counts.label && <span> · {counts.label}</span>}
              </div>
            </header>
            <ul>
              {g.cards.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-2.5 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm">
                      <span className="font-mono text-[11px] font-bold text-slate-400">
                        #{c.cardNumber}
                      </span>{" "}
                      <span className="font-semibold">{c.playerName}</span>
                    </div>
                  </div>
                  {c.variation && (
                    <span className="rounded bg-bone px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight-2 text-slate-600">
                      {c.variation}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function countByVariation(cards: CardRow[]): { label: string } {
  const buckets = new Map<string, number>();
  for (const c of cards) {
    const key = c.variation ?? "base";
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
    parts.push(`${v} ${k}`);
  }
  return { label: parts.join(" · ") };
}

export type Format = {
  id: string;
  name: string;
  packsPerBox: number | null;
  cardsPerPack: number | null;
  autosPerBox: number | null;
  notes: string | null;
};

/** Renderable summary lines for a format — only the parts with data. */
export function statsFor(f: Format): string[] {
  const out: string[] = [];
  if (f.packsPerBox != null && f.cardsPerPack != null) {
    out.push(
      `${f.packsPerBox} × ${f.cardsPerPack} = ${f.packsPerBox * f.cardsPerPack} cards/box`,
    );
  } else if (f.packsPerBox != null) {
    out.push(`${f.packsPerBox} packs/box`);
  } else if (f.cardsPerPack != null) {
    out.push(`${f.cardsPerPack} cards/pack`);
  }
  if (f.autosPerBox != null) out.push(`${f.autosPerBox} autos/box`);
  return out;
}

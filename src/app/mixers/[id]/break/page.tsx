import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER_ID } from "@/lib/user";
import {
  PROSPECTS_BUCKET,
  bucketTeam,
  canonicalTeamsForSport,
} from "@/lib/sports";
import CardListBoard from "@/app/products/[id]/break/CardListBoard";
import MixerTeamPicker from "./MixerTeamPicker";

export const dynamic = "force-dynamic";

function MixerBreakHeader({
  mixerId,
  name,
  subtitle,
}: {
  mixerId: string;
  name: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <Link
        href={`/mixers/${mixerId}`}
        className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
      >
        ← Back to mixer
      </Link>
      <div className="mt-2 text-[11px] font-bold uppercase tracking-tight-2 text-accent">
        Mixer Break
      </div>
      <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight-3">
        {name}
      </h1>
      {subtitle && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

function buildPickerTeams(
  sports: string[],
  productTeams: string[],
): { teams: string[] } {
  // For mixers, take the union of canonical teams across all sports
  // represented in the mixer's products. In practice this is almost always
  // a single sport (KKSPORTSCARDS' Topps Black + Bowman Draft + Definitive
  // = all MLB → 30 MLB teams).
  const canonicalSet = new Set<string>();
  for (const sport of sports) {
    for (const team of canonicalTeamsForSport(sport)) canonicalSet.add(team);
  }
  if (canonicalSet.size === 0) {
    return { teams: productTeams };
  }
  // Pick the first sport's canonical order so the UI is deterministic
  const teams = Array.from(canonicalSet);
  // Add Prospects bucket if any card's team doesn't match canonical
  const hasProspects = productTeams.some(
    (t) =>
      !sports.some((sport) => canonicalTeamsForSport(sport).includes(t)) &&
      bucketTeam(sports[0] ?? "", t) === PROSPECTS_BUCKET,
  );
  if (hasProspects) teams.push(PROSPECTS_BUCKET);
  return { teams };
}

export default async function MixerBreakPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mixer = await prisma.mixer.findUnique({
    where: { id },
    include: {
      products: {
        include: { product: { select: { sport: true } } },
      },
    },
  });
  if (!mixer) notFound();

  const productIds = mixer.products.map((p) => p.productId);
  if (productIds.length === 0) {
    return (
      <div className="space-y-6">
        <MixerBreakHeader
          mixerId={id}
          name={mixer.name}
          subtitle="No products in this mixer yet."
        />
      </div>
    );
  }

  const sports = Array.from(
    new Set(mixer.products.map((p) => p.product.sport)),
  );

  const allCards = await prisma.card.findMany({
    where: { productId: { in: productIds } },
    select: {
      team: true,
      playerName: true,
      cardNumber: true,
      variation: true,
      marketValueCents: true,
      product: { select: { name: true } },
    },
    orderBy: [{ team: "asc" }, { cardNumber: "asc" }],
  });

  const productTeams = Array.from(new Set(allCards.map((c) => c.team)));
  const { teams: pickerTeams } = buildPickerTeams(sports, productTeams);

  const userPick = await prisma.mixerPick.findUnique({
    where: { mixerId_userId: { mixerId: id, userId: CURRENT_USER_ID } },
  });

  if (!userPick) {
    return (
      <div className="space-y-6">
        <MixerBreakHeader
          mixerId={id}
          name={mixer.name}
          subtitle="Pick the teams you bought into. You can change this later."
        />
        <MixerTeamPicker
          mixerId={id}
          allTeams={pickerTeams}
          initialSelected={[]}
        />
      </div>
    );
  }

  const teamsOwned = JSON.parse(userPick.teamsOwned) as string[];

  // Group cards into the picked team buckets. Each pick can be a canonical
  // team (matched against card.team) or PROSPECTS_BUCKET (matches anything
  // not in any canonical sport list).
  const sport0 = sports[0] ?? "";
  const grouped = teamsOwned.map((picked) => {
    if (picked === PROSPECTS_BUCKET) {
      return {
        team: PROSPECTS_BUCKET,
        cards: allCards
          .filter(
            (c) =>
              !sports.some((s) =>
                canonicalTeamsForSport(s).includes(c.team),
              ) && bucketTeam(sport0, c.team) === PROSPECTS_BUCKET,
          )
          .map((c) => ({
            id: `${c.product.name}-${c.cardNumber}`,
            playerName: c.playerName,
            cardNumber: c.cardNumber,
            variation: c.variation,
            marketValueCents: c.marketValueCents,
          })),
      };
    }
    return {
      team: picked,
      cards: allCards
        .filter((c) => c.team === picked)
        .map((c) => ({
          id: `${c.product.name}-${c.cardNumber}`,
          playerName: c.playerName,
          cardNumber: c.cardNumber,
          variation: c.variation,
          marketValueCents: c.marketValueCents,
        })),
    };
  });

  const totalCards = grouped.reduce((s, g) => s + g.cards.length, 0);

  return (
    <div className="space-y-6">
      <MixerBreakHeader
        mixerId={id}
        name={mixer.name}
        subtitle={`${teamsOwned.length} ${teamsOwned.length === 1 ? "team" : "teams"} · ${totalCards} cards across ${productIds.length} products`}
      />
      <details className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-tight-2 text-slate-500">
          Edit teams
        </summary>
        <div className="mt-3">
          <MixerTeamPicker
            mixerId={id}
            allTeams={pickerTeams}
            initialSelected={teamsOwned}
          />
        </div>
      </details>
      <CardListBoard groups={grouped} />
    </div>
  );
}

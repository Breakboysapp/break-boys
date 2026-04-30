import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CURRENT_USER_ID } from "@/lib/user";
import {
  PROSPECTS_BUCKET,
  bucketTeam,
  canonicalTeamsForSport,
} from "@/lib/sports";
import TeamPicker from "./TeamPicker";
import CardListBoard from "./CardListBoard";

export const dynamic = "force-dynamic";

function BreakHeader({
  productId,
  name,
  subtitle,
}: {
  productId: string;
  name: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <Link
        href={`/products/${productId}`}
        className="text-[11px] font-bold uppercase tracking-tight-2 text-slate-500 hover:text-ink"
      >
        ← Back to product
      </Link>
      <div className="mt-2 text-[11px] font-bold uppercase tracking-tight-2 text-accent">
        Your Break
      </div>
      <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight-3">
        {name}
      </h1>
      {subtitle && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

/**
 * Build the picker's team list from the canonical sport league.
 *
 * - For sports we have canonical lists for (NFL, NBA, MLB, NHL): start with
 *   the league's full team set so the picker is always 30/32 entries even
 *   if some teams have no cards in this product. Append "Prospects / Other"
 *   if any of the product's actual cards bucket into it (Bowman college
 *   teams, malformed rows, etc.) so those slots are still pickable.
 * - For sports without a canonical list (Soccer, Other): fall back to the
 *   product's distinct team field as before.
 */
function buildPickerTeams(
  sport: string,
  productTeams: string[],
): { teams: string[]; hasProspects: boolean } {
  const canonical = canonicalTeamsForSport(sport);
  if (canonical.length === 0) {
    return { teams: productTeams, hasProspects: false };
  }
  const buckets = new Set(productTeams.map((t) => bucketTeam(sport, t)));
  const hasProspects = buckets.has(PROSPECTS_BUCKET);
  const teams = [...canonical];
  if (hasProspects) teams.push(PROSPECTS_BUCKET);
  return { teams, hasProspects };
}

export default async function BreakPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      teamPrices: { orderBy: { team: "asc" } },
    },
  });
  if (!product) notFound();

  const userBreak = await prisma.userBreak.findFirst({
    where: { userId: CURRENT_USER_ID, productId: id },
  });

  const productTeams = product.teamPrices.map((p) => p.team);
  const { teams: pickerTeams } = buildPickerTeams(product.sport, productTeams);

  if (productTeams.length === 0) {
    return (
      <div className="space-y-6">
        <BreakHeader
          productId={id}
          name={product.name}
          subtitle="Upload a checklist first so we know what teams are in this product."
        />
      </div>
    );
  }

  if (!userBreak) {
    return (
      <div className="space-y-6">
        <BreakHeader
          productId={id}
          name={product.name}
          subtitle="Pick the teams you bought into. You can change this later."
        />
        <TeamPicker productId={id} allTeams={pickerTeams} initialSelected={[]} />
      </div>
    );
  }

  const teamsOwned = JSON.parse(userBreak.teamsOwned) as string[];

  // For each picked picker-team, collect the cards that fall into that bucket.
  // Canonical teams match cards directly by team name; the Prospects bucket
  // catches everything that isn't a canonical match.
  const wantsProspects = teamsOwned.includes(PROSPECTS_BUCKET);
  const wantedCanonicals = teamsOwned.filter((t) => t !== PROSPECTS_BUCKET);
  const allCards = await prisma.card.findMany({
    where: { productId: id },
    orderBy: [{ team: "asc" }, { cardNumber: "asc" }],
  });

  const grouped = teamsOwned.map((picked) => {
    if (picked === PROSPECTS_BUCKET) {
      return {
        team: PROSPECTS_BUCKET,
        cards: allCards.filter(
          (c) => bucketTeam(product.sport, c.team) === PROSPECTS_BUCKET,
        ),
      };
    }
    return { team: picked, cards: allCards.filter((c) => c.team === picked) };
  });

  const totalCards = grouped.reduce((s, g) => s + g.cards.length, 0);

  // Suppress unused-warn while keeping the variable for future filtering.
  void wantsProspects;
  void wantedCanonicals;

  return (
    <div className="space-y-6">
      <BreakHeader
        productId={id}
        name={product.name}
        subtitle={`${teamsOwned.length} ${teamsOwned.length === 1 ? "team" : "teams"} · ${totalCards} cards`}
      />
      <details className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-tight-2 text-slate-500">
          Edit teams
        </summary>
        <div className="mt-3">
          <TeamPicker
            productId={id}
            allTeams={pickerTeams}
            initialSelected={teamsOwned}
          />
        </div>
      </details>
      <CardListBoard groups={grouped} />
    </div>
  );
}

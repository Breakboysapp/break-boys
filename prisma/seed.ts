import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_PRODUCT_NAME = "2024 Topps Chrome Baseball";

async function main() {
  const existing = await prisma.product.findFirst({
    where: { name: SEED_PRODUCT_NAME },
  });
  if (existing) {
    console.log(`Seed: ${SEED_PRODUCT_NAME} already present, skipping.`);
    return;
  }

  const cards: Array<{
    team: string;
    playerName: string;
    cardNumber: string;
    variation?: string;
  }> = [
    { team: "Yankees", playerName: "Aaron Judge", cardNumber: "1" },
    { team: "Yankees", playerName: "Juan Soto", cardNumber: "2" },
    { team: "Yankees", playerName: "Anthony Volpe", cardNumber: "3", variation: "Refractor" },
    { team: "Yankees", playerName: "Gerrit Cole", cardNumber: "4" },
    { team: "Yankees", playerName: "Jasson Dominguez", cardNumber: "5", variation: "Rookie" },
    { team: "Dodgers", playerName: "Shohei Ohtani", cardNumber: "10" },
    { team: "Dodgers", playerName: "Mookie Betts", cardNumber: "11" },
    { team: "Dodgers", playerName: "Freddie Freeman", cardNumber: "12" },
    { team: "Dodgers", playerName: "Tyler Glasnow", cardNumber: "13", variation: "Refractor" },
    { team: "Dodgers", playerName: "Yoshinobu Yamamoto", cardNumber: "14", variation: "Rookie" },
    { team: "Braves", playerName: "Ronald Acuna Jr.", cardNumber: "20" },
    { team: "Braves", playerName: "Matt Olson", cardNumber: "21" },
    { team: "Braves", playerName: "Spencer Strider", cardNumber: "22" },
    { team: "Braves", playerName: "Austin Riley", cardNumber: "23" },
    { team: "Braves", playerName: "Sean Murphy", cardNumber: "24" },
    { team: "Orioles", playerName: "Gunnar Henderson", cardNumber: "30" },
    { team: "Orioles", playerName: "Adley Rutschman", cardNumber: "31" },
    { team: "Orioles", playerName: "Jackson Holliday", cardNumber: "32", variation: "Rookie" },
    { team: "Orioles", playerName: "Colton Cowser", cardNumber: "33", variation: "Rookie" },
    { team: "Orioles", playerName: "Grayson Rodriguez", cardNumber: "34" },
    { team: "Padres", playerName: "Fernando Tatis Jr.", cardNumber: "40" },
    { team: "Padres", playerName: "Manny Machado", cardNumber: "41" },
    { team: "Padres", playerName: "Xander Bogaerts", cardNumber: "42" },
    { team: "Padres", playerName: "Jackson Merrill", cardNumber: "43", variation: "Rookie" },
    { team: "Padres", playerName: "Yu Darvish", cardNumber: "44" },
  ];

  const product = await prisma.product.create({
    data: {
      name: SEED_PRODUCT_NAME,
      sport: "MLB",
      releaseDate: new Date("2024-08-21"),
      source: "manual",
      cards: { create: cards },
    },
  });

  const teamPriceData = [
    { team: "Yankees", wholesale: 4500, retail: 6500 },
    { team: "Dodgers", wholesale: 5000, retail: 7000 },
    { team: "Braves", wholesale: 3800, retail: 5500 },
    { team: "Orioles", wholesale: 3200, retail: 4500 },
    { team: "Padres", wholesale: 2800, retail: 4000 },
  ];

  await prisma.teamPrice.createMany({
    data: teamPriceData.map((t) => ({
      productId: product.id,
      team: t.team,
      wholesaleCents: t.wholesale,
      retailCents: t.retail,
    })),
  });

  console.log(`Seeded ${SEED_PRODUCT_NAME} with ${cards.length} cards.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

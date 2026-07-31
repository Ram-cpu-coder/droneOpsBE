import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import "dotenv/config";
import pg from "pg";
import { defaultDroneModelCatalog } from "../src/constants/droneCatalogSeed.js";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const seedDroneCatalog = async () => {
  const now = new Date();

  for (const item of defaultDroneModelCatalog) {
    await prisma.droneModelCatalog.upsert({
      where: {
        manufacturer_model: {
          manufacturer: item.manufacturer,
          model: item.model
        }
      },
      update: {
        batteryType: item.batteryType,
        telemetryProvider: item.telemetryProvider,
        category: item.category,
        sourceUrl: item.sourceUrl,
        isActive: true,
        lastVerifiedAt: now
      },
      create: {
        ...item,
        isActive: true,
        lastVerifiedAt: now
      }
    });
  }
};

const backfillOrganisationJoinCodes = async () => {
  const organisations = await prisma.organisation.findMany({
    where: { joinCode: null },
    select: { id: true }
  });

  for (const organisation of organisations) {
    await prisma.organisation.update({
      where: { id: organisation.id },
      data: { joinCode: await generateUniqueOrganisationJoinCode() }
    });
  }

  return organisations.length;
};

const generateUniqueOrganisationJoinCode = async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `ORG-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const existing = await prisma.organisation.findUnique({ where: { joinCode: code }, select: { id: true } });
    if (!existing) return code;
  }

  return `ORG-${Date.now().toString(36).toUpperCase()}`;
};

try {
  await seedDroneCatalog();
  const organisationCodeCount = await backfillOrganisationJoinCodes();
  console.log(`Seeded ${defaultDroneModelCatalog.length} drone catalog models`);
  console.log(`Backfilled ${organisationCodeCount} organisation join codes`);
} finally {
  await prisma.$disconnect();
  await pool.end();
}

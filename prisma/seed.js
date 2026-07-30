import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
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

try {
  await seedDroneCatalog();
  console.log(`Seeded ${defaultDroneModelCatalog.length} drone catalog models`);
} finally {
  await prisma.$disconnect();
  await pool.end();
}

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseUrl
    ? { rejectUnauthorized: env.databaseSslRejectUnauthorized }
    : undefined
});
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  log: env.prismaQueryLogEnabled ? ["query", "warn", "error"] : ["warn", "error"]
});

export const disconnectPrisma = async () => {
  await prisma.$disconnect();
  await pool.end();
};

import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { defaultDroneModelCatalog } from "../constants/droneCatalogSeed.js";

const catalogOrder = [
  { manufacturer: "asc" },
  { model: "asc" }
];

export const listDroneModelCatalog = async ({ includeInactive = false } = {}) => {
  await ensureDefaultCatalog();

  const rows = await prisma.droneModelCatalog.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: catalogOrder
  });

  return groupCatalogRows(rows);
};

export const findDroneModel = async (manufacturer, model) => {
  if (!manufacturer || !model) return null;
  await ensureDefaultCatalog();

  return prisma.droneModelCatalog.findFirst({
    where: {
      manufacturer,
      model,
      isActive: true
    }
  });
};

const ensureDefaultCatalog = async () => {
  const activeCount = await prisma.droneModelCatalog.count({ where: { isActive: true } });
  if (activeCount > 0) return;

  const now = new Date();
  await prisma.$transaction(
    defaultDroneModelCatalog.map((item) => (
      prisma.droneModelCatalog.upsert({
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
      })
    ))
  );
};

export const createDroneModel = async (data) => {
  return prisma.droneModelCatalog.create({
    data: toCatalogData(data)
  });
};

export const updateDroneModel = async (id, data) => {
  await ensureDroneModelExists(id);

  return prisma.droneModelCatalog.update({
    where: { id },
    data: toCatalogData(data)
  });
};

export const removeDroneModel = async (id) => {
  await ensureDroneModelExists(id);

  return prisma.droneModelCatalog.update({
    where: { id },
    data: { isActive: false }
  });
};

const ensureDroneModelExists = async (id) => {
  const droneModel = await prisma.droneModelCatalog.findUnique({ where: { id } });
  if (!droneModel) throw new AppError("Drone model not found", 404, "DRONE_MODEL_NOT_FOUND");
  return droneModel;
};

const toCatalogData = (data) => ({
  manufacturer: data.manufacturer,
  model: data.model,
  batteryType: data.batteryType,
  telemetryProvider: data.telemetryProvider ?? "NONE",
  category: data.category,
  sourceUrl: data.sourceUrl,
  isActive: data.isActive ?? true,
  lastVerifiedAt: data.lastVerifiedAt ? new Date(data.lastVerifiedAt) : undefined
});

const groupCatalogRows = (rows) => {
  const groups = new Map();

  rows.forEach((row) => {
    if (!groups.has(row.manufacturer)) {
      groups.set(row.manufacturer, {
        manufacturer: row.manufacturer,
        telemetryProvider: row.telemetryProvider,
        models: []
      });
    }

    groups.get(row.manufacturer).models.push({
      id: row.id,
      model: row.model,
      batteryType: row.batteryType,
      telemetryProvider: row.telemetryProvider,
      category: row.category,
      sourceUrl: row.sourceUrl,
      isActive: row.isActive,
      lastVerifiedAt: row.lastVerifiedAt
    });
  });

  return Array.from(groups.values());
};

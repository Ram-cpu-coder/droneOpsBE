import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";

const catalogOrder = [
  { manufacturer: "asc" },
  { model: "asc" }
];

export const listDroneModelCatalog = async ({ includeInactive = false } = {}) => {
  const rows = await prisma.droneModelCatalog.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: catalogOrder
  });

  return groupCatalogRows(rows);
};

export const findDroneModel = async (manufacturer, model) => {
  if (!manufacturer || !model) return null;

  return prisma.droneModelCatalog.findFirst({
    where: {
      manufacturer,
      model,
      isActive: true
    }
  });
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

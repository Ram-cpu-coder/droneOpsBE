import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { findDroneModel } from "./droneCatalog.service.js";

const assignableStatuses = ["AVAILABLE"];

export const listDrones = (organisationId) => {
  return prisma.drone.findMany({
    where: { organisationId },
    orderBy: { createdAt: "desc" }
  });
};

export const createDrone = async (organisationId, data) => {
  const catalogModel = await findDroneModel(data.manufacturer, data.model);
  if (!catalogModel) {
    throw new AppError("Select a supported manufacturer and model from the DroneOps catalog", 400, "UNSUPPORTED_DRONE_MODEL");
  }

  const telemetryProvider = data.telemetryProvider && data.telemetryProvider !== "NONE"
    ? data.telemetryProvider
    : catalogModel.telemetryProvider;
  const droneCode = data.droneCode || await generateDroneCode(organisationId);

  return prisma.drone.create({
    data: {
      organisationId,
      droneCode,
      model: catalogModel.model,
      manufacturer: catalogModel.manufacturer,
      serialNumber: data.serialNumber,
      batteryType: catalogModel.batteryType,
      firmwareVersion: data.firmwareVersion,
      status: data.status,
      flightHours: data.flightHours,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
      lastMaintenanceDate: data.lastMaintenanceDate ? new Date(data.lastMaintenanceDate) : undefined,
      nextMaintenanceDate: data.nextMaintenanceDate ? new Date(data.nextMaintenanceDate) : undefined,
      inspectionThresholdHours: data.inspectionThresholdHours,
      certificationStatus: data.certificationStatus,
      certificationReference: data.certificationReference,
      certificationExpiry: data.certificationExpiry ? new Date(data.certificationExpiry) : undefined,
      remoteId: data.remoteId,
      telemetryProvider,
      externalDeviceId: data.externalDeviceId,
      connectorConfig: data.connectorConfig,
      connectorStatus: telemetryProvider !== "NONE" && data.externalDeviceId ? "CONFIGURED" : "NOT_CONFIGURED"
    }
  });
};

export const updateDrone = async (organisationId, id, data) => {
  await ensureDroneExists(organisationId, id);
  const updateData = { ...data };

  if (data.manufacturer || data.model) {
    const currentDrone = await ensureDroneExists(organisationId, id);
    const manufacturer = data.manufacturer ?? currentDrone.manufacturer;
    const model = data.model ?? currentDrone.model;
    const catalogModel = await findDroneModel(manufacturer, model);

    if (!catalogModel) {
      throw new AppError("Select a supported manufacturer and model from the DroneOps catalog", 400, "UNSUPPORTED_DRONE_MODEL");
    }

    updateData.manufacturer = catalogModel.manufacturer;
    updateData.model = catalogModel.model;
    updateData.batteryType = catalogModel.batteryType;
    if (!data.telemetryProvider || data.telemetryProvider === "NONE") {
      updateData.telemetryProvider = catalogModel.telemetryProvider;
    }
  }

  return prisma.drone.update({ where: { id }, data: updateData });
};

export const deleteDrone = async (organisationId, id) => {
  await ensureDroneExists(organisationId, id);
  return prisma.drone.delete({ where: { id } });
};

export const ensureDroneAssignable = async (organisationId, droneId) => {
  const drone = await ensureDroneExists(organisationId, droneId);
  if (!assignableStatuses.includes(drone.status)) {
    throw new AppError(`Drone ${drone.droneCode} is not available for mission assignment`, 409, "DRONE_NOT_ASSIGNABLE");
  }
  return drone;
};

export const groundDrone = async (organisationId, droneId, reason) => {
  return prisma.drone.update({
    where: { id: droneId },
    data: {
      status: "GROUNDED",
      defects: {
        create: {
          organisationId,
          title: reason,
          severity: "CRITICAL"
        }
      }
    }
  });
};

export const ensureDroneExists = async (organisationId, id) => {
  const drone = await prisma.drone.findFirst({ where: { id, organisationId } });
  if (!drone) throw new AppError("Drone not found", 404, "DRONE_NOT_FOUND");
  return drone;
};

const resolveTelemetryProvider = (data) => {
  if (data.telemetryProvider && data.telemetryProvider !== "NONE") return data.telemetryProvider;

  const manufacturer = data.manufacturer?.toLowerCase() ?? "";
  if (manufacturer.includes("dji")) return "DJI";
  if (manufacturer.includes("autel")) return "AUTEL";
  if (manufacturer.includes("px4") || manufacturer.includes("ardupilot") || manufacturer.includes("mavlink")) return "MAVLINK";

  return "NONE";
};

const generateDroneCode = async (organisationId) => {
  const count = await prisma.drone.count({ where: { organisationId } });

  for (let index = count + 1; index < count + 1000; index += 1) {
    const candidate = `DRN-${String(index).padStart(3, "0")}`;
    const existing = await prisma.drone.findFirst({
      where: {
        organisationId,
        droneCode: candidate
      },
      select: { id: true }
    });

    if (!existing) return candidate;
  }

  return `DRN-${Date.now().toString().slice(-6)}`;
};

import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { findDroneModel } from "./droneCatalog.service.js";

const assignableStatuses = ["AVAILABLE"];
const DRONE_STATUS_SYNC_TTL_MS = 5000;
const droneStatusSyncState = new Map();

export const listDrones = async (organisationId) => {
  await syncMissionDroneStatuses(organisationId);

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
  const externalDeviceId = telemetryProvider === "NONE" ? null : data.externalDeviceId;

  validateDroneUpdateState({ ...data, telemetryProvider, externalDeviceId });
  await ensureExternalDeviceIdAvailable(organisationId, externalDeviceId, telemetryProvider);

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
      externalDeviceId,
      connectorConfig: data.connectorConfig,
      connectorStatus: telemetryProvider !== "NONE" && externalDeviceId ? "CONFIGURED" : "NOT_CONFIGURED"
    }
  });
};

export const updateDrone = async (organisationId, id, data) => {
  const currentDrone = await ensureDroneExists(organisationId, id);
  const updateData = normalizeDroneDates({ ...data });

  if (data.manufacturer || data.model) {
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

  const mergedDrone = { ...currentDrone, ...updateData };
  if (mergedDrone.telemetryProvider === "NONE") {
    updateData.externalDeviceId = null;
    mergedDrone.externalDeviceId = null;
  }

  validateDroneUpdateState(mergedDrone);
  await ensureExternalDeviceIdAvailable(organisationId, mergedDrone.externalDeviceId, mergedDrone.telemetryProvider, id);

  if ("telemetryProvider" in updateData || "externalDeviceId" in updateData) {
    updateData.connectorStatus = mergedDrone.telemetryProvider !== "NONE" && mergedDrone.externalDeviceId
      ? "CONFIGURED"
      : "NOT_CONFIGURED";
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

export const syncMissionDroneStatuses = async (organisationId, options = {}) => {
  const state = droneStatusSyncState.get(organisationId);
  const now = Date.now();

  if (!options.force) {
    if (state?.promise) return state.promise;
    if (state?.lastSyncedAt && now - state.lastSyncedAt < DRONE_STATUS_SYNC_TTL_MS) {
      return state.activeDroneIds ?? [];
    }
  }

  const syncPromise = syncMissionDroneStatusesNow(organisationId)
    .then((activeDroneIds) => {
      droneStatusSyncState.set(organisationId, {
        activeDroneIds,
        lastSyncedAt: Date.now(),
        promise: null
      });
      return activeDroneIds;
    })
    .catch((error) => {
      droneStatusSyncState.delete(organisationId);
      throw error;
    });

  droneStatusSyncState.set(organisationId, {
    activeDroneIds: state?.activeDroneIds ?? [],
    lastSyncedAt: state?.lastSyncedAt ?? 0,
    promise: syncPromise
  });

  return syncPromise;
};

const syncMissionDroneStatusesNow = async (organisationId) => {
  const activeMissionDrones = await prisma.mission.findMany({
    where: {
      organisationId,
      status: "ACTIVE"
    },
    select: {
      droneId: true,
      droneAssignments: { select: { droneId: true } }
    }
  });

  const activeDroneIds = [...new Set(activeMissionDrones.flatMap((mission) => [
    mission.droneId,
    ...mission.droneAssignments.map((assignment) => assignment.droneId)
  ]).filter(Boolean))];

  if (activeDroneIds.length) {
    await prisma.drone.updateMany({
      where: {
        organisationId,
        id: { in: activeDroneIds },
        status: "AVAILABLE"
      },
      data: { status: "IN_MISSION" }
    });
  }

  await prisma.drone.updateMany({
    where: {
      organisationId,
      status: "IN_MISSION",
      ...(activeDroneIds.length ? { id: { notIn: activeDroneIds } } : {})
    },
    data: { status: "AVAILABLE" }
  });

  return activeDroneIds;
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

const normalizeDroneDates = (data) => {
  ["purchaseDate", "lastMaintenanceDate", "nextMaintenanceDate", "certificationExpiry"].forEach((field) => {
    if (data[field]) data[field] = new Date(data[field]);
  });

  return data;
};

const validateDroneUpdateState = (drone) => {
  const today = startOfToday();
  const purchaseDate = toDate(drone.purchaseDate);
  const lastMaintenanceDate = toDate(drone.lastMaintenanceDate);
  const nextMaintenanceDate = toDate(drone.nextMaintenanceDate);
  const certificationExpiry = toDate(drone.certificationExpiry);

  if (purchaseDate && purchaseDate > today) {
    throw new AppError("Purchase date cannot be in the future", 400, "INVALID_DRONE_DATES");
  }

  if (lastMaintenanceDate && lastMaintenanceDate > today) {
    throw new AppError("Last maintenance date cannot be in the future", 400, "INVALID_DRONE_DATES");
  }

  if (purchaseDate && lastMaintenanceDate && lastMaintenanceDate < purchaseDate) {
    throw new AppError("Last maintenance date cannot be before purchase date", 400, "INVALID_DRONE_DATES");
  }

  if (lastMaintenanceDate && nextMaintenanceDate && nextMaintenanceDate < lastMaintenanceDate) {
    throw new AppError("Next inspection due cannot be before last maintenance date", 400, "INVALID_DRONE_DATES");
  }

  if (drone.certificationStatus === "CERTIFIED" && !drone.certificationReference) {
    throw new AppError("Certification reference is required for certified drones", 400, "INVALID_DRONE_CERTIFICATION");
  }

  if (drone.certificationStatus === "CERTIFIED" && !certificationExpiry) {
    throw new AppError("Certification expiry is required for certified drones", 400, "INVALID_DRONE_CERTIFICATION");
  }

  if (drone.certificationStatus === "CERTIFIED" && certificationExpiry && certificationExpiry < today) {
    throw new AppError("Expired certification cannot be marked certified", 400, "INVALID_DRONE_CERTIFICATION");
  }

  if (drone.status === "AVAILABLE" && drone.certificationStatus !== "CERTIFIED") {
    throw new AppError("Only certified drones can be marked available", 400, "INVALID_DRONE_STATUS");
  }

  if (drone.status === "AVAILABLE" && certificationExpiry && certificationExpiry < today) {
    throw new AppError("A drone with expired certification cannot be marked available", 400, "INVALID_DRONE_STATUS");
  }

  if (drone.telemetryProvider && drone.telemetryProvider !== "NONE" && !drone.externalDeviceId) {
    throw new AppError("Vendor drone/device ID is required when a telemetry connector is selected", 400, "INVALID_DRONE_TELEMETRY");
  }
};

const ensureExternalDeviceIdAvailable = async (organisationId, externalDeviceId, telemetryProvider, currentDroneId = null) => {
  if (!externalDeviceId || !telemetryProvider || telemetryProvider === "NONE") return;

  const existing = await prisma.drone.findFirst({
    where: {
      externalDeviceId,
      telemetryProvider: { not: "NONE" },
      ...(currentDroneId ? { id: { not: currentDroneId } } : {})
    },
    select: { droneCode: true, organisationId: true }
  });

  if (existing) {
    const sameOrganisation = existing.organisationId === organisationId;
    throw new AppError(
      sameOrganisation
        ? `External device ID ${externalDeviceId} is already connected to ${existing.droneCode}`
        : "External device ID is already connected to another DroneOps organisation",
      409,
      "DUPLICATE_EXTERNAL_DEVICE_ID"
    );
  }
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

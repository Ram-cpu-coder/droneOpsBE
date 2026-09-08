import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { findDroneModel } from "./droneCatalog.service.js";
import { nextDisplayCode } from "./displaySequence.service.js";

const assignableStatuses = ["AVAILABLE"];
const DRONE_STATUS_SYNC_TTL_MS = 5000;
const droneStatusSyncState = new Map();

export const listDrones = async (organisationId) => {
  await syncMissionDroneStatuses(organisationId);

  const drones = await prisma.drone.findMany({
    where: { organisationId },
    orderBy: { createdAt: "desc" }
  });

  return attachMaintenanceState(organisationId, await attachMissionSummaries(organisationId, drones));
};

export const createDrone = async (organisationId, data) => {
  const catalogModel = await findDroneModel(data.manufacturer, data.model);
  if (!catalogModel) {
    throw new AppError("Select a supported manufacturer and model from the DroneOps catalog", 400, "UNSUPPORTED_DRONE_MODEL");
  }

  const telemetryProvider = data.telemetryProvider !== undefined
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
    if (data.telemetryProvider === undefined) {
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
  if (drone.certificationStatus !== "CERTIFIED") {
    throw new AppError(`Drone ${drone.droneCode} needs approved certification before mission assignment`, 409, "DRONE_CERTIFICATION_REQUIRED");
  }

  const certificationExpiry = toDate(drone.certificationExpiry);
  if (!certificationExpiry) {
    throw new AppError(`Drone ${drone.droneCode} needs a certification expiry date before mission assignment`, 409, "DRONE_CERTIFICATION_REQUIRED");
  }
  if (certificationExpiry < startOfToday()) {
    throw new AppError(`Drone ${drone.droneCode} certification has expired`, 409, "DRONE_CERTIFICATION_EXPIRED");
  }

  if (await hasOverdueMaintenance(organisationId, drone)) {
    throw new AppError(`Drone ${drone.droneCode} is overdue for maintenance and cannot be assigned`, 409, "DRONE_MAINTENANCE_OVERDUE");
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

const attachMissionSummaries = async (organisationId, drones) => {
  if (!drones.length) return drones;

  const droneIds = drones.map((drone) => drone.id);
  const missions = await prisma.mission.findMany({
    where: {
      organisationId,
      OR: [
        { droneId: { in: droneIds } },
        { droneAssignments: { some: { droneId: { in: droneIds } } } }
      ]
    },
    select: {
      id: true,
      missionCode: true,
      name: true,
      status: true,
      plannedStartAt: true,
      plannedEndAt: true,
      launchSite: true,
      operatingArea: true,
      plannedRoute: true,
      geofenceConfig: true,
      updatedAt: true,
      droneId: true,
      droneAssignments: { select: { droneId: true } }
    },
    orderBy: { updatedAt: "desc" },
    take: Math.max(droneIds.length * 8, 40)
  });

  const missionsByDroneId = new Map();
  missions.forEach((mission) => {
    const assignedDroneIds = [
      mission.droneId,
      ...mission.droneAssignments.map((assignment) => assignment.droneId)
    ].filter(Boolean);

    assignedDroneIds.forEach((droneId) => {
      if (!missionsByDroneId.has(droneId)) missionsByDroneId.set(droneId, []);
      missionsByDroneId.get(droneId).push(toDroneMissionSummary(mission));
    });
  });

  return drones.map((drone) => {
    const droneMissions = missionsByDroneId.get(drone.id) ?? [];
    return {
      ...drone,
      activeMission: droneMissions.find((mission) => mission.status === "ACTIVE") ?? null,
      lastMission: droneMissions.find((mission) => mission.status !== "ACTIVE") ?? droneMissions[0] ?? null
    };
  });
};

const attachMaintenanceState = async (organisationId, drones) => {
  if (!drones.length) return drones;

  const now = new Date();
  const overdueRecords = await prisma.maintenanceRecord.findMany({
    where: {
      organisationId,
      droneId: { in: drones.map((drone) => drone.id) },
      status: { in: ["SCHEDULED", "IN_PROGRESS", "OVERDUE"] },
      dueAt: { lte: now }
    },
    select: { droneId: true },
    distinct: ["droneId"]
  });
  const overdueIds = new Set(overdueRecords.map(({ droneId }) => droneId));

  return drones.map((drone) => ({
    ...drone,
    lastServicedDate: drone.lastMaintenanceDate,
    maintenanceOverdue: overdueIds.has(drone.id) || Boolean(drone.nextMaintenanceDate && drone.nextMaintenanceDate <= now)
  }));
};

const hasOverdueMaintenance = async (organisationId, drone) => {
  if (drone.nextMaintenanceDate && drone.nextMaintenanceDate <= new Date()) return true;

  const overdueRecord = await prisma.maintenanceRecord.findFirst({
    where: {
      organisationId,
      droneId: drone.id,
      status: { in: ["SCHEDULED", "IN_PROGRESS", "OVERDUE"] },
      dueAt: { lte: new Date() }
    },
    select: { id: true }
  });

  return Boolean(overdueRecord);
};

const toDroneMissionSummary = (mission) => ({
  id: mission.id,
  missionCode: mission.missionCode,
  name: mission.name,
  status: mission.status,
  plannedStartAt: mission.plannedStartAt,
  plannedEndAt: mission.plannedEndAt,
  launchSite: mission.launchSite,
  operatingArea: mission.operatingArea,
  plannedRoute: mission.plannedRoute,
  geofenceConfig: mission.geofenceConfig,
  updatedAt: mission.updatedAt
});

const resolveTelemetryProvider = (data) => {
  if (data.telemetryProvider && data.telemetryProvider !== "NONE") return data.telemetryProvider;

  const manufacturer = data.manufacturer?.toLowerCase() ?? "";
  if (manufacturer.includes("dji")) return "DJI";
  if (manufacturer.includes("autel")) return "AUTEL";
  if (manufacturer.includes("px4") || manufacturer.includes("ardupilot") || manufacturer.includes("mavlink")) return "MAVLINK";

  return "NONE";
};

const generateDroneCode = async (organisationId) => {
  return nextDisplayCode({
    organisationId,
    scope: "DRONE",
    prefix: "DRN",
    width: 3,
    getExistingCodes: async () => (await prisma.drone.findMany({ where: { organisationId }, select: { droneCode: true } })).map(({ droneCode }) => droneCode),
    exists: async (droneCode) => Boolean(await prisma.drone.findFirst({ where: { organisationId, droneCode }, select: { id: true } }))
  });
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

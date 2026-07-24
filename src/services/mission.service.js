import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { ensureDroneAssignable } from "./drone.service.js";

export const listMissions = (organisationId) => {
  return prisma.mission.findMany({
    where: { organisationId },
    include: {
      drone: { select: { id: true, droneCode: true, status: true } },
      pilot: { select: { id: true, name: true, role: true } },
      riskAssessment: true
    },
    orderBy: { createdAt: "desc" }
  });
};

export const createMission = async (organisationId, data, actorRole) => {
  if (data.droneId) await ensureDroneAssignable(organisationId, data.droneId);

  return prisma.mission.create({
    data: {
      organisationId,
      missionCode: data.missionCode,
      name: data.name,
      type: data.type,
      status: isSystemAdministrator(actorRole) ? "APPROVED" : "PLANNED",
      droneId: data.droneId,
      pilotId: data.pilotId,
      plannedRoute: data.plannedRoute,
      geofenceConfig: data.geofenceConfig,
      launchSite: data.launchSite,
      operatingArea: data.operatingArea,
      plannedStartAt: data.plannedStartAt ? new Date(data.plannedStartAt) : undefined,
      plannedEndAt: data.plannedEndAt ? new Date(data.plannedEndAt) : undefined
    }
  });
};

export const updateMission = async (organisationId, id, data, actorRole) => {
  const mission = await ensureMissionExists(organisationId, id);
  const normalizedData = normalizeMissionInput(data);

  if (normalizedData.droneId && normalizedData.droneId !== mission.droneId) {
    await ensureDroneAssignable(organisationId, normalizedData.droneId);
  }

  if (normalizedData.status && normalizedData.status !== mission.status && !isSystemAdministrator(actorRole)) {
    throw new AppError("Only system administrators can change mission status directly", 403, "MISSION_STATUS_ADMIN_ONLY");
  }

  return prisma.$transaction(async (tx) => {
    const updatedMission = await tx.mission.update({
      where: { id },
      data: normalizedData
    });

    if (normalizedData.status && normalizedData.status !== mission.status) {
      await syncMissionDroneStatus(tx, mission, updatedMission.status, updatedMission.droneId);
    }

    return updatedMission;
  });
};

export const approveMission = async (organisationId, id) => {
  const mission = await ensureMissionExists(organisationId, id);
  if (mission.status !== "PLANNED") {
    throw new AppError("Only missions awaiting approval can be approved", 409, "MISSION_NOT_AWAITING_APPROVAL");
  }

  return prisma.mission.update({
    where: { id },
    data: { status: "APPROVED" }
  });
};

export const startMission = async (organisationId, id) => {
  const mission = await prisma.mission.findFirst({
    where: { id, organisationId },
    include: { riskAssessment: true, drone: true, pilot: true }
  });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");
  if (!mission.droneId || !mission.pilotId) throw new AppError("Mission requires drone and pilot assignment", 409, "MISSION_ASSIGNMENT_REQUIRED");
  if (!mission.riskAssessment) throw new AppError("Risk assessment required before activation", 409, "RISK_ASSESSMENT_REQUIRED");
  if (mission.status === "PLANNED") throw new AppError("Mission is awaiting system administrator approval", 409, "MISSION_APPROVAL_REQUIRED");
  if (mission.status !== "APPROVED") throw new AppError("Mission cannot be started from current status", 409, "INVALID_MISSION_STATUS");
  if (mission.drone?.telemetryProvider && mission.drone.telemetryProvider !== "NONE" && !mission.drone.externalDeviceId) {
    throw new AppError("Drone external device ID is required for live telemetry connector", 409, "DRONE_CONNECTOR_ID_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    const updatedMission = await tx.mission.update({
      where: { id },
      data: { status: "ACTIVE", progress: mission.progress }
    });

    if (mission.droneId) {
      await tx.drone.update({
        where: { id: mission.droneId },
        data: { status: "IN_MISSION" }
      });
    }

    return updatedMission;
  });
};

export const completeMission = async (organisationId, id) => {
  const mission = await ensureMissionExists(organisationId, id);
  if (mission.status !== "ACTIVE") {
    throw new AppError("Only active missions can be completed", 409, "INVALID_MISSION_STATUS");
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.mission.update({
      where: { id },
      data: { status: "COMPLETED", progress: 100 }
    });
    if (mission.droneId) {
      await tx.drone.update({ where: { id: mission.droneId }, data: { status: "AVAILABLE" } });
    }
    return updated;
  });
};

export const ensureMissionExists = async (organisationId, id) => {
  const mission = await prisma.mission.findFirst({ where: { id, organisationId } });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");
  return mission;
};

const normalizeMissionInput = (data = {}) => ({
  ...data,
  plannedStartAt: data.plannedStartAt ? new Date(data.plannedStartAt) : undefined,
  plannedEndAt: data.plannedEndAt ? new Date(data.plannedEndAt) : undefined
});

const syncMissionDroneStatus = async (tx, mission, nextStatus, nextDroneId) => {
  const targetDroneId = nextDroneId ?? mission.droneId;

  if (!targetDroneId) return;

  if (["COMPLETED", "ABORTED", "CANCELLED"].includes(nextStatus)) {
    await tx.drone.update({
      where: { id: targetDroneId },
      data: { status: "AVAILABLE" }
    });
    return;
  }

  if (nextStatus === "ACTIVE") {
    await tx.drone.update({
      where: { id: targetDroneId },
      data: { status: "IN_MISSION" }
    });
  }
};

const isSystemAdministrator = (role) => role === "SYSTEM_ADMINISTRATOR";

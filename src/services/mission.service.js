import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { ensureDroneAssignable } from "./drone.service.js";
import { sendMissionApprovalRequestEmail, sendMissionApprovedEmail } from "./email.service.js";

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

export const createMission = async (organisationId, data, actor) => {
  if (data.droneId) await ensureDroneAssignable(organisationId, data.droneId);
  const missionCode = data.missionCode ?? await generateMissionCode(organisationId);

  return prisma.mission.create({
    data: {
      organisationId,
      missionCode,
      name: data.name,
      type: data.type,
      status: isSystemAdministrator(actor.role) ? "APPROVED" : "PLANNED",
      createdById: actor.id,
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

export const notifyMissionApprovalRequired = async ({ organisationId, mission, requester }) => {
  if (mission.status !== "PLANNED") return { notified: 0, skipped: true };

  const admins = await prisma.user.findMany({
    where: {
      organisationId,
      role: "SYSTEM_ADMINISTRATOR",
      isVerified: true
    },
    select: {
      id: true,
      name: true,
      email: true
    }
  });

  if (!admins.length) return { notified: 0, skipped: true };

  const results = await Promise.allSettled(
    admins.map((admin) => sendMissionApprovalRequestEmail({ admin, mission, requester }))
  );

  const notified = results.filter((result) => result.status === "fulfilled" && result.value?.sent).length;
  const failed = results.filter((result) => result.status === "rejected").length;
  const rejected = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value?.rejected ?? []);

  if (failed) {
    console.warn(`Mission approval email failed for ${failed} administrator(s).`);
  }

  return { notified, skipped: notified === 0, rejected };
};

export const updateMission = async (organisationId, id, data, actorRole) => {
  const mission = await ensureMissionExists(organisationId, id);
  const normalizedData = normalizeMissionInput(data);
  validateMissionSchedule({ ...mission, ...normalizedData });

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
  const mission = await prisma.mission.findFirst({
    where: { id, organisationId },
    include: { createdBy: { select: { id: true, name: true, email: true, isVerified: true } } }
  });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");
  if (mission.status !== "PLANNED") {
    throw new AppError("Only missions awaiting approval can be approved", 409, "MISSION_NOT_AWAITING_APPROVAL");
  }

  const approvedMission = await prisma.mission.update({
    where: { id },
    data: { status: "APPROVED" }
  });

  return {
    ...approvedMission,
    createdBy: mission.createdBy
  };
};

export const notifyMissionApproved = async ({ mission, approver }) => {
  if (!mission.createdBy?.email || !mission.createdBy.isVerified) {
    return { notified: 0, skipped: true };
  }

  const result = await sendMissionApprovedEmail({
    user: mission.createdBy,
    mission,
    approver
  });

  return {
    notified: result.sent ? 1 : 0,
    skipped: !result.sent,
    rejected: result.rejected ?? []
  };
};

export const saveRiskAssessment = async (organisationId, missionId, data, actorId) => {
  await ensureMissionExists(organisationId, missionId);

  return prisma.riskAssessment.upsert({
    where: { missionId },
    create: {
      organisationId,
      missionId,
      level: data.level,
      hazards: data.hazards,
      mitigations: data.mitigations,
      approvedById: actorId,
      approvedAt: new Date()
    },
    update: {
      level: data.level,
      hazards: data.hazards,
      mitigations: data.mitigations,
      approvedById: actorId,
      approvedAt: new Date()
    }
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

const validateMissionSchedule = (mission) => {
  const plannedStartAt = mission.plannedStartAt ? new Date(mission.plannedStartAt) : null;
  const plannedEndAt = mission.plannedEndAt ? new Date(mission.plannedEndAt) : null;

  if (plannedStartAt && plannedEndAt && plannedEndAt < plannedStartAt) {
    throw new AppError("Mission end time cannot be before start time", 400, "INVALID_MISSION_SCHEDULE");
  }
};

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

const generateMissionCode = async (organisationId) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const count = await prisma.mission.count({ where: { organisationId } });
    const candidate = `MIS-${String(count + 1 + attempt).padStart(4, "0")}`;
    const existing = await prisma.mission.findFirst({
      where: { organisationId, missionCode: candidate },
      select: { id: true }
    });

    if (!existing) return candidate;
  }

  return `MIS-${Date.now().toString().slice(-6)}`;
};

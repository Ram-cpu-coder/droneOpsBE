import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { ensureDroneAssignable, syncMissionDroneStatuses } from "./drone.service.js";
import { sendMissionApprovalRequestEmail, sendMissionApprovedEmail } from "./email.service.js";

export const listMissions = async (organisationId) => {
  await syncMissionDroneStatuses(organisationId);

  return prisma.mission.findMany({
    where: { organisationId },
    include: {
      drone: { select: { id: true, droneCode: true, status: true } },
      pilot: { select: { id: true, name: true, role: true } },
      droneAssignments: {
        include: { drone: { select: { id: true, droneCode: true, model: true, manufacturer: true, status: true, batteryType: true } } },
        orderBy: { createdAt: "asc" }
      },
      pilotAssignments: {
        include: { pilot: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: "asc" }
      },
      riskAssessment: true
    },
    orderBy: { createdAt: "desc" }
  });
};

export const createMission = async (organisationId, data, actor) => {
  const droneIds = normalizeAssignmentIds(data.droneId, data.droneIds);
  const pilotIds = normalizeAssignmentIds(data.pilotId, data.pilotIds);
  if (!droneIds.length) throw new AppError("Select at least one available drone before creating the mission", 400, "MISSION_DRONE_REQUIRED");
  if (!pilotIds.length) throw new AppError("Select at least one verified remote pilot before creating the mission", 400, "MISSION_PILOT_REQUIRED");

  await Promise.all(droneIds.map((droneId) => ensureDroneAssignable(organisationId, droneId)));
  await Promise.all(pilotIds.map((pilotId) => ensurePilotAssignable(organisationId, pilotId)));
  const missionCode = data.missionCode ?? await generateMissionCode(organisationId);

  return prisma.mission.create({
    data: {
      organisationId,
      missionCode,
      name: data.name,
      type: data.type,
      status: isSystemAdministrator(actor.role) ? "APPROVED" : "PLANNED",
      createdById: actor.id,
      droneId: droneIds[0],
      pilotId: pilotIds[0],
      plannedRoute: data.plannedRoute,
      geofenceConfig: data.geofenceConfig,
      launchSite: data.launchSite,
      operatingArea: data.operatingArea,
      plannedStartAt: data.plannedStartAt ? new Date(data.plannedStartAt) : undefined,
      plannedEndAt: data.plannedEndAt ? new Date(data.plannedEndAt) : undefined,
      droneAssignments: {
        create: droneIds.map((droneId, index) => ({ organisationId, droneId, isPrimary: index === 0 }))
      },
      pilotAssignments: {
        create: pilotIds.map((pilotId, index) => ({ organisationId, pilotId, isPrimary: index === 0 }))
      }
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
  const mission = await prisma.mission.findFirst({
    where: { id, organisationId },
    include: { droneAssignments: true, pilotAssignments: true }
  });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");
  const normalizedData = normalizeMissionInput(data);
  const hasDroneAssignments = data.droneId !== undefined || data.droneIds !== undefined;
  const hasPilotAssignments = data.pilotId !== undefined || data.pilotIds !== undefined;
  const nextDroneIds = hasDroneAssignments
    ? normalizeAssignmentIds(data.droneId, data.droneIds)
    : assignedDroneIds(mission);
  const nextPilotIds = hasPilotAssignments
    ? normalizeAssignmentIds(data.pilotId, data.pilotIds)
    : assignedPilotIds(mission);

  delete normalizedData.droneIds;
  delete normalizedData.pilotIds;
  if (hasDroneAssignments) normalizedData.droneId = nextDroneIds[0] ?? null;
  if (hasPilotAssignments) normalizedData.pilotId = nextPilotIds[0] ?? null;

  validateMissionSchedule({ ...mission, ...normalizedData });

  if (hasDroneAssignments) {
    if (!nextDroneIds.length) throw new AppError("Select at least one available drone before saving the mission", 400, "MISSION_DRONE_REQUIRED");
    const currentDroneIds = assignedDroneIds(mission);
    await Promise.all(nextDroneIds.map((droneId) => (
      currentDroneIds.includes(droneId) ? prisma.drone.findFirst({ where: { id: droneId, organisationId } }) : ensureDroneAssignable(organisationId, droneId)
    )));
  }

  if (hasPilotAssignments) {
    if (!nextPilotIds.length) throw new AppError("Select at least one verified remote pilot before saving the mission", 400, "MISSION_PILOT_REQUIRED");
    await Promise.all(nextPilotIds.map((pilotId) => ensurePilotAssignable(organisationId, pilotId)));
  }

  if (normalizedData.status && normalizedData.status !== mission.status && !isSystemAdministrator(actorRole)) {
    throw new AppError("Only system administrators can change mission status directly", 403, "MISSION_STATUS_ADMIN_ONLY");
  }

  return prisma.$transaction(async (tx) => {
    const updatedMission = await tx.mission.update({
      where: { id },
      data: normalizedData
    });

    if (hasDroneAssignments) {
      await tx.missionDroneAssignment.deleteMany({ where: { missionId: id } });
      await tx.missionDroneAssignment.createMany({
        data: nextDroneIds.map((droneId, index) => ({ organisationId, missionId: id, droneId, isPrimary: index === 0 })),
        skipDuplicates: true
      });
    }

    if (hasPilotAssignments) {
      await tx.missionPilotAssignment.deleteMany({ where: { missionId: id } });
      await tx.missionPilotAssignment.createMany({
        data: nextPilotIds.map((pilotId, index) => ({ organisationId, missionId: id, pilotId, isPrimary: index === 0 })),
        skipDuplicates: true
      });
    }

    if (normalizedData.status && normalizedData.status !== mission.status) {
      await syncMissionDroneStatus(tx, { ...mission, droneAssignments: nextDroneIds.map((droneId) => ({ droneId })) }, updatedMission.status, updatedMission.droneId);
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
  const mission = await ensureMissionExists(organisationId, missionId);

  if (!["APPROVED", "RISK_ASSESSMENT_COMPLETED"].includes(mission.status)) {
    throw new AppError("Risk assessment can only be completed after mission approval", 409, "INVALID_MISSION_RISK_STATUS");
  }

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.riskAssessment.upsert({
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

    if (mission.status === "APPROVED") {
      await tx.mission.update({
        where: { id: missionId },
        data: { status: "RISK_ASSESSMENT_COMPLETED" }
      });
    }

    return assessment;
  });
};

export const startMission = async (organisationId, id) => {
  const mission = await prisma.mission.findFirst({
    where: { id, organisationId },
    include: {
      riskAssessment: true,
      drone: true,
      pilot: true,
      droneAssignments: { include: { drone: true } },
      pilotAssignments: { include: { pilot: true } }
    }
  });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");
  const droneIds = assignedDroneIds(mission);
  const pilotIds = assignedPilotIds(mission);
  if (!droneIds.length || !pilotIds.length) throw new AppError("Mission requires drone and pilot assignment", 409, "MISSION_ASSIGNMENT_REQUIRED");
  if (!mission.riskAssessment) throw new AppError("Risk assessment required before activation", 409, "RISK_ASSESSMENT_REQUIRED");
  if (mission.status === "PLANNED") throw new AppError("Mission is awaiting system administrator approval", 409, "MISSION_APPROVAL_REQUIRED");
  if (mission.status !== "RISK_ASSESSMENT_COMPLETED") throw new AppError("Mission cannot be started until risk assessment is completed", 409, "INVALID_MISSION_STATUS");
  const connectorDroneMissingId = mission.droneAssignments
    .map((assignment) => assignment.drone)
    .find((drone) => drone?.telemetryProvider && drone.telemetryProvider !== "NONE" && !drone.externalDeviceId);
  if (connectorDroneMissingId) {
    throw new AppError("Drone external device ID is required for live telemetry connector", 409, "DRONE_CONNECTOR_ID_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    const updatedMission = await tx.mission.update({
      where: { id },
      data: { status: "ACTIVE", progress: mission.progress }
    });

    await tx.drone.updateMany({
      where: { organisationId, id: { in: droneIds } },
      data: { status: "IN_MISSION" }
    });

    return updatedMission;
  });
};

export const completeMission = async (organisationId, id) => {
  const mission = await prisma.mission.findFirst({
    where: { id, organisationId },
    include: { droneAssignments: true }
  });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");
  if (mission.status !== "ACTIVE") {
    throw new AppError("Only active missions can be completed", 409, "INVALID_MISSION_STATUS");
  }
  const droneIds = assignedDroneIds(mission);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.mission.update({
      where: { id },
      data: { status: "COMPLETED", progress: 100 }
    });
    if (droneIds.length) {
      await tx.drone.updateMany({ where: { organisationId, id: { in: droneIds } }, data: { status: "AVAILABLE" } });
    }
    return updated;
  });
};

export const ensureMissionExists = async (organisationId, id) => {
  const mission = await prisma.mission.findFirst({ where: { id, organisationId } });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");
  return mission;
};

const ensurePilotAssignable = async (organisationId, pilotId) => {
  const pilot = await prisma.user.findFirst({
    where: {
      id: pilotId,
      organisationId,
      role: { in: ["REMOTE_PILOT", "OPERATIONS_MANAGER", "SYSTEM_ADMINISTRATOR"] },
      isVerified: true
    },
    select: {
      id: true,
      name: true,
      role: true
    }
  });

  if (!pilot) {
    throw new AppError("Select a verified remote pilot before creating the mission", 400, "MISSION_PILOT_REQUIRED");
  }

  return pilot;
};

const normalizeMissionInput = (data = {}) => ({
  ...data,
  plannedStartAt: data.plannedStartAt ? new Date(data.plannedStartAt) : undefined,
  plannedEndAt: data.plannedEndAt ? new Date(data.plannedEndAt) : undefined
});

const normalizeAssignmentIds = (primaryId, ids = []) => (
  [...new Set([primaryId, ...(Array.isArray(ids) ? ids : [])].filter(Boolean))]
);

const assignedDroneIds = (mission) => normalizeAssignmentIds(
  mission.droneId,
  mission.droneAssignments?.map((assignment) => assignment.droneId)
);

const assignedPilotIds = (mission) => normalizeAssignmentIds(
  mission.pilotId,
  mission.pilotAssignments?.map((assignment) => assignment.pilotId)
);

const validateMissionSchedule = (mission) => {
  const plannedStartAt = mission.plannedStartAt ? new Date(mission.plannedStartAt) : null;
  const plannedEndAt = mission.plannedEndAt ? new Date(mission.plannedEndAt) : null;

  if (plannedStartAt && plannedEndAt && plannedEndAt < plannedStartAt) {
    throw new AppError("Mission end time cannot be before start time", 400, "INVALID_MISSION_SCHEDULE");
  }
};

const syncMissionDroneStatus = async (tx, mission, nextStatus, nextDroneId) => {
  const targetDroneIds = normalizeAssignmentIds(nextDroneId ?? mission.droneId, mission.droneAssignments?.map((assignment) => assignment.droneId));

  if (!targetDroneIds.length) return;

  if (["COMPLETED", "ABORTED", "CANCELLED"].includes(nextStatus)) {
    await tx.drone.updateMany({
      where: { id: { in: targetDroneIds } },
      data: { status: "AVAILABLE" }
    });
    return;
  }

  if (nextStatus === "ACTIVE") {
    await tx.drone.updateMany({
      where: { id: { in: targetDroneIds } },
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

import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { mergeAuthorityAnalysisIntoMissionPlan, resolveRouteAuthorities } from "./councilBoundary.service.js";
import { ensureDroneAssignable, syncMissionDroneStatuses } from "./drone.service.js";
import { sendMissionApprovalRequestEmail, sendMissionApprovedEmail } from "./email.service.js";

const missionRecordInclude = {
  drone: {
    select: {
      id: true,
      droneCode: true,
      status: true,
      model: true,
      manufacturer: true,
      serialNumber: true,
      telemetryProvider: true,
      externalDeviceId: true,
      batteryType: true
    }
  },
  pilot: { select: { id: true, name: true, email: true, role: true } },
  droneAssignments: {
    include: {
      drone: {
        select: {
          id: true,
          droneCode: true,
          model: true,
          manufacturer: true,
          serialNumber: true,
          status: true,
          batteryType: true,
          telemetryProvider: true,
          externalDeviceId: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  },
  pilotAssignments: {
    include: { pilot: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { createdAt: "asc" }
  },
  riskAssessment: true
};

export const listMissions = async (organisationId) => {
  await syncMissionDroneStatuses(organisationId);

  return prisma.mission.findMany({
    where: { organisationId },
    include: missionRecordInclude,
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
  const authorityPlan = await buildMissionAuthorityPlan(data.plannedRoute, data.geofenceConfig);
  assertAuthorityAnalysisReady(authorityPlan);
  const status = getInitialMissionStatus(actor.role, authorityPlan);
  await assertMissionResourceAvailability(organisationId, {
    droneIds,
    pilotIds,
    plannedStartAt: data.plannedStartAt,
    plannedEndAt: data.plannedEndAt,
    status
  });

  return prisma.mission.create({
    data: {
      organisationId,
      missionCode,
      name: data.name,
      type: data.type,
      status,
      createdById: actor.id,
      droneId: droneIds[0],
      pilotId: pilotIds[0],
      plannedRoute: authorityPlan.plannedRoute,
      geofenceConfig: authorityPlan.geofenceConfig,
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
    },
    include: missionRecordInclude
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

  await assertMissionResourceAvailability(organisationId, {
    missionId: mission.id,
    droneIds: nextDroneIds,
    pilotIds: nextPilotIds,
    plannedStartAt: normalizedData.plannedStartAt ?? mission.plannedStartAt,
    plannedEndAt: normalizedData.plannedEndAt ?? mission.plannedEndAt,
    status: normalizedData.status ?? mission.status
  });

  if (normalizedData.plannedRoute !== undefined) {
    const authorityPlan = await buildMissionAuthorityPlan(normalizedData.plannedRoute, normalizedData.geofenceConfig ?? mission.geofenceConfig);
    assertAuthorityAnalysisReady(authorityPlan);
    normalizedData.plannedRoute = authorityPlan.plannedRoute;
    normalizedData.geofenceConfig = authorityPlan.geofenceConfig;
    if (!normalizedData.status) {
      normalizedData.status = getStatusForAuthorityApprovals(mission.status, actorRole, authorityPlan);
    }
  }

  return prisma.$transaction(async (tx) => {
    const updatedMission = await tx.mission.update({
      where: { id },
      data: normalizedData,
      include: missionRecordInclude
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

const buildMissionAuthorityPlan = async (plannedRoute, geofenceConfig, options = {}) => {
  if (!plannedRoute || typeof plannedRoute !== "object" || Array.isArray(plannedRoute)) {
    return { plannedRoute, geofenceConfig };
  }

  const authorityAnalysis = await resolveRouteAuthorities(plannedRoute);
  return mergeAuthorityAnalysisIntoMissionPlan(plannedRoute, geofenceConfig, authorityAnalysis, options);
};

export const analyseMissionRoute = async (plannedRoute) => buildMissionAuthorityPlan(plannedRoute, null, { includeGeometry: true });

const assertAuthorityAnalysisReady = (authorityPlan) => {
  const authorityAnalysis = authorityPlan?.geofenceConfig?.authorityAnalysis;
  if (!authorityAnalysis || authorityAnalysis.status === "READY") return;

  throw new AppError(authorityAnalysis.message, 409, "COUNCIL_BOUNDARY_ANALYSIS_REQUIRED");
};

const getInitialMissionStatus = (actorRole, authorityPlan) => (
  getAuthorityApprovalState(authorityPlan.geofenceConfig, authorityPlan.plannedRoute?.routeAnalysis?.authorityAnalysis).ready
    ? getApprovedPlanningStatus(actorRole)
    : "AWAITING_AUTHORITY_APPROVAL"
);

const getStatusForAuthorityApprovals = (currentStatus, actorRole, authorityPlan) => {
  const approvalState = getAuthorityApprovalState(authorityPlan.geofenceConfig, authorityPlan.plannedRoute?.routeAnalysis?.authorityAnalysis);
  if (!approvalState.ready) return "AWAITING_AUTHORITY_APPROVAL";
  if (currentStatus === "AWAITING_AUTHORITY_APPROVAL") return getApprovedPlanningStatus(actorRole);
  return currentStatus;
};

const getApprovedPlanningStatus = (actorRole) => (
  isSystemAdministrator(actorRole) ? "APPROVED" : "PLANNED"
);

const getAuthorityApprovalState = (geofenceConfig, authorityAnalysis) => {
  const authorities = [
    ...(Array.isArray(geofenceConfig?.approvalRequirements) ? geofenceConfig.approvalRequirements : []),
    ...(Array.isArray(authorityAnalysis?.authorities) ? authorityAnalysis.authorities : [])
  ];
  const authoritiesByKey = new Map();

  authorities.forEach((authority) => {
    const key = getAuthorityKey(authority);
    if (!key || authoritiesByKey.has(key)) return;
    const approvalStatus = String(authority.approvalStatus ?? "").toUpperCase();
    authoritiesByKey.set(key, ["APPROVED", "GRANTED", "CONFIRMED"].includes(approvalStatus));
  });

  const values = [...authoritiesByKey.values()];
  return {
    total: values.length,
    pending: values.filter((approved) => !approved).length,
    ready: values.length === 0 || values.every(Boolean)
  };
};

const applyAuthorityApprovalsToRoute = (plannedRoute, approvals) => {
  const nextRoute = cloneJson(plannedRoute) ?? {};
  const authorityAnalysis = nextRoute.routeAnalysis?.authorityAnalysis;
  if (authorityAnalysis?.authorities) {
    authorityAnalysis.authorities = authorityAnalysis.authorities.map((authority) => applyAuthorityApproval(authority, approvals));
  }
  if (nextRoute.routeAnalysis?.authorityApprovals) nextRoute.routeAnalysis.authorityApprovals = approvals;
  return nextRoute;
};

const applyAuthorityApprovalsToGeofence = (geofenceConfig, approvals, plannedRoute) => {
  const nextGeofence = cloneJson(geofenceConfig) ?? {};
  const routeAuthorities = plannedRoute?.routeAnalysis?.authorityAnalysis?.authorities ?? [];
  const baseRequirements = Array.isArray(nextGeofence.approvalRequirements) && nextGeofence.approvalRequirements.length
    ? nextGeofence.approvalRequirements
    : routeAuthorities;

  if (nextGeofence.authorityAnalysis?.authorities) {
    nextGeofence.authorityAnalysis.authorities = nextGeofence.authorityAnalysis.authorities.map((authority) => applyAuthorityApproval(authority, approvals));
  }

  nextGeofence.approvalRequirements = baseRequirements.map((authority) => applyAuthorityApproval({
    authorityType: authority.authorityType,
    authorityName: authority.authorityName,
    lgaName: authority.lgaName,
    absCode: authority.absCode,
    reference: authority.reference,
    approvalRequired: true,
    source: authority.source
  }, approvals));

  return nextGeofence;
};

const applyAuthorityApproval = (authority, approvals) => {
  const key = getAuthorityKey(authority);
  return {
    ...authority,
    approvalRequired: true,
    approvalStatus: key && approvals[key] ? "APPROVED" : "PENDING"
  };
};

const getAuthorityKey = (authority) => String(authority?.reference ?? authority?.absCode ?? authority?.authorityName ?? authority?.lgaName ?? "");

const cloneJson = (value) => {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
};

export const updateMissionAuthorityApprovals = async (organisationId, id, approvals, actorRole) => {
  const mission = await prisma.mission.findFirst({
    where: { id, organisationId },
    include: { droneAssignments: true, pilotAssignments: true }
  });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");

  const normalizedApprovals = approvals && typeof approvals === "object" ? approvals : {};
  const plannedRoute = applyAuthorityApprovalsToRoute(mission.plannedRoute, normalizedApprovals);
  const geofenceConfig = applyAuthorityApprovalsToGeofence(mission.geofenceConfig, normalizedApprovals, plannedRoute);
  const status = getStatusForAuthorityApprovals(mission.status, actorRole, { plannedRoute, geofenceConfig });

  await assertMissionResourceAvailability(organisationId, {
    missionId: mission.id,
    droneIds: assignedDroneIds(mission),
    pilotIds: assignedPilotIds(mission),
    plannedStartAt: mission.plannedStartAt,
    plannedEndAt: mission.plannedEndAt,
    status
  });

  return prisma.mission.update({
    where: { id },
    data: { plannedRoute, geofenceConfig, status },
    include: missionRecordInclude
  });
};

export const approveMission = async (organisationId, id) => {
  const mission = await prisma.mission.findFirst({
    where: { id, organisationId },
    include: {
      createdBy: { select: { id: true, name: true, email: true, isVerified: true } },
      droneAssignments: true,
      pilotAssignments: true
    }
  });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");
  if (mission.status !== "PLANNED") {
    throw new AppError("Only missions awaiting approval can be approved", 409, "MISSION_NOT_AWAITING_APPROVAL");
  }

  await assertMissionResourceAvailability(organisationId, {
    missionId: mission.id,
    droneIds: assignedDroneIds(mission),
    pilotIds: assignedPilotIds(mission),
    plannedStartAt: mission.plannedStartAt,
    plannedEndAt: mission.plannedEndAt,
    status: "APPROVED"
  });

  const approvedMission = await prisma.mission.update({
    where: { id },
    data: { status: "APPROVED" },
    include: missionRecordInclude
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
  const authorityApprovalState = getAuthorityApprovalState(mission.geofenceConfig, mission.plannedRoute?.routeAnalysis?.authorityAnalysis);
  if (!authorityApprovalState.ready) {
    throw new AppError("Confirm every required council/authority permission before starting this mission", 409, "MISSION_AUTHORITY_APPROVAL_REQUIRED");
  }
  if (!mission.riskAssessment) throw new AppError("Risk assessment required before activation", 409, "RISK_ASSESSMENT_REQUIRED");
  if (mission.status === "AWAITING_AUTHORITY_APPROVAL") throw new AppError("Mission is awaiting council/authority permission confirmation", 409, "MISSION_AUTHORITY_APPROVAL_REQUIRED");
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
      data: { status: "ACTIVE", progress: mission.progress },
      include: missionRecordInclude
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
      data: { status: "COMPLETED", progress: 100 },
      include: missionRecordInclude
    });
    if (droneIds.length) {
      await tx.drone.updateMany({ where: { organisationId, id: { in: droneIds } }, data: { status: "AVAILABLE" } });
    }
    return updated;
  });
};

export const deleteMission = async (organisationId, id) => {
  const mission = await prisma.mission.findFirst({
    where: { id, organisationId },
    include: { droneAssignments: true }
  });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");
  if (mission.status === "ACTIVE") {
    throw new AppError("Complete or abort the active mission before deleting it", 409, "ACTIVE_MISSION_DELETE_BLOCKED");
  }

  const droneIds = assignedDroneIds(mission);

  return prisma.$transaction(async (tx) => {
    await tx.telemetryLog.updateMany({
      where: { organisationId, missionId: id },
      data: { missionId: null }
    });
    await tx.flightLog.updateMany({
      where: { organisationId, missionId: id },
      data: { missionId: null }
    });
    await tx.incident.updateMany({
      where: { organisationId, missionId: id },
      data: { missionId: null }
    });
    await tx.mission.delete({ where: { id } });

    if (droneIds.length && ["COMPLETED", "ABORTED", "CANCELLED"].includes(mission.status)) {
      await tx.drone.updateMany({
        where: { organisationId, id: { in: droneIds }, status: "IN_MISSION" },
        data: { status: "AVAILABLE" }
      });
    }

    return mission;
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

const blockingMissionStatuses = ["APPROVED", "RISK_ASSESSMENT_COMPLETED", "ACTIVE"];

const assertMissionResourceAvailability = async (
  organisationId,
  { missionId, droneIds = [], pilotIds = [], plannedStartAt, plannedEndAt, status }
) => {
  if (!blockingMissionStatuses.includes(status)) return;

  const start = plannedStartAt ? new Date(plannedStartAt) : null;
  const end = plannedEndAt ? new Date(plannedEndAt) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

  const conflicts = await prisma.mission.findMany({
    where: {
      organisationId,
      id: missionId ? { not: missionId } : undefined,
      status: { in: blockingMissionStatuses },
      plannedStartAt: { lt: end },
      plannedEndAt: { gt: start },
      OR: [
        { droneId: { in: droneIds } },
        { pilotId: { in: pilotIds } },
        { droneAssignments: { some: { droneId: { in: droneIds } } } },
        { pilotAssignments: { some: { pilotId: { in: pilotIds } } } }
      ]
    },
    include: {
      droneAssignments: { include: { drone: { select: { id: true, droneCode: true } } } },
      pilotAssignments: { include: { pilot: { select: { id: true, name: true } } } },
      drone: { select: { id: true, droneCode: true } },
      pilot: { select: { id: true, name: true } }
    }
  });

  if (!conflicts.length) return;

  const droneConflicts = new Set();
  const pilotConflicts = new Set();

  conflicts.forEach((mission) => {
    const missionDroneIds = assignedDroneIds(mission);
    const missionPilotIds = assignedPilotIds(mission);
    missionDroneIds
      .filter((droneId) => droneIds.includes(droneId))
      .forEach((droneId) => droneConflicts.add(findDroneLabel(mission, droneId)));
    missionPilotIds
      .filter((pilotId) => pilotIds.includes(pilotId))
      .forEach((pilotId) => pilotConflicts.add(findPilotLabel(mission, pilotId)));
  });

  const parts = [];
  if (droneConflicts.size) parts.push(`Drone already scheduled: ${[...droneConflicts].join(", ")}`);
  if (pilotConflicts.size) parts.push(`Pilot already scheduled: ${[...pilotConflicts].join(", ")}`);

  throw new AppError(
    `${parts.join(". ")}. Select different resources or change the mission time.`,
    409,
    "MISSION_RESOURCE_CONFLICT"
  );
};

const findDroneLabel = (mission, droneId) => {
  if (mission.drone?.id === droneId) return mission.drone.droneCode;
  return mission.droneAssignments?.find((assignment) => assignment.droneId === droneId)?.drone?.droneCode ?? droneId;
};

const findPilotLabel = (mission, pilotId) => {
  if (mission.pilot?.id === pilotId) return mission.pilot.name;
  return mission.pilotAssignments?.find((assignment) => assignment.pilotId === pilotId)?.pilot?.name ?? pilotId;
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

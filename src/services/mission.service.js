import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { mergeAuthorityAnalysisIntoMissionPlan, resolveRouteAuthorities } from "./councilBoundary.service.js";
import { addMissionFlightHours } from "./droneFlightHours.service.js";
import { ensureDroneAssignable, syncMissionDroneStatuses } from "./drone.service.js";
import { sendMissionApprovalRequestEmail, sendMissionApprovedEmail } from "./email.service.js";
import { nextDisplayCode } from "./displaySequence.service.js";

const missionRecordInclude = {
  drone: {
    select: {
      id: true,
      droneCode: true,
      status: true,
      model: true,
      manufacturer: true,
      serialNumber: true,
      flightHours: true,
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
          flightHours: true,
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
  const authorityPlan = await buildMissionAuthorityPlan(organisationId, data.plannedRoute, data.geofenceConfig);
  assertAuthorityAnalysisReady(authorityPlan);
  assertOperationalGeofenceClear(authorityPlan);
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
  if (terminalMissionStatuses.has(mission.status)) {
    throw new AppError("Completed, aborted, or cancelled missions cannot be edited", 409, "MISSION_TERMINAL_LOCKED");
  }
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
    const authorityPlan = await buildMissionAuthorityPlan(organisationId, normalizedData.plannedRoute, normalizedData.geofenceConfig ?? mission.geofenceConfig);
    assertAuthorityAnalysisReady(authorityPlan);
    assertOperationalGeofenceClear(authorityPlan);
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

const buildMissionAuthorityPlan = async (organisationId, plannedRoute, geofenceConfig, options = {}) => {
  if (!plannedRoute || typeof plannedRoute !== "object" || Array.isArray(plannedRoute)) {
    return { plannedRoute, geofenceConfig };
  }

  const authorityAnalysis = await resolveRouteAuthorities(plannedRoute);
  const authorityPlan = mergeAuthorityAnalysisIntoMissionPlan(plannedRoute, geofenceConfig, authorityAnalysis, options);
  return mergeOperationalGeofenceAnalysis(organisationId, authorityPlan);
};

export const analyseMissionRoute = async (organisationId, plannedRoute) => {
  const authorityPlan = await buildMissionAuthorityPlan(organisationId, plannedRoute, null, { includeGeometry: true });
  assertOperationalGeofenceClear(authorityPlan);
  return authorityPlan;
};

const assertAuthorityAnalysisReady = (authorityPlan) => {
  const authorityAnalysis = authorityPlan?.geofenceConfig?.authorityAnalysis;
  if (!authorityAnalysis || authorityAnalysis.status === "READY") return;

  throw new AppError(authorityAnalysis.message, 409, "COUNCIL_BOUNDARY_ANALYSIS_REQUIRED");
};

const assertOperationalGeofenceClear = (authorityPlan) => {
  const blockingZones = authorityPlan?.geofenceConfig?.operationalGeofenceAnalysis?.blockingZones ?? [];
  if (!blockingZones.length) return;

  throw new AppError(
    `Mission route intersects restricted geofence: ${blockingZones.map((zone) => zone.name).join(", ")}`,
    409,
    "MISSION_RESTRICTED_GEOFENCE_INTERSECTION"
  );
};

const mergeOperationalGeofenceAnalysis = async (organisationId, authorityPlan) => {
  const routePoints = extractRoutePoints(authorityPlan.plannedRoute);
  const activeGeofences = await prisma.geofence.findMany({
    where: {
      organisationId,
      isActive: true
    },
    select: {
      id: true,
      name: true,
      type: true,
      source: true,
      provider: true,
      polygon: true
    }
  });
  const intersections = activeGeofences
    .filter((zone) => routeIntersectsPolygon(routePoints, zone.polygon))
    .map((zone) => ({
      id: zone.id,
      name: zone.name,
      type: zone.type,
      source: zone.source,
      provider: zone.provider
    }));
  const blockingZones = intersections.filter((zone) => zone.type === "RESTRICTED");
  const warningZones = intersections.filter((zone) => zone.type !== "RESTRICTED");
  const status = blockingZones.length ? "BLOCKED" : warningZones.length ? "WARNING" : "CLEAR";
  const analysis = {
    status,
    checkedAt: new Date().toISOString(),
    checkedGeofences: activeGeofences.length,
    intersections,
    blockingZones,
    warningZones,
    message: blockingZones.length
      ? `Route intersects restricted geofence: ${blockingZones.map((zone) => zone.name).join(", ")}`
      : warningZones.length
        ? `Route intersects ${warningZones.length} warning/advisory geofence${warningZones.length === 1 ? "" : "s"}.`
        : "Route does not intersect active operational geofences."
  };

  const plannedRoute = {
    ...authorityPlan.plannedRoute,
    routeAnalysis: {
      ...(authorityPlan.plannedRoute.routeAnalysis ?? {}),
      operationalGeofenceAnalysis: analysis
    }
  };

  return {
    plannedRoute,
    geofenceConfig: {
      ...(authorityPlan.geofenceConfig ?? {}),
      operationalGeofenceAnalysis: analysis
    }
  };
};

const extractRoutePoints = (plannedRoute) => {
  const candidates = Array.isArray(plannedRoute?.waypoints)
    ? plannedRoute.waypoints
    : Array.isArray(plannedRoute?.points)
      ? plannedRoute.points
      : Array.isArray(plannedRoute?.coordinates)
        ? plannedRoute.coordinates.map(([longitude, latitude]) => ({ longitude, latitude }))
        : [];

  return candidates
    .map((point) => {
      const latitude = Number(point.latitude ?? point.lat ?? point.location?.latitude);
      const longitude = Number(point.longitude ?? point.lng ?? point.lon ?? point.location?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    })
    .filter(Boolean);
};

const routeIntersectsPolygon = (routePoints, polygon) => {
  const polygonPoints = normalizePolygonPoints(polygon);
  if (routePoints.length < 2 || polygonPoints.length < 3) return false;

  if (routePoints.some((point) => isPointInPolygon(point, polygonPoints))) return true;
  if (polygonPoints.some((point) => isPointOnRoute(point, routePoints))) return true;

  for (let routeIndex = 1; routeIndex < routePoints.length; routeIndex += 1) {
    const routeStart = routePoints[routeIndex - 1];
    const routeEnd = routePoints[routeIndex];

    for (let polygonIndex = 0; polygonIndex < polygonPoints.length; polygonIndex += 1) {
      const polygonStart = polygonPoints[polygonIndex];
      const polygonEnd = polygonPoints[(polygonIndex + 1) % polygonPoints.length];
      if (segmentsIntersect(routeStart, routeEnd, polygonStart, polygonEnd)) return true;
    }
  }

  return false;
};

const normalizePolygonPoints = (polygon) => {
  const points = Array.isArray(polygon)
    ? polygon
    : Array.isArray(polygon?.coordinates?.[0])
      ? polygon.coordinates[0]
      : [];

  return points
    .map((point) => {
      const longitude = Number(Array.isArray(point) ? point[0] : point.longitude ?? point.lng ?? point.lon);
      const latitude = Number(Array.isArray(point) ? point[1] : point.latitude ?? point.lat);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    })
    .filter(Boolean);
};

const isPointInPolygon = (point, polygon) => {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects = ((current.latitude > point.latitude) !== (previous.latitude > point.latitude))
      && (point.longitude < ((previous.longitude - current.longitude) * (point.latitude - current.latitude)) / (previous.latitude - current.latitude) + current.longitude);
    if (intersects) inside = !inside;
  }
  return inside;
};

const isPointOnRoute = (point, routePoints) => {
  for (let index = 1; index < routePoints.length; index += 1) {
    if (isPointOnSegment(point, routePoints[index - 1], routePoints[index])) return true;
  }
  return false;
};

const segmentsIntersect = (a, b, c, d) => {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && isPointOnSegment(c, a, b)) return true;
  if (o2 === 0 && isPointOnSegment(d, a, b)) return true;
  if (o3 === 0 && isPointOnSegment(a, c, d)) return true;
  if (o4 === 0 && isPointOnSegment(b, c, d)) return true;
  return false;
};

const orientation = (a, b, c) => {
  const value = ((b.latitude - a.latitude) * (c.longitude - b.longitude))
    - ((b.longitude - a.longitude) * (c.latitude - b.latitude));
  if (Math.abs(value) < 0.000000000001) return 0;
  return value > 0 ? 1 : 2;
};

const isPointOnSegment = (point, start, end) => (
  point.longitude <= Math.max(start.longitude, end.longitude) + 0.000000000001
  && point.longitude >= Math.min(start.longitude, end.longitude) - 0.000000000001
  && point.latitude <= Math.max(start.latitude, end.latitude) + 0.000000000001
  && point.latitude >= Math.min(start.latitude, end.latitude) - 0.000000000001
  && orientation(start, point, end) === 0
);

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

export const ensureMissionCanStart = async (organisationId, id) => {
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
  const currentAuthorityPlan = await buildMissionAuthorityPlan(organisationId, mission.plannedRoute, mission.geofenceConfig);
  assertOperationalGeofenceClear(currentAuthorityPlan);
  const droneIds = assignedDroneIds(mission);
  const pilotIds = assignedPilotIds(mission);
  if (!droneIds.length || !pilotIds.length) throw new AppError("Mission requires drone and pilot assignment", 409, "MISSION_ASSIGNMENT_REQUIRED");
  await Promise.all(pilotIds.map((pilotId) => ensurePilotAssignable(organisationId, pilotId)));
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

  return { mission, droneIds, pilotIds };
};

export const startMission = async (organisationId, id) => {
  const { mission, droneIds } = await ensureMissionCanStart(organisationId, id);

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

export const ensureMissionCanComplete = async (organisationId, id) => {
  const mission = await prisma.mission.findFirst({
    where: { id, organisationId },
    include: { droneAssignments: true }
  });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");
  if (mission.status !== "ACTIVE") {
    throw new AppError("Only active missions can be completed", 409, "INVALID_MISSION_STATUS");
  }
  return mission;
};

export const completeMission = async (organisationId, id) => {
  const mission = await ensureMissionCanComplete(organisationId, id);
  const droneIds = assignedDroneIds(mission);
  return prisma.$transaction(async (tx) => {
    const plannedRoute = mission.plannedRoute && typeof mission.plannedRoute === "object" && !Array.isArray(mission.plannedRoute)
      ? mission.plannedRoute
      : {};
    const actualFlightHours = await addMissionFlightHours(tx, { organisationId, missionId: id, droneIds });
    const totalActualFlightHours = Number(actualFlightHours.reduce((sum, row) => sum + row.durationHours, 0).toFixed(4));
    const updated = await tx.mission.update({
      where: { id },
      data: {
        status: "COMPLETED",
        progress: 100,
        plannedRoute: {
          ...plannedRoute,
          progress: {
            ...(plannedRoute.progress ?? {}),
            source: plannedRoute.progress?.source ?? "MANUAL",
            percent: 100,
            completedAt: new Date(),
            actualFlightHours,
            totalActualFlightHours
          }
        }
      },
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

    if (droneIds.length && terminalMissionStatuses.has(mission.status)) {
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
      role: true,
      pilotCredentials: true
    }
  });

  if (!pilot) {
    throw new AppError("Select a verified remote pilot before creating the mission", 400, "MISSION_PILOT_REQUIRED");
  }

  const credentials = pilot.pilotCredentials && typeof pilot.pilotCredentials === "object"
    ? pilot.pilotCredentials
    : null;
  const licences = Array.isArray(credentials?.licences) ? credentials.licences : [];

  if (!credentials) {
    throw new AppError("Pilot credentials are required before mission assignment", 409, "PILOT_CREDENTIALS_REQUIRED");
  }

  if (!credentials.certificationExpiry || isExpiredCredentialDate(credentials.certificationExpiry)) {
    throw new AppError("Pilot certification is missing or expired", 409, "PILOT_CERTIFICATION_INVALID");
  }

  if (!licences.length) {
    throw new AppError("Pilot licence records are required before mission assignment", 409, "PILOT_LICENCE_REQUIRED");
  }

  const hasInvalidLicence = licences.some((licence) => (
    !licence?.type
    || !licence?.number
    || !licence?.expiresAt
    || isExpiredCredentialDate(licence.expiresAt)
  ));

  if (hasInvalidLicence) {
    throw new AppError("Pilot licence records must include current licence number and expiry before mission assignment", 409, "PILOT_LICENCE_INVALID");
  }

  return pilot;
};

const isExpiredCredentialDate = (value) => {
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime())) return true;
  expiry.setHours(23, 59, 59, 999);
  return expiry < new Date();
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

  if (terminalMissionStatuses.has(nextStatus)) {
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

const terminalMissionStatuses = new Set(["COMPLETED", "ABORTED", "CANCELLED"]);

const generateMissionCode = async (organisationId) => {
  return nextDisplayCode({
    organisationId,
    scope: "MISSION",
    prefix: "MIS",
    width: 4,
    getExistingCodes: async () => (await prisma.mission.findMany({ where: { organisationId }, select: { missionCode: true } })).map(({ missionCode }) => missionCode),
    exists: async (missionCode) => Boolean(await prisma.mission.findFirst({ where: { organisationId, missionCode }, select: { id: true } }))
  });
};

import { writeAudit } from "../services/audit.service.js";
import * as missionService from "../services/mission.service.js";
import { syncMissionPlanningToSynctegral, syncMissionToSynctegral, updateSynctegralMissionStatus } from "../services/synctegralMission.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/apiResponse.js";
import { AppError } from "../utils/AppError.js";

export const list = asyncHandler(async (req, res) => {
  const missions = await missionService.listMissions(req.user.organisationId);
  return ok(res, missions.map(serializeMission));
});

export const create = asyncHandler(async (req, res) => {
  const mission = await missionService.createMission(req.user.organisationId, req.validated.body, req.user);
  const synctegralSync = await syncMissionToSynctegral(req.user.organisationId, mission.id);
  const responseMission = mergeMissionSyncResult(mission, synctegralSync);

  let approvalNotification = null;
  if (responseMission.status === "PLANNED") {
    try {
      approvalNotification = await missionService.notifyMissionApprovalRequired({
        organisationId: req.user.organisationId,
        mission: responseMission,
        requester: req.user
      });
    } catch (error) {
      approvalNotification = { notified: 0, skipped: true, error: error.message };
      console.warn(`Mission approval notification failed: ${error.message}`);
    }
  }

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: getMissionCreateAuditAction(responseMission.status),
    entityType: "MISSION",
    entityId: responseMission.id,
    metadata: {
      missionCode: responseMission.missionCode,
      name: responseMission.name,
      status: responseMission.status,
      requiresApproval: ["AWAITING_AUTHORITY_APPROVAL", "PLANNED"].includes(responseMission.status),
      approvalNotification,
      synctegralSync: {
        status: synctegralSync?.status,
        synctegralMissionId: synctegralSync?.synctegralMissionId,
        error: synctegralSync?.error
      }
    }
  });

  return created(res, serializeMission(responseMission), getMissionCreateMessage(responseMission.status));
});

export const update = asyncHandler(async (req, res) => {
  const mission = await missionService.updateMission(req.user.organisationId, req.params.id, req.validated.body, req.user.role);
  const synctegralSync = await syncMissionPlanningToSynctegral(req.user.organisationId, mission.id);
  const responseMission = mergeMissionSyncResult(mission, synctegralSync);

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_UPDATED",
    entityType: "MISSION",
    entityId: responseMission.id,
    metadata: {
      missionCode: responseMission.missionCode,
      name: responseMission.name,
      status: responseMission.status,
      fields: Object.keys(req.validated.body),
      synctegralSync: toAuditSyncResult(synctegralSync)
    }
  });
  return ok(res, serializeMission(responseMission), "Mission updated");
});

export const analyseRoute = asyncHandler(async (req, res) => {
  const authorityPlan = await missionService.analyseMissionRoute(req.user.organisationId, req.validated.body.plannedRoute);
  return ok(res, authorityPlan, "Mission route analysed");
});

export const updateAuthorityApprovals = asyncHandler(async (req, res) => {
  const mission = await missionService.updateMissionAuthorityApprovals(
    req.user.organisationId,
    req.params.id,
    req.validated.body.approvals,
    req.user.role
  );
  const synctegralSync = await syncMissionPlanningToSynctegral(req.user.organisationId, mission.id);
  const responseMission = mergeMissionSyncResult(mission, synctegralSync);

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_AUTHORITY_APPROVALS_UPDATED",
    entityType: "MISSION",
    entityId: responseMission.id,
    metadata: {
      missionCode: responseMission.missionCode,
      name: responseMission.name,
      status: responseMission.status,
      synctegralSync: toAuditSyncResult(synctegralSync)
    }
  });

  return ok(res, serializeMission(responseMission), "Mission authority approvals updated");
});

export const syncSynctegral = asyncHandler(async (req, res) => {
  const mission = await missionService.ensureMissionExists(req.user.organisationId, req.params.id);
  const synctegralSync = await syncMissionPlanningToSynctegral(req.user.organisationId, mission.id);
  const responseMission = mergeMissionSyncResult(mission, synctegralSync);

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_SYNCTEGRAL_SYNC_RETRIED",
    entityType: "MISSION",
    entityId: responseMission.id,
    metadata: {
      missionCode: responseMission.missionCode,
      name: responseMission.name,
      status: responseMission.status,
      synctegralSync: toAuditSyncResult(synctegralSync)
    }
  });

  return ok(
    res,
    serializeMission(responseMission),
    synctegralSync?.synced ? "Synctegral sync completed" : "Synctegral sync needs attention"
  );
});

export const approve = asyncHandler(async (req, res) => {
  const mission = await missionService.approveMission(req.user.organisationId, req.params.id);
  let approvalNotification = null;

  try {
    approvalNotification = await missionService.notifyMissionApproved({
      mission,
      approver: req.user
    });
  } catch (error) {
    approvalNotification = { notified: 0, skipped: true, error: error.message };
    console.warn(`Mission approved notification failed: ${error.message}`);
  }

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_APPROVED",
    entityType: "MISSION",
    entityId: mission.id,
    metadata: {
      missionCode: mission.missionCode,
      name: mission.name,
      status: mission.status,
      approvalNotification
    }
  });
  return ok(res, serializeMission(mission), "Mission approved");
});

export const riskAssessment = asyncHandler(async (req, res) => {
  const assessment = await missionService.saveRiskAssessment(
    req.user.organisationId,
    req.params.id,
    req.validated.body,
    req.user.id
  );

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "RISK_ASSESSMENT_COMPLETED",
    entityType: "MISSION",
    entityId: req.params.id,
    metadata: {
      level: assessment.level,
      hazards: assessment.hazards,
      mitigations: assessment.mitigations
    }
  });

  return ok(res, assessment, "Risk assessment saved");
});

export const start = asyncHandler(async (req, res) => {
  await missionService.ensureMissionCanStart(req.user.organisationId, req.params.id);
  const synctegralSync = await updateSynctegralMissionStatus(req.user.organisationId, req.params.id, "ACTIVE");
  await assertSynctegralTransitionSynced({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    missionId: req.params.id,
    action: "MISSION_START_SYNCTEGRAL_FAILED",
    code: "SYNCTEGRAL_MISSION_START_SYNC_FAILED",
    message: "Synctegral did not accept the mission start. The mission was not started in DroneOps.",
    synctegralSync
  });

  const mission = await missionService.startMission(req.user.organisationId, req.params.id);
  const responseMission = mergeMissionSyncResult(mission, synctegralSync);

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_STARTED",
    entityType: "MISSION",
    entityId: responseMission.id,
    metadata: {
      missionCode: responseMission.missionCode,
      name: responseMission.name,
      status: responseMission.status,
      synctegralSync: toAuditSyncResult(synctegralSync)
    }
  });
  return ok(res, serializeMission(responseMission), "Mission started and synced with Synctegral");
});

export const complete = asyncHandler(async (req, res) => {
  await missionService.ensureMissionCanComplete(req.user.organisationId, req.params.id);
  const synctegralSync = await updateSynctegralMissionStatus(req.user.organisationId, req.params.id, "COMPLETED");
  await assertSynctegralTransitionSynced({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    missionId: req.params.id,
    action: "MISSION_COMPLETE_SYNCTEGRAL_FAILED",
    code: "SYNCTEGRAL_MISSION_COMPLETE_SYNC_FAILED",
    message: "Synctegral did not accept the mission completion. The mission remains active in DroneOps.",
    synctegralSync
  });

  const mission = await missionService.completeMission(req.user.organisationId, req.params.id);
  const responseMission = mergeMissionSyncResult(mission, synctegralSync);

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_COMPLETED",
    entityType: "MISSION",
    entityId: responseMission.id,
    metadata: {
      missionCode: responseMission.missionCode,
      name: responseMission.name,
      status: responseMission.status,
      synctegralSync: toAuditSyncResult(synctegralSync)
    }
  });
  return ok(res, serializeMission(responseMission), "Mission completed and synced with Synctegral");
});

export const remove = asyncHandler(async (req, res) => {
  const currentMission = await missionService.ensureMissionExists(req.user.organisationId, req.params.id);
  const shouldCancelSynctegralMission = currentMission.synctegralMissionId
    && !["ACTIVE", "COMPLETED", "ABORTED", "CANCELLED"].includes(currentMission.status);
  const synctegralSync = shouldCancelSynctegralMission
    ? await updateSynctegralMissionStatus(req.user.organisationId, req.params.id, "CANCELLED")
    : null;
  const mission = await missionService.deleteMission(req.user.organisationId, req.params.id);

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_DELETED",
    entityType: "MISSION",
    entityId: mission.id,
    metadata: {
      missionCode: mission.missionCode,
      name: mission.name,
      status: mission.status,
      synctegralMissionId: mission.synctegralMissionId,
      synctegralSync: toAuditSyncResult(synctegralSync)
    }
  });

  return ok(res, { id: mission.id }, "Mission deleted");
});

const serializeMission = (mission) => {
  if (!mission) return mission;

  const {
    drone,
    droneId,
    droneAssignments,
    pilot,
    pilotId,
    pilotAssignments,
    ...missionFields
  } = mission;

  return {
    ...missionFields,
    drones: serializeMissionDrones({ drone, droneId, droneAssignments }),
    pilots: serializeMissionPilots({ pilot, pilotId, pilotAssignments })
  };
};

const serializeMissionDrones = ({ drone, droneId, droneAssignments = [] }) => {
  const drones = [];
  const seen = new Set();
  const addDrone = (candidate, fallbackId, isPrimary = false) => {
    const id = candidate?.id ?? fallbackId;
    if (!id || seen.has(id)) return;
    seen.add(id);
    drones.push({
      id,
      droneCode: candidate?.droneCode ?? id,
      model: candidate?.model ?? null,
      manufacturer: candidate?.manufacturer ?? null,
      serialNumber: candidate?.serialNumber ?? null,
      status: candidate?.status ?? null,
      batteryType: candidate?.batteryType ?? null,
      telemetryProvider: candidate?.telemetryProvider ?? null,
      externalDeviceId: candidate?.externalDeviceId ?? null,
      isPrimary
    });
  };

  droneAssignments.forEach((assignment) => addDrone(assignment.drone, assignment.droneId, Boolean(assignment.isPrimary)));
  addDrone(drone, droneId, drones.length === 0 || Boolean(droneId));

  return drones.sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));
};

const serializeMissionPilots = ({ pilot, pilotId, pilotAssignments = [] }) => {
  const pilots = [];
  const seen = new Set();
  const addPilot = (candidate, fallbackId, isPrimary = false) => {
    const id = candidate?.id ?? fallbackId;
    if (!id || seen.has(id)) return;
    seen.add(id);
    pilots.push({
      id,
      name: candidate?.name ?? id,
      email: candidate?.email ?? null,
      role: candidate?.role ?? null,
      isPrimary
    });
  };

  pilotAssignments.forEach((assignment) => addPilot(assignment.pilot, assignment.pilotId, Boolean(assignment.isPrimary)));
  addPilot(pilot, pilotId, pilots.length === 0 || Boolean(pilotId));

  return pilots.sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));
};

const mergeMissionSyncResult = (mission, synctegralSync) => ({
  ...mission,
  synctegralSyncStatus: synctegralSync?.status ?? synctegralSync?.mission?.synctegralSyncStatus ?? mission.synctegralSyncStatus,
  synctegralMissionId: synctegralSync?.synctegralMissionId ?? synctegralSync?.mission?.synctegralMissionId ?? mission.synctegralMissionId,
  synctegralSyncError: synctegralSync?.synced ? null : synctegralSync?.error ?? synctegralSync?.mission?.synctegralSyncError ?? mission.synctegralSyncError,
  synctegralSyncedAt: synctegralSync?.mission?.synctegralSyncedAt ?? mission.synctegralSyncedAt
});

const toAuditSyncResult = (synctegralSync) => ({
  status: synctegralSync?.status,
  synctegralMissionId: synctegralSync?.synctegralMissionId,
  error: synctegralSync?.error ?? synctegralSync?.reason
});

const assertSynctegralTransitionSynced = async ({
  organisationId,
  actorId,
  missionId,
  action,
  code,
  message,
  synctegralSync
}) => {
  if (synctegralSync?.synced) return;

  await writeAudit({
    organisationId,
    actorId,
    action,
    entityType: "MISSION",
    entityId: missionId,
    metadata: {
      synctegralSync: toAuditSyncResult(synctegralSync)
    }
  });

  const detail = synctegralSync?.error ?? synctegralSync?.reason;
  throw new AppError(detail ? `${message} ${detail}` : message, 502, code);
};

const getMissionCreateAuditAction = (status) => {
  if (status === "AWAITING_AUTHORITY_APPROVAL") return "MISSION_AWAITING_AUTHORITY_APPROVAL";
  if (status === "PLANNED") return "MISSION_SUBMITTED_FOR_APPROVAL";
  return "MISSION_CREATED";
};

const getMissionCreateMessage = (status) => {
  if (status === "AWAITING_AUTHORITY_APPROVAL") return "Mission saved awaiting authority approval";
  if (status === "PLANNED") return "Mission submitted for approval";
  return "Mission created";
};

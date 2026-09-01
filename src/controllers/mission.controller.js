import { writeAudit } from "../services/audit.service.js";
import * as missionService from "../services/mission.service.js";
import { syncMissionPlanningToSynctegral, syncMissionToSynctegral, updateSynctegralMissionStatus } from "../services/synctegralMission.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const missions = await missionService.listMissions(req.user.organisationId);
  return ok(res, missions);
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
    action: responseMission.status === "PLANNED" ? "MISSION_SUBMITTED_FOR_APPROVAL" : "MISSION_CREATED",
    entityType: "MISSION",
    entityId: responseMission.id,
    metadata: {
      missionCode: responseMission.missionCode,
      name: responseMission.name,
      status: responseMission.status,
      requiresApproval: responseMission.status === "PLANNED",
      approvalNotification,
      synctegralSync: {
        status: synctegralSync?.status,
        synctegralMissionId: synctegralSync?.synctegralMissionId,
        error: synctegralSync?.error
      }
    }
  });

  return created(res, responseMission, responseMission.status === "PLANNED" ? "Mission submitted for approval" : "Mission created");
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
  return ok(res, responseMission, "Mission updated");
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
  return ok(res, mission, "Mission approved");
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
  const mission = await missionService.startMission(req.user.organisationId, req.params.id);
  const synctegralSync = await updateSynctegralMissionStatus(req.user.organisationId, mission.id, "ACTIVE");
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
  return ok(res, responseMission, "Mission started");
});

export const complete = asyncHandler(async (req, res) => {
  const mission = await missionService.completeMission(req.user.organisationId, req.params.id);
  const synctegralSync = await updateSynctegralMissionStatus(req.user.organisationId, mission.id, "COMPLETED");
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
  return ok(res, responseMission, "Mission completed");
});

const mergeMissionSyncResult = (mission, synctegralSync) => ({
  ...(synctegralSync?.mission ?? mission),
  synctegralSyncStatus: synctegralSync?.status ?? synctegralSync?.mission?.synctegralSyncStatus ?? mission.synctegralSyncStatus,
  synctegralMissionId: synctegralSync?.synctegralMissionId ?? synctegralSync?.mission?.synctegralMissionId ?? mission.synctegralMissionId,
  synctegralSyncError: synctegralSync?.error ?? synctegralSync?.mission?.synctegralSyncError ?? mission.synctegralSyncError
});

const toAuditSyncResult = (synctegralSync) => ({
  status: synctegralSync?.status,
  synctegralMissionId: synctegralSync?.synctegralMissionId,
  error: synctegralSync?.error
});

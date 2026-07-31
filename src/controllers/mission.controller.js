import { writeAudit } from "../services/audit.service.js";
import * as missionService from "../services/mission.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const missions = await missionService.listMissions(req.user.organisationId);
  return ok(res, missions);
});

export const create = asyncHandler(async (req, res) => {
  const mission = await missionService.createMission(req.user.organisationId, req.validated.body, req.user);

  let approvalNotification = null;
  if (mission.status === "PLANNED") {
    try {
      approvalNotification = await missionService.notifyMissionApprovalRequired({
        organisationId: req.user.organisationId,
        mission,
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
    action: mission.status === "PLANNED" ? "MISSION_SUBMITTED_FOR_APPROVAL" : "MISSION_CREATED",
    entityType: "MISSION",
    entityId: mission.id,
    metadata: {
      missionCode: mission.missionCode,
      name: mission.name,
      status: mission.status,
      requiresApproval: mission.status === "PLANNED",
      approvalNotification
    }
  });

  return created(res, mission, mission.status === "PLANNED" ? "Mission submitted for approval" : "Mission created");
});

export const update = asyncHandler(async (req, res) => {
  const mission = await missionService.updateMission(req.user.organisationId, req.params.id, req.validated.body, req.user.role);
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_UPDATED",
    entityType: "MISSION",
    entityId: mission.id,
    metadata: {
      missionCode: mission.missionCode,
      name: mission.name,
      status: mission.status,
      fields: Object.keys(req.validated.body)
    }
  });
  return ok(res, mission, "Mission updated");
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
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_STARTED",
    entityType: "MISSION",
    entityId: mission.id,
    metadata: {
      missionCode: mission.missionCode,
      name: mission.name,
      status: mission.status
    }
  });
  return ok(res, mission, "Mission started");
});

export const complete = asyncHandler(async (req, res) => {
  const mission = await missionService.completeMission(req.user.organisationId, req.params.id);
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_COMPLETED",
    entityType: "MISSION",
    entityId: mission.id,
    metadata: {
      missionCode: mission.missionCode,
      name: mission.name,
      status: mission.status
    }
  });
  return ok(res, mission, "Mission completed");
});

import { writeAudit } from "../services/audit.service.js";
import * as missionService from "../services/mission.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const missions = await missionService.listMissions(req.user.organisationId);
  return ok(res, missions);
});

export const create = asyncHandler(async (req, res) => {
  const mission = await missionService.createMission(req.user.organisationId, req.validated.body, req.user.role);
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
      requiresApproval: mission.status === "PLANNED"
    }
  });
  return created(res, mission, mission.status === "PLANNED" ? "Mission submitted for approval" : "Mission created");
});

export const update = asyncHandler(async (req, res) => {
  const mission = await missionService.updateMission(req.user.organisationId, req.params.id, req.body, req.user.role);
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
      fields: Object.keys(req.body)
    }
  });
  return ok(res, mission, "Mission updated");
});

export const approve = asyncHandler(async (req, res) => {
  const mission = await missionService.approveMission(req.user.organisationId, req.params.id);
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "MISSION_APPROVED",
    entityType: "MISSION",
    entityId: mission.id,
    metadata: {
      missionCode: mission.missionCode,
      name: mission.name,
      status: mission.status
    }
  });
  return ok(res, mission, "Mission approved");
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

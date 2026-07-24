import { writeAudit } from "../services/audit.service.js";
import * as droneService from "../services/drone.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, noContent, ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const drones = await droneService.listDrones(req.user.organisationId);
  return ok(res, drones);
});

export const create = asyncHandler(async (req, res) => {
  const drone = await droneService.createDrone(req.user.organisationId, req.validated.body);
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "DRONE_CREATED",
    entityType: "DRONE",
    entityId: drone.id,
    metadata: {
      droneCode: drone.droneCode,
      model: drone.model,
      status: drone.status
    }
  });
  return created(res, drone, "Drone registered");
});

export const update = asyncHandler(async (req, res) => {
  const drone = await droneService.updateDrone(req.user.organisationId, req.params.id, req.body);
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "DRONE_UPDATED",
    entityType: "DRONE",
    entityId: drone.id,
    metadata: {
      droneCode: drone.droneCode,
      model: drone.model,
      status: drone.status,
      fields: Object.keys(req.body)
    }
  });
  return ok(res, drone, "Drone updated");
});

export const remove = asyncHandler(async (req, res) => {
  const drone = await droneService.deleteDrone(req.user.organisationId, req.params.id);
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "DRONE_DELETED",
    entityType: "DRONE",
    entityId: drone.id,
    metadata: {
      droneCode: drone.droneCode,
      model: drone.model
    }
  });
  return noContent(res);
});

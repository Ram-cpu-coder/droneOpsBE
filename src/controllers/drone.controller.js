import { writeAudit } from "../services/audit.service.js";
import {
  createDroneModel,
  listDroneModelCatalog,
  removeDroneModel,
  updateDroneModel
} from "../services/droneCatalog.service.js";
import * as droneService from "../services/drone.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, noContent, ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const drones = await droneService.listDrones(req.user.organisationId);
  return ok(res, drones);
});

export const catalog = asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === "true" && req.user.role === "SYSTEM_ADMINISTRATOR";
  return ok(res, await listDroneModelCatalog({ includeInactive }));
});

export const createCatalogModel = asyncHandler(async (req, res) => {
  const model = await createDroneModel(req.validated.body);
  return created(res, model, "Drone model added");
});

export const updateCatalogModel = asyncHandler(async (req, res) => {
  const model = await updateDroneModel(req.params.id, req.validated.body);
  return ok(res, model, "Drone model updated");
});

export const removeCatalogModel = asyncHandler(async (req, res) => {
  await removeDroneModel(req.params.id);
  return noContent(res);
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
  const drone = await droneService.updateDrone(req.user.organisationId, req.params.id, req.validated.body);
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
      fields: Object.keys(req.validated.body)
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

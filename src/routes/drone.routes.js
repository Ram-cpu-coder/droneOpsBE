import { Router } from "express";
import * as droneController from "../controllers/drone.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { droneCatalogModelSchema, droneCreateSchema, idParamSchema } from "../validators/core.validators.js";

export const droneRouter = Router();

droneRouter.use(requireAuth);
droneRouter.get("/catalog", requirePermission("drones:read"), droneController.catalog);
droneRouter.post("/catalog", requirePermission("*"), validate(droneCatalogModelSchema), droneController.createCatalogModel);
droneRouter.put("/catalog/:id", requirePermission("*"), validate(droneCatalogModelSchema), droneController.updateCatalogModel);
droneRouter.delete("/catalog/:id", requirePermission("*"), validate(idParamSchema), droneController.removeCatalogModel);
droneRouter.get("/", requirePermission("drones:read"), droneController.list);
droneRouter.post("/", requirePermission("drones:manage"), validate(droneCreateSchema), droneController.create);
droneRouter.put("/:id", requirePermission("drones:manage"), validate(idParamSchema), droneController.update);
droneRouter.delete("/:id", requirePermission("drones:manage"), validate(idParamSchema), droneController.remove);

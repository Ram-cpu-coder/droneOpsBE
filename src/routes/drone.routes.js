import { Router } from "express";
import * as droneController from "../controllers/drone.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { apiReadRateLimiter, apiWriteRateLimiter } from "../middleware/rateLimiters.js";
import { validate } from "../middleware/validate.js";
import { droneCatalogModelSchema, droneCreateSchema, droneUpdateSchema, idParamSchema } from "../validators/core.validators.js";

export const droneRouter = Router();

droneRouter.use(requireAuth);
droneRouter.get("/catalog", apiReadRateLimiter, requirePermission("drones:read"), droneController.catalog);
droneRouter.post("/catalog", apiWriteRateLimiter, requirePermission("*"), validate(droneCatalogModelSchema), droneController.createCatalogModel);
droneRouter.put("/catalog/:id", apiWriteRateLimiter, requirePermission("*"), validate(droneCatalogModelSchema), droneController.updateCatalogModel);
droneRouter.delete("/catalog/:id", apiWriteRateLimiter, requirePermission("*"), validate(idParamSchema), droneController.removeCatalogModel);
droneRouter.get("/", apiReadRateLimiter, requirePermission("drones:read"), droneController.list);
droneRouter.post("/", apiWriteRateLimiter, requirePermission("drones:manage"), validate(droneCreateSchema), droneController.create);
droneRouter.put("/:id", apiWriteRateLimiter, requirePermission("drones:manage"), validate(droneUpdateSchema), droneController.update);
droneRouter.delete("/:id", apiWriteRateLimiter, requirePermission("drones:manage"), validate(idParamSchema), droneController.remove);

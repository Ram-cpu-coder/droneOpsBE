import { Router } from "express";
import * as droneController from "../controllers/drone.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { droneCreateSchema, idParamSchema } from "../validators/core.validators.js";

export const droneRouter = Router();

droneRouter.use(requireAuth);
droneRouter.get("/", requirePermission("drones:read"), droneController.list);
droneRouter.post("/", requirePermission("drones:manage"), validate(droneCreateSchema), droneController.create);
droneRouter.put("/:id", requirePermission("drones:manage"), validate(idParamSchema), droneController.update);
droneRouter.delete("/:id", requirePermission("drones:manage"), validate(idParamSchema), droneController.remove);

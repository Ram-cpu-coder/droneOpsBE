import { Router } from "express";
import * as incidentController from "../controllers/incident.controller.js";
import { requireAnyPermission, requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParamSchema, incidentCreateSchema, incidentUpdateSchema } from "../validators/core.validators.js";

export const incidentRouter = Router();

incidentRouter.use(requireAuth);
incidentRouter.get("/", requirePermission("incidents:read"), incidentController.list);
incidentRouter.post("/", requireAnyPermission(["incidents:manage", "incidents:create"]), validate(incidentCreateSchema), incidentController.create);
incidentRouter.put("/:id", requirePermission("incidents:manage"), validate(incidentUpdateSchema), incidentController.update);
incidentRouter.delete("/:id", requirePermission("incidents:manage"), validate(idParamSchema), incidentController.remove);

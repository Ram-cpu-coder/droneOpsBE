import { Router } from "express";
import * as missionController from "../controllers/mission.controller.js";
import { requireAnyPermission, requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParamSchema, missionCreateSchema, missionUpdateSchema, riskAssessmentSchema } from "../validators/core.validators.js";

export const missionRouter = Router();

missionRouter.use(requireAuth);
missionRouter.get("/", requirePermission("missions:read"), missionController.list);
missionRouter.post("/", requirePermission("missions:manage"), validate(missionCreateSchema), missionController.create);
missionRouter.put("/:id", requirePermission("missions:manage"), validate(missionUpdateSchema), missionController.update);
missionRouter.post("/:id/approve", requirePermission("*"), validate(idParamSchema), missionController.approve);
missionRouter.post("/:id/risk-assessment", requireAnyPermission(["risk:complete", "risk:manage", "*"]), validate(riskAssessmentSchema), missionController.riskAssessment);
missionRouter.post("/:id/start", requirePermission("missions:manage"), validate(idParamSchema), missionController.start);
missionRouter.post("/:id/complete", requirePermission("missions:manage"), validate(idParamSchema), missionController.complete);

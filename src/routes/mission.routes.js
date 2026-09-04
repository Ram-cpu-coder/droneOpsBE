import { Router } from "express";
import * as missionController from "../controllers/mission.controller.js";
import { requireAnyPermission, requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParamSchema, missionAuthorityApprovalsSchema, missionCreateSchema, missionRouteAnalysisSchema, missionUpdateSchema, riskAssessmentSchema } from "../validators/core.validators.js";

export const missionRouter = Router();

missionRouter.use(requireAuth);
missionRouter.get("/", requirePermission("missions:read"), missionController.list);
missionRouter.post("/analyse-route", requirePermission("missions:manage"), validate(missionRouteAnalysisSchema), missionController.analyseRoute);
missionRouter.post("/", requirePermission("missions:manage"), validate(missionCreateSchema), missionController.create);
missionRouter.put("/:id", requirePermission("missions:manage"), validate(missionUpdateSchema), missionController.update);
missionRouter.patch("/:id/authority-approvals", requirePermission("missions:manage"), validate(missionAuthorityApprovalsSchema), missionController.updateAuthorityApprovals);
missionRouter.post("/:id/sync-synctegral", requirePermission("missions:manage"), validate(idParamSchema), missionController.syncSynctegral);
missionRouter.post("/:id/approve", requirePermission("*"), validate(idParamSchema), missionController.approve);
missionRouter.post("/:id/risk-assessment", requireAnyPermission(["risk:complete", "risk:manage", "*"]), validate(riskAssessmentSchema), missionController.riskAssessment);
missionRouter.post("/:id/start", requirePermission("missions:manage"), validate(idParamSchema), missionController.start);
missionRouter.post("/:id/complete", requirePermission("missions:manage"), validate(idParamSchema), missionController.complete);
missionRouter.delete("/:id", requirePermission("missions:manage"), validate(idParamSchema), missionController.remove);

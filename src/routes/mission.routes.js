import { Router } from "express";
import * as missionController from "../controllers/mission.controller.js";
import { requireAnyPermission, requireAuth, requirePermission } from "../middleware/auth.js";
import { apiReadRateLimiter, apiWriteRateLimiter } from "../middleware/rateLimiters.js";
import { validate } from "../middleware/validate.js";
import { idParamSchema, missionAuthorityApprovalsSchema, missionCreateSchema, missionRouteAnalysisSchema, missionUpdateSchema, riskAssessmentSchema } from "../validators/core.validators.js";

export const missionRouter = Router();

missionRouter.use(requireAuth);
missionRouter.get("/", apiReadRateLimiter, requirePermission("missions:read"), missionController.list);
missionRouter.post("/analyse-route", apiWriteRateLimiter, requirePermission("missions:manage"), validate(missionRouteAnalysisSchema), missionController.analyseRoute);
missionRouter.post("/", apiWriteRateLimiter, requirePermission("missions:manage"), validate(missionCreateSchema), missionController.create);
missionRouter.put("/:id", apiWriteRateLimiter, requirePermission("missions:manage"), validate(missionUpdateSchema), missionController.update);
missionRouter.patch("/:id/authority-approvals", apiWriteRateLimiter, requirePermission("missions:manage"), validate(missionAuthorityApprovalsSchema), missionController.updateAuthorityApprovals);
missionRouter.post("/:id/sync-synctegral", apiWriteRateLimiter, requirePermission("missions:manage"), validate(idParamSchema), missionController.syncSynctegral);
missionRouter.post("/:id/approve", apiWriteRateLimiter, requirePermission("*"), validate(idParamSchema), missionController.approve);
missionRouter.post("/:id/risk-assessment", apiWriteRateLimiter, requireAnyPermission(["risk:complete", "risk:manage", "*"]), validate(riskAssessmentSchema), missionController.riskAssessment);
missionRouter.post("/:id/start", apiWriteRateLimiter, requirePermission("missions:manage"), validate(idParamSchema), missionController.start);
missionRouter.post("/:id/complete", apiWriteRateLimiter, requirePermission("missions:manage"), validate(idParamSchema), missionController.complete);
missionRouter.delete("/:id", apiWriteRateLimiter, requirePermission("missions:manage"), validate(idParamSchema), missionController.remove);

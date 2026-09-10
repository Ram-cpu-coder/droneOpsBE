import { Router } from "express";
import * as reportController from "../controllers/report.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { apiReadRateLimiter, apiWriteRateLimiter } from "../middleware/rateLimiters.js";
import { validate } from "../middleware/validate.js";
import { idParamSchema, reportCreateSchema, reportGenerateSchema, reportStatusSchema } from "../validators/core.validators.js";

export const reportRouter = Router();

reportRouter.use(requireAuth);
reportRouter.get("/", apiReadRateLimiter, requirePermission("reports:read"), reportController.list);
reportRouter.get("/summary", apiReadRateLimiter, requirePermission("reports:read"), reportController.summary);
reportRouter.post("/generate/preview", apiWriteRateLimiter, requirePermission("reports:manage"), validate(reportGenerateSchema), reportController.previewGenerate);
reportRouter.post("/generate", apiWriteRateLimiter, requirePermission("reports:manage"), validate(reportGenerateSchema), reportController.generate);
reportRouter.post("/", apiWriteRateLimiter, requirePermission("reports:manage"), validate(reportCreateSchema), reportController.create);
reportRouter.put("/:id/status", apiWriteRateLimiter, requirePermission("reports:manage"), validate(reportStatusSchema), reportController.updateStatus);
reportRouter.delete("/:id", apiWriteRateLimiter, requirePermission("*"), validate(idParamSchema), reportController.remove);

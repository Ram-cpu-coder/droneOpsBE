import { Router } from "express";
import * as reportController from "../controllers/report.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParamSchema, reportCreateSchema, reportGenerateSchema, reportStatusSchema } from "../validators/core.validators.js";

export const reportRouter = Router();

reportRouter.use(requireAuth);
reportRouter.get("/", requirePermission("reports:read"), reportController.list);
reportRouter.get("/summary", requirePermission("reports:read"), reportController.summary);
reportRouter.post("/generate", requirePermission("reports:manage"), validate(reportGenerateSchema), reportController.generate);
reportRouter.post("/", requirePermission("reports:manage"), validate(reportCreateSchema), reportController.create);
reportRouter.put("/:id/status", requirePermission("reports:manage"), validate(reportStatusSchema), reportController.updateStatus);
reportRouter.delete("/:id", requirePermission("*"), validate(idParamSchema), reportController.remove);

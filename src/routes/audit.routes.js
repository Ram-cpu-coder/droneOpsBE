import { Router } from "express";
import * as auditController from "../controllers/audit.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const auditRouter = Router();

auditRouter.use(requireAuth);
auditRouter.get("/", requirePermission("audit:read"), auditController.list);


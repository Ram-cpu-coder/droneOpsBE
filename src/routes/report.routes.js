import { Router } from "express";
import * as reportController from "../controllers/report.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const reportRouter = Router();

reportRouter.use(requireAuth);
reportRouter.get("/", requirePermission("reports:read"), reportController.list);
reportRouter.get("/summary", requirePermission("reports:read"), reportController.summary);
reportRouter.post("/generate", requirePermission("reports:read"), reportController.generate);
reportRouter.post("/", requirePermission("reports:manage"), reportController.create);
reportRouter.delete("/:id", requirePermission("*"), reportController.remove);

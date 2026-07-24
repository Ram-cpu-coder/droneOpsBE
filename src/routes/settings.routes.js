import { Router } from "express";
import * as settingsController from "../controllers/settings.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);
settingsRouter.get("/organisation", settingsController.getOrganisation);
settingsRouter.put("/organisation", requirePermission("*"), settingsController.updateOrganisation);
settingsRouter.get("/alert-thresholds", settingsController.getAlertThresholds);
settingsRouter.put("/alert-thresholds", requirePermission("*"), settingsController.updateAlertThresholds);

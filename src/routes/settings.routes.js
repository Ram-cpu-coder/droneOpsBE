import { Router } from "express";
import * as settingsController from "../controllers/settings.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { alertThresholdSchema, organisationUpdateSchema } from "../validators/core.validators.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);
settingsRouter.get("/organisation", settingsController.getOrganisation);
settingsRouter.put("/organisation", requirePermission("*"), validate(organisationUpdateSchema), settingsController.updateOrganisation);
settingsRouter.post("/organisation/join-code/regenerate", requirePermission("*"), settingsController.regenerateOrganisationJoinCode);
settingsRouter.get("/alert-thresholds", settingsController.getAlertThresholds);
settingsRouter.put("/alert-thresholds", requirePermission("*"), validate(alertThresholdSchema), settingsController.updateAlertThresholds);

import { Router } from "express";
import * as telemetryController from "../controllers/telemetry.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { telemetryCreateSchema } from "../validators/core.validators.js";

export const telemetryRouter = Router();

telemetryRouter.use(requireAuth);
telemetryRouter.post("/", requirePermission("telemetry:read"), validate(telemetryCreateSchema), telemetryController.ingest);
telemetryRouter.get("/live", requirePermission("telemetry:read"), telemetryController.latest);
telemetryRouter.get("/:droneId", requirePermission("telemetry:read"), telemetryController.byDrone);

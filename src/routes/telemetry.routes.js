import { Router } from "express";
import * as telemetryController from "../controllers/telemetry.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { apiWriteRateLimiter, telemetryReadRateLimiter } from "../middleware/rateLimiters.js";
import { validate } from "../middleware/validate.js";
import { telemetryCreateSchema } from "../validators/core.validators.js";

export const telemetryRouter = Router();

telemetryRouter.use(requireAuth);
telemetryRouter.post("/", apiWriteRateLimiter, requirePermission("*"), validate(telemetryCreateSchema), telemetryController.ingest);
telemetryRouter.get("/live", telemetryReadRateLimiter, requirePermission("telemetry:read"), telemetryController.latest);
telemetryRouter.get("/status", telemetryReadRateLimiter, requirePermission("telemetry:read"), telemetryController.status);
telemetryRouter.post("/synctegral/sync", apiWriteRateLimiter, requirePermission("*"), telemetryController.syncSynctegral);
telemetryRouter.get("/:droneId", telemetryReadRateLimiter, requirePermission("telemetry:read"), telemetryController.byDrone);

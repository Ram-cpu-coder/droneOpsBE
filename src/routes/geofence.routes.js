import { Router } from "express";
import * as geofenceController from "../controllers/geofence.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const geofenceRouter = Router();

geofenceRouter.use(requireAuth);
geofenceRouter.get("/", requirePermission("geofences:read"), geofenceController.list);
geofenceRouter.post("/", requirePermission("geofences:manage"), geofenceController.create);

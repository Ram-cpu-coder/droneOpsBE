import { Router } from "express";
import * as geofenceController from "../controllers/geofence.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const geofenceRouter = Router();

geofenceRouter.use(requireAuth);
geofenceRouter.get("/", requirePermission("geofences:read"), geofenceController.list);
geofenceRouter.get("/government/status", requirePermission("geofences:read"), geofenceController.governmentStatus);
geofenceRouter.post("/government/sync", requirePermission("geofences:manage"), geofenceController.syncGovernment);
geofenceRouter.post("/", requirePermission("geofences:manage"), geofenceController.create);
geofenceRouter.put("/:id", requirePermission("geofences:manage"), geofenceController.update);
geofenceRouter.delete("/:id", requirePermission("geofences:manage"), geofenceController.remove);

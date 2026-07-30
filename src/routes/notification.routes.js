import { Router } from "express";
import * as notificationController from "../controllers/notification.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const notificationRouter = Router();

notificationRouter.use(requireAuth);
notificationRouter.get("/", notificationController.list);
notificationRouter.post("/read", notificationController.markRead);
notificationRouter.post("/read-all", notificationController.markAllRead);

import * as notificationService from "../services/notification.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const notifications = await notificationService.listNotifications(req.user, req.query);
  return ok(res, notifications);
});

export const markRead = asyncHandler(async (req, res) => {
  const notifications = await notificationService.markNotificationsRead(req.user, req.body?.auditLogIds ?? []);
  return ok(res, notifications, "Notifications marked read");
});

export const markAllRead = asyncHandler(async (req, res) => {
  const notifications = await notificationService.markAllNotificationsRead(req.user);
  return ok(res, notifications, "All notifications marked read");
});

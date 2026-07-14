import * as auditService from "../services/audit.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const logs = await auditService.listAuditLogs(req.user.organisationId, req.query);
  return ok(res, logs);
});


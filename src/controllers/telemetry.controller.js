import * as telemetryService from "../services/telemetry.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/apiResponse.js";

export const ingest = asyncHandler(async (req, res) => {
  const result = await telemetryService.ingestTelemetry(req.user.organisationId, req.validated.body);
  return created(res, result, "Telemetry ingested");
});

export const latest = asyncHandler(async (req, res) => {
  const result = await telemetryService.getLatestTelemetry(req.user.organisationId);
  return ok(res, result, "Latest live telemetry");
});

export const byDrone = asyncHandler(async (req, res) => {
  const result = await telemetryService.getDroneTelemetry(req.user.organisationId, req.params.droneId, Number(req.query.limit ?? 100));
  return ok(res, result, "Drone telemetry");
});

export const replay = asyncHandler(async (req, res) => {
  const result = await telemetryService.getMissionReplay(req.user.organisationId, req.params.id);
  return ok(res, result, "Mission replay");
});

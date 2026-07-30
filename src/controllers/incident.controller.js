import { writeAudit } from "../services/audit.service.js";
import * as incidentService from "../services/incident.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const incidents = await incidentService.listIncidents(req.user.organisationId);
  return ok(res, incidents);
});

export const create = asyncHandler(async (req, res) => {
  const incident = await incidentService.createIncident(req.user.organisationId, req.user.id, req.validated.body);
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "INCIDENT_CREATED",
    entityType: "INCIDENT",
    entityId: incident.id,
    metadata: {
      incidentCode: incident.incidentCode,
      title: incident.title,
      severity: incident.severity,
      status: incident.status
    }
  });
  return created(res, incident, "Incident logged");
});

export const update = asyncHandler(async (req, res) => {
  const incident = await incidentService.updateIncident(req.user.organisationId, req.params.id, req.body);
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "INCIDENT_UPDATED",
    entityType: "INCIDENT",
    entityId: incident.id,
    metadata: {
      incidentCode: incident.incidentCode,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      fields: Object.keys(req.body)
    }
  });
  return ok(res, incident, "Incident updated");
});

export const remove = asyncHandler(async (req, res) => {
  const incident = await incidentService.deleteIncident(req.user.organisationId, req.params.id);
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "INCIDENT_DELETED",
    entityType: "INCIDENT",
    entityId: incident.id,
    metadata: {
      incidentCode: incident.incidentCode,
      title: incident.title,
      severity: incident.severity
    }
  });
  return ok(res, { id: incident.id }, "Incident deleted");
});

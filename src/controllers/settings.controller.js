import crypto from "node:crypto";
import * as alertSettingsService from "../services/alertSettings.service.js";
import { writeAudit } from "../services/audit.service.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/apiResponse.js";

const organisationSelect = {
  id: true,
  name: true,
  industry: true,
  joinCode: true,
  createdAt: true,
  updatedAt: true
};

export const getOrganisation = asyncHandler(async (req, res) => {
  const organisation = await prisma.organisation.findUnique({
    where: { id: req.user.organisationId },
    select: organisationSelect
  });

  if (!organisation) throw new AppError("Organisation not found", 404, "ORGANISATION_NOT_FOUND");
  return ok(res, organisation, "Organisation settings");
});

export const updateOrganisation = asyncHandler(async (req, res) => {
  const name = req.body.name?.trim();
  const industry = req.body.industry?.trim() || null;

  if (!name) throw new AppError("Organisation name is required", 400, "ORGANISATION_NAME_REQUIRED");

  const organisation = await prisma.organisation.update({
    where: { id: req.user.organisationId },
    data: { name, industry },
    select: organisationSelect
  });

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "ORGANISATION_UPDATED",
    entityType: "ORGANISATION",
    entityId: organisation.id,
    metadata: {
      name: organisation.name,
      industry: organisation.industry
    }
  });

  return ok(res, organisation, "Organisation updated");
});

export const regenerateOrganisationJoinCode = asyncHandler(async (req, res) => {
  const organisation = await prisma.organisation.update({
    where: { id: req.user.organisationId },
    data: { joinCode: await generateOrganisationJoinCode() },
    select: organisationSelect
  });

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "ORGANISATION_JOIN_CODE_REGENERATED",
    entityType: "ORGANISATION",
    entityId: organisation.id,
    metadata: {
      name: organisation.name
    }
  });

  return ok(res, organisation, "Organisation join code regenerated");
});

export const getAlertThresholds = asyncHandler(async (req, res) => {
  const thresholds = await alertSettingsService.getAlertThresholds(req.user.organisationId);
  return ok(res, thresholds, "Alert thresholds");
});

export const updateAlertThresholds = asyncHandler(async (req, res) => {
  const thresholds = await alertSettingsService.updateAlertThresholds(req.user.organisationId, req.body);

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "ALERT_THRESHOLDS_UPDATED",
    entityType: "SETTINGS",
    entityId: req.user.organisationId,
    metadata: thresholds
  });

  return ok(res, thresholds, "Alert thresholds updated");
});

const generateOrganisationJoinCode = async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `ORG-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const existing = await prisma.organisation.findUnique({ where: { joinCode: code }, select: { id: true } });
    if (!existing) return code;
  }

  return `ORG-${Date.now().toString(36).toUpperCase()}`;
};

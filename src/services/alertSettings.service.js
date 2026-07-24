import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";

const clampPercent = (value, field) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new AppError(`${field} must be between 0 and 100`, 400, "INVALID_ALERT_THRESHOLD");
  }
  return Math.round(number);
};

const clampWindSpeed = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 250) {
    throw new AppError("Maximum wind speed must be between 0 and 250 km/h", 400, "INVALID_ALERT_THRESHOLD");
  }
  return Math.round(number);
};

const defaultAlertThresholds = {
  minimumLandingBattery: clampPercent(env.lowBatteryThreshold, "Minimum landing battery"),
  maximumWindSpeed: 34,
  lowSignalWarning: 70
};

const toApiThresholds = (settings) => ({
  minimumLandingBattery: settings.minimumLandingBattery,
  maximumWindSpeed: settings.maximumWindSpeed,
  lowSignalWarning: settings.lowSignalWarning
});

const normalizePayload = (payload = {}) => ({
  minimumLandingBattery: clampPercent(payload.minimumLandingBattery, "Minimum landing battery"),
  maximumWindSpeed: clampWindSpeed(payload.maximumWindSpeed),
  lowSignalWarning: clampPercent(payload.lowSignalWarning, "Low signal warning")
});

export const getAlertThresholds = async (organisationId) => {
  // Each tenant receives a settings row on first read so alert rules are always organisation-scoped.
  const settings = await prisma.alertSettings.upsert({
    where: { organisationId },
    update: {},
    create: {
      organisationId,
      ...defaultAlertThresholds
    }
  });

  return toApiThresholds(settings);
};

export const updateAlertThresholds = async (organisationId, payload = {}) => {
  const thresholds = normalizePayload(payload);

  const settings = await prisma.alertSettings.upsert({
    where: { organisationId },
    update: thresholds,
    create: {
      organisationId,
      ...thresholds
    }
  });

  return toApiThresholds(settings);
};

export const getTelemetryAlertThresholds = async (organisationId) => {
  try {
    return await getAlertThresholds(organisationId);
  } catch {
    // Telemetry ingestion should continue with conservative defaults if settings storage is temporarily unreachable.
    return { ...defaultAlertThresholds };
  }
};

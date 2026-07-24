import { prisma } from "../config/prisma.js";
import { getTelemetryAlertThresholds } from "./alertSettings.service.js";
import { syncMissionProgressFromTelemetry } from "./missionProgress.service.js";
import { publishAlert, publishTelemetry } from "../sockets/index.js";
import { AppError } from "../utils/AppError.js";
import { isPointInPolygon } from "../utils/geo.js";

const toApiTelemetry = (record) => ({
  id: record.id,
  droneId: record.droneId,
  missionId: record.missionId,
  timestamp: record.timestamp,
  location: {
    latitude: record.latitude,
    longitude: record.longitude,
    altitude: record.altitude
  },
  velocity: {
    speed: record.speed,
    heading: record.heading
  },
  battery: {
    level: record.batteryLevel,
    voltage: record.batteryVoltage
  },
  signal: {
    strength: record.signalStrength,
    linkQuality: record.linkQuality
  },
  status: record.status
});

export const ingestTelemetry = async (organisationId, payload) => {
  const drone = await prisma.drone.findFirst({
    where: {
      organisationId,
      OR: [{ id: payload.drone_id }, { droneCode: payload.drone_id }]
    }
  });
  if (!drone) throw new AppError("Telemetry drone not found", 404, "TELEMETRY_DRONE_NOT_FOUND");

  const mission = payload.mission_id
    ? await prisma.mission.findFirst({
        where: {
          organisationId,
          OR: [{ id: payload.mission_id }, { missionCode: payload.mission_id }]
        }
      })
    : null;

  const record = await prisma.telemetryLog.create({
    data: {
      organisationId,
      droneId: drone.id,
      missionId: mission?.id,
      timestamp: new Date(payload.timestamp),
      latitude: payload.location.latitude,
      longitude: payload.location.longitude,
      altitude: payload.location.altitude,
      speed: payload.velocity.speed,
      heading: payload.velocity.heading,
      batteryLevel: payload.battery.level,
      batteryVoltage: payload.battery.voltage,
      signalStrength: payload.signal.strength,
      linkQuality: payload.signal.link_quality,
      status: payload.status,
      rawPayload: payload
    }
  });

  const [alerts, missionProgress] = await Promise.all([
    evaluateTelemetryAlerts(organisationId, drone, record),
    syncMissionProgressFromTelemetry(mission, record)
  ]);
  const apiTelemetry = toApiTelemetry(record);
  publishTelemetry(apiTelemetry);
  alerts.forEach(publishAlert);

  await prisma.drone.update({
    where: { id: drone.id },
    data: {
      status: payload.status === "IN_FLIGHT" ? "IN_MISSION" : drone.status,
      connectorStatus: "ONLINE",
      lastTelemetryAt: record.timestamp
    }
  });

  return { telemetry: apiTelemetry, alerts, missionProgress };
};

export const getLatestTelemetry = async (organisationId) => {
  const drones = await prisma.drone.findMany({
    where: { organisationId },
    select: { id: true, droneCode: true, model: true, status: true }
  });

  const latest = await Promise.all(
    drones.map(async (drone) => {
      const record = await prisma.telemetryLog.findFirst({
        where: { droneId: drone.id },
        orderBy: { timestamp: "desc" }
      });
      return { drone, telemetry: record ? toApiTelemetry(record) : null };
    })
  );

  return latest;
};

export const getDroneTelemetry = async (organisationId, droneIdentifier, limit = 100) => {
  const drone = await prisma.drone.findFirst({
    where: {
      organisationId,
      OR: [{ id: droneIdentifier }, { droneCode: droneIdentifier }]
    }
  });
  if (!drone) throw new AppError("Drone not found", 404, "DRONE_NOT_FOUND");

  const records = await prisma.telemetryLog.findMany({
    where: { droneId: drone.id },
    orderBy: { timestamp: "desc" },
    take: limit
  });

  return records.map(toApiTelemetry).reverse();
};

export const getMissionReplay = async (organisationId, missionId) => {
  const mission = await prisma.mission.findFirst({
    where: {
      organisationId,
      OR: [{ id: missionId }, { missionCode: missionId }]
    }
  });
  if (!mission) throw new AppError("Mission not found", 404, "MISSION_NOT_FOUND");

  const records = await prisma.telemetryLog.findMany({
    where: { missionId: mission.id },
    orderBy: { timestamp: "asc" }
  });

  return records.map(toApiTelemetry);
};

const evaluateTelemetryAlerts = async (organisationId, drone, record) => {
  const alerts = [];
  const thresholds = await getTelemetryAlertThresholds(organisationId);

  if (record.batteryLevel < thresholds.minimumLandingBattery) {
    alerts.push({
      type: "LOW_BATTERY",
      severity: "HIGH",
      droneId: drone.id,
      message: `${drone.droneCode} battery below ${thresholds.minimumLandingBattery}%`,
      timestamp: record.timestamp
    });
  }

  if (record.signalStrength < thresholds.lowSignalWarning || record.linkQuality.toUpperCase() === "LOST") {
    alerts.push({
      type: "SIGNAL_LOSS",
      severity: record.signalStrength <= 5 || record.linkQuality.toUpperCase() === "LOST" ? "CRITICAL" : "MEDIUM",
      droneId: drone.id,
      message: `${drone.droneCode} signal below ${thresholds.lowSignalWarning}%`,
      timestamp: record.timestamp
    });
    if (record.signalStrength <= 5 || record.linkQuality.toUpperCase() === "LOST") {
      await prisma.drone.update({ where: { id: drone.id }, data: { status: "DISCONNECTED" } });
    }
  }

  const geofences = await prisma.geofence.findMany({
    where: { organisationId, isActive: true }
  });

  for (const geofence of geofences) {
    const polygon = Array.isArray(geofence.polygon) ? geofence.polygon : geofence.polygon?.coordinates?.[0];
    if (!Array.isArray(polygon)) continue;

    const breached = isPointInPolygon([record.longitude, record.latitude], polygon);
    if (breached) {
      alerts.push({
        type: "GEOFENCE_BREACH",
        severity: geofence.type === "RESTRICTED" ? "CRITICAL" : "MEDIUM",
        droneId: drone.id,
        geofenceId: geofence.id,
        message: `${drone.droneCode} entered ${geofence.type.toLowerCase()} geofence: ${geofence.name}`,
        timestamp: record.timestamp
      });
    }
  }

  return alerts;
};

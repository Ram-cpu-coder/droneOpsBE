import { prisma } from "../config/prisma.js";
import { getTelemetryAlertThresholds } from "./alertSettings.service.js";
import { syncMissionDroneStatuses } from "./drone.service.js";
import { syncMissionProgressFromTelemetry } from "./missionProgress.service.js";
import { publishAlert, publishTelemetry } from "../sockets/index.js";
import { AppError } from "../utils/AppError.js";
import { isPointInPolygon } from "../utils/geo.js";

const toApiTelemetry = (record) => ({
  id: record.id,
  organisationId: record.organisationId,
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
  status: record.status,
  source: record.rawPayload?.source,
  simulator: record.rawPayload?.simulator
});

export const ingestTelemetry = async (organisationId, payload) => {
  await syncMissionDroneStatuses(organisationId);

  const drone = await prisma.drone.findFirst({
    where: {
      organisationId,
      OR: [{ id: payload.drone_id }, { droneCode: payload.drone_id }]
    }
  });
  if (!drone) throw new AppError("Telemetry drone not found", 404, "TELEMETRY_DRONE_NOT_FOUND");

  const mission = await resolveTelemetryMission(organisationId, drone.id, payload.mission_id);

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
  if (!payload.suppressLivePublish) {
    publishTelemetry(apiTelemetry);
  }
  alerts.forEach(publishAlert);

  await prisma.drone.update({
    where: { id: drone.id },
    data: {
      status: missionProgress?.completed
        ? "AVAILABLE"
        : mission?.status === "ACTIVE" || payload.status === "IN_FLIGHT"
          ? "IN_MISSION"
          : drone.status,
      connectorStatus: "ONLINE",
      lastTelemetryAt: record.timestamp
    }
  });

  return { telemetry: apiTelemetry, alerts, missionProgress };
};

const resolveTelemetryMission = async (organisationId, droneId, missionIdentifier) => {
  if (missionIdentifier) {
    const mission = await prisma.mission.findFirst({
      where: {
        organisationId,
        OR: [{ id: missionIdentifier }, { missionCode: missionIdentifier }, { synctegralMissionId: missionIdentifier }]
      },
      include: { droneAssignments: true }
    });

    if (!mission) {
      throw new AppError("Telemetry mission not found", 404, "TELEMETRY_MISSION_NOT_FOUND");
    }

    const missionDroneIds = [
      mission.droneId,
      ...mission.droneAssignments.map((assignment) => assignment.droneId)
    ].filter(Boolean);
    if (missionDroneIds.length && !missionDroneIds.includes(droneId)) {
      throw new AppError("Telemetry mission is assigned to a different drone", 409, "TELEMETRY_MISSION_DRONE_MISMATCH");
    }

    return mission;
  }

  return prisma.mission.findFirst({
    where: {
      organisationId,
      status: "ACTIVE",
      OR: [
        { droneId },
        { droneAssignments: { some: { droneId } } }
      ]
    },
    orderBy: { updatedAt: "desc" }
  });
};

export const getLatestTelemetry = async (organisationId) => {
  await syncMissionDroneStatuses(organisationId);

  const drones = await prisma.drone.findMany({
    where: { organisationId },
    select: {
      id: true,
      droneCode: true,
      model: true,
      status: true,
      missions: {
        where: { status: "ACTIVE" },
        select: {
          id: true,
          missionCode: true,
          name: true,
          status: true,
          plannedRoute: true,
          launchSite: true,
          operatingArea: true,
          progress: true
        },
        take: 1,
        orderBy: { updatedAt: "desc" }
      },
      missionAssignments: {
        where: { mission: { status: "ACTIVE" } },
        select: {
          mission: {
            select: {
              id: true,
              missionCode: true,
              name: true,
              status: true,
              plannedRoute: true,
              launchSite: true,
              operatingArea: true,
              progress: true
            }
          }
        },
        take: 1,
        orderBy: { createdAt: "desc" }
      }
    }
  });

  const latestRecords = await prisma.telemetryLog.findMany({
    where: {
      organisationId,
      droneId: { in: drones.map((drone) => drone.id) }
    },
    orderBy: { timestamp: "desc" },
    take: Math.max(drones.length * 10, 50)
  });
  const latestRecordByDroneId = new Map();
  latestRecords.forEach((record) => {
    const currentRecord = latestRecordByDroneId.get(record.droneId);
    if (!currentRecord || isTelemetryRecordNewerForLiveView(record, currentRecord)) {
      latestRecordByDroneId.set(record.droneId, record);
    }
  });

  const latest = drones.map((drone) => {
      const record = latestRecordByDroneId.get(drone.id);
      const { missions, missionAssignments, ...droneSummary } = drone;
      return {
        drone: {
          ...droneSummary,
          activeMission: missions[0] ?? missionAssignments[0]?.mission ?? null
        },
        telemetry: record ? toApiTelemetry(record) : null
      };
    });

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
    where: { organisationId, droneId: drone.id },
    orderBy: { timestamp: "desc" },
    take: Number.isFinite(limit) ? Math.max(1, Math.min(2000, Math.trunc(limit))) : 100
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
    where: { organisationId, missionId: mission.id },
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
      organisationId,
      droneId: drone.id,
      message: `${drone.droneCode} battery below ${thresholds.minimumLandingBattery}%`,
      timestamp: record.timestamp
    });
  }

  const telemetryComplete = record.status === "MISSION_COMPLETE";
  if (!telemetryComplete && (record.signalStrength < thresholds.lowSignalWarning || ["LOST", "OFFLINE"].includes(record.linkQuality.toUpperCase()))) {
    alerts.push({
      type: "SIGNAL_LOSS",
      severity: record.signalStrength <= 5 || ["LOST", "OFFLINE"].includes(record.linkQuality.toUpperCase()) ? "CRITICAL" : "MEDIUM",
      organisationId,
      droneId: drone.id,
      message: `${drone.droneCode} signal below ${thresholds.lowSignalWarning}%`,
      timestamp: record.timestamp
    });
    if (record.signalStrength <= 5 || ["LOST", "OFFLINE"].includes(record.linkQuality.toUpperCase())) {
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
        organisationId,
        droneId: drone.id,
        geofenceId: geofence.id,
        message: `${drone.droneCode} entered ${geofence.type.toLowerCase()} geofence: ${geofence.name}`,
        timestamp: record.timestamp
      });
    }
  }

  return alerts;
};

const isTelemetryRecordNewerForLiveView = (candidate, current) => {
  const candidateSequence = getTelemetrySequence(candidate);
  const currentSequence = getTelemetrySequence(current);

  if (Number.isFinite(candidateSequence) && Number.isFinite(currentSequence)) {
    return candidateSequence > currentSequence;
  }

  return new Date(candidate.timestamp).getTime() > new Date(current.timestamp).getTime();
};

const getTelemetrySequence = (record) => Number(
  record?.rawPayload?.simulator?.sequence
  ?? record?.rawPayload?.sequence
  ?? record?.rawPayload?.simulator?.raw?.sequence_no
  ?? record?.rawPayload?.simulator?.raw?.sequence
);

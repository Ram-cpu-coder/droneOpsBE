import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { ingestTelemetry } from "./telemetry.service.js";
import { syncMissionProgressFromTelemetry } from "./missionProgress.service.js";

let syncTimer = null;
let isSyncing = false;

export const syncSynctegralTelemetryForOrganisation = async (organisationId) => {
  const latestRecord = await fetchSynctegralLatestTelemetry();
  return ingestSynctegralRecordForOrganisation(organisationId, latestRecord);
};

export const syncSynctegralTelemetryForAllOrganisations = async () => {
  if (isSyncing) return { skipped: true, reason: "Sync already running" };
  isSyncing = true;

  try {
    const latestRecord = await fetchSynctegralLatestTelemetry();
    const organisations = await findOrganisationsUsingSimulatorDrone(latestRecord.drone_id);

    const results = await Promise.allSettled(
      organisations.map((organisationId) => ingestSynctegralRecordForOrganisation(organisationId, latestRecord))
    );

    return {
      droneId: latestRecord.drone_id,
      organisations: organisations.length,
      ingested: results.filter((result) => result.status === "fulfilled" && result.value?.ingested).length,
      skipped: results.filter((result) => result.status === "fulfilled" && result.value?.skipped).length,
      failed: results.filter((result) => result.status === "rejected").length
    };
  } finally {
    isSyncing = false;
  }
};

export const startSynctegralTelemetrySync = () => {
  if (!env.synctegralTelemetryEnabled || syncTimer) return;

  const runSync = async () => {
    try {
      await syncSynctegralTelemetryForAllOrganisations();
    } catch {
      // Keep the background worker alive. Manual sync endpoint returns detailed failures.
    } finally {
      syncTimer = setTimeout(runSync, env.synctegralTelemetryPollIntervalMs);
    }
  };

  syncTimer = setTimeout(runSync, 1000);
};

export const stopSynctegralTelemetrySync = () => {
  if (!syncTimer) return;
  clearTimeout(syncTimer);
  syncTimer = null;
};

const fetchSynctegralLatestTelemetry = async () => {
  if (!env.synctegralCustomerKey || env.synctegralCustomerKey === "your_synctegral_customer_key_here") {
    throw new AppError("Add the real Synctegral customer API key in DRONEOPS_CUSTOMER_KEY", 503, "SYNCTEGRAL_KEY_MISSING");
  }

  const response = await fetch(env.synctegralLatestUrl, {
    headers: {
      "X-API-Key": env.synctegralCustomerKey
    },
    signal: AbortSignal.timeout(env.telemetryTimeoutSeconds * 1000)
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        "Synctegral rejected the customer API key. Check DRONEOPS_CUSTOMER_KEY and make sure it is the customer key from the operating procedure.",
        response.status,
        "SYNCTEGRAL_KEY_REJECTED"
      );
    }

    throw new AppError(`Synctegral telemetry request failed with ${response.status}`, response.status, "SYNCTEGRAL_TELEMETRY_FAILED");
  }

  const payload = await response.json();
  return normalizeSynctegralRecord(payload?.data ?? payload);
};

const ingestSynctegralRecordForOrganisation = async (organisationId, record) => {
  const drone = await prisma.drone.findFirst({
    where: {
      organisationId,
      OR: [
        { droneCode: record.drone_id },
        { externalDeviceId: record.drone_id },
        { serialNumber: record.drone_id }
      ]
    },
    select: { id: true, batteryType: true }
  });

  if (!drone) {
    return { skipped: true, reason: `No DroneOps drone is linked to ${record.drone_id}` };
  }

  const timestamp = new Date(record.timestamp);
  const [activeMission, previousTelemetry, existing] = await Promise.all([
    prisma.mission.findFirst({
      where: {
        organisationId,
        status: "ACTIVE",
        OR: [
          { droneId: drone.id },
          { droneAssignments: { some: { droneId: drone.id } } }
        ]
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    }),
    prisma.telemetryLog.findFirst({
      where: {
        organisationId,
        droneId: drone.id,
        timestamp: { lt: timestamp }
      },
      orderBy: { timestamp: "desc" },
      select: { latitude: true, longitude: true }
    }),
    prisma.telemetryLog.findFirst({
      where: {
        organisationId,
        droneId: drone.id,
        timestamp
      },
      select: { id: true }
    })
  ]);

  if (existing) {
    if (mapSynctegralStatus(record.flight_status) === "MISSION_COMPLETE") {
      const mission = await prisma.mission.findFirst({
        where: {
          organisationId,
          status: "ACTIVE",
          OR: [
            { droneId: drone.id },
            { droneAssignments: { some: { droneId: drone.id } } }
          ]
        },
        orderBy: { updatedAt: "desc" }
      });

      const missionProgress = await syncMissionProgressFromTelemetry(mission, {
        timestamp,
        latitude: record.latitude,
        longitude: record.longitude,
        altitude: record.altitude_m,
        status: "MISSION_COMPLETE"
      });

      if (missionProgress?.completed) {
        await prisma.drone.update({
          where: { id: drone.id },
          data: {
            connectorStatus: "ONLINE",
            lastTelemetryAt: timestamp
          }
        });

        return {
          ingested: false,
          reconciled: true,
          reason: "Telemetry timestamp already ingested; active mission marked completed",
          telemetryId: existing.id,
          missionProgress
        };
      }
    }

    return { skipped: true, reason: "Telemetry timestamp already ingested", telemetryId: existing.id };
  }

  const result = await ingestTelemetry(
    organisationId,
    toDroneOpsTelemetryPayload(record, {
      droneId: drone.id,
      missionId: activeMission?.id,
      batteryType: drone.batteryType,
      previousTelemetry
    })
  );
  return { ingested: true, ...result };
};

const findOrganisationsUsingSimulatorDrone = async (droneId) => {
  const drones = await prisma.drone.findMany({
    where: {
      OR: [
        { droneCode: droneId },
        { externalDeviceId: droneId },
        { serialNumber: droneId }
      ]
    },
    select: { organisationId: true }
  });

  return [...new Set(drones.map((drone) => drone.organisationId))];
};

const normalizeSynctegralRecord = (record) => {
  if (!record?.drone_id) {
    throw new AppError("Synctegral telemetry response does not include drone_id", 502, "SYNCTEGRAL_PAYLOAD_INVALID");
  }
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  const timestamp = new Date(record.timestamp ?? Date.now());

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Number.isNaN(timestamp.getTime())) {
    throw new AppError("Synctegral telemetry response includes invalid GPS or timestamp data", 502, "SYNCTEGRAL_PAYLOAD_INVALID");
  }

  return {
    drone_id: String(record.drone_id),
    timestamp: timestamp.toISOString(),
    latitude,
    longitude,
    altitude_m: Number(record.altitude_m ?? 0),
    speed_mps: Number(record.speed_mps ?? 0),
    battery_percent: Math.round(Number(record.battery_percent ?? 0)),
    engine_status: String(record.engine_status ?? "UNKNOWN"),
    flight_status: String(record.flight_status ?? "READY"),
    current_waypoint: record.current_waypoint,
    current_leg: record.current_leg,
    elapsed_seconds: record.elapsed_seconds,
    remaining_distance_m: record.remaining_distance_m
  };
};

const toDroneOpsTelemetryPayload = (record, context) => {
  const batteryLevel = clamp(record.battery_percent, 0, 100);
  const heading = calculateHeadingFromPreviousPoint(context.previousTelemetry, record);
  const batteryVoltage = estimateBatteryVoltage(context.batteryType, batteryLevel);
  const signalStrength = getSignalStrength(record.engine_status, record.flight_status);
  const linkQuality = getLinkQuality(record.engine_status, record.flight_status);

  return {
    drone_id: context.droneId,
    ...(context.missionId ? { mission_id: context.missionId } : {}),
    timestamp: new Date(record.timestamp).toISOString(),
    location: {
      latitude: record.latitude,
      longitude: record.longitude,
      altitude: record.altitude_m
    },
    velocity: {
      speed: record.speed_mps,
      heading
    },
    battery: {
      level: batteryLevel,
      voltage: batteryVoltage ?? null
    },
    signal: {
      strength: signalStrength,
      link_quality: linkQuality
    },
    status: mapSynctegralStatus(record.flight_status),
    source: "SYNCTEGRAL_SIMULATOR",
    simulator: {
      droneId: record.drone_id,
      waypoint: record.current_waypoint,
      leg: record.current_leg,
      elapsedSeconds: record.elapsed_seconds,
      remainingDistanceMeters: record.remaining_distance_m,
      engineStatus: record.engine_status,
      flightStatus: record.flight_status
    },
    fieldSources: {
      drone_id: "Mapped from Synctegral drone_id to DroneOps drone ID",
      mission_id: context.missionId ? "Resolved from active DroneOps mission assigned to the drone" : "No active mission assigned",
      heading: context.previousTelemetry ? "Calculated from previous telemetry coordinate" : "Defaulted because no previous telemetry point exists",
      battery_voltage: batteryVoltage === undefined ? "Unavailable because battery cell count is unknown" : "Estimated from battery type and battery percentage",
      signal_strength: "Estimated from Synctegral engine_status and flight_status",
      link_quality: "Estimated from Synctegral engine_status and flight_status"
    }
  };
};

const calculateHeadingFromPreviousPoint = (previousTelemetry, record) => {
  if (!previousTelemetry) return 0;
  if (previousTelemetry.latitude === record.latitude && previousTelemetry.longitude === record.longitude) return 0;

  const startLatitude = degreesToRadians(previousTelemetry.latitude);
  const endLatitude = degreesToRadians(record.latitude);
  const longitudeDelta = degreesToRadians(record.longitude - previousTelemetry.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(endLatitude);
  const x = Math.cos(startLatitude) * Math.sin(endLatitude)
    - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitudeDelta);

  return Math.round((radiansToDegrees(Math.atan2(y, x)) + 360) % 360);
};

const estimateBatteryVoltage = (batteryType = "", batteryLevel) => {
  const cellMatch = batteryType.match(/(\d+)\s*s/i);
  if (!cellMatch) return undefined;

  const cells = Number(cellMatch[1]);
  if (!Number.isFinite(cells) || cells <= 0) return undefined;

  const cellVoltage = 3.3 + (batteryLevel / 100) * 0.9;
  return Number((cells * cellVoltage).toFixed(2));
};

const mapSynctegralStatus = (status = "") => {
  const normalizedStatus = status.toUpperCase();
  if (normalizedStatus === "FLYING") return "IN_FLIGHT";
  if (normalizedStatus === "MISSION_COMPLETE") return "MISSION_COMPLETE";
  return normalizedStatus || "READY";
};

const getSignalStrength = (engineStatus = "", flightStatus = "") => {
  if (flightStatus.toUpperCase() === "MISSION_COMPLETE" || engineStatus.toUpperCase() === "STOPPED") return 0;
  if (engineStatus.toUpperCase() === "NORMAL" && flightStatus.toUpperCase() !== "MISSION_COMPLETE") return 95;
  return 55;
};

const getLinkQuality = (engineStatus = "", flightStatus = "") => {
  if (flightStatus.toUpperCase() === "MISSION_COMPLETE" || engineStatus.toUpperCase() === "STOPPED") return "OFFLINE";
  if (engineStatus.toUpperCase() === "NORMAL") return "GOOD";
  return "DEGRADED";
};

const degreesToRadians = (degrees) => degrees * (Math.PI / 180);

const radiansToDegrees = (radians) => radians * (180 / Math.PI);

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

import WebSocket from "ws";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { ingestTelemetry } from "./telemetry.service.js";
import { syncMissionProgressFromTelemetry } from "./missionProgress.service.js";

let syncTimer = null;
let isSyncing = false;
let streamSocket = null;
let streamReconnectTimer = null;

export const syncSynctegralTelemetryForOrganisation = async (organisationId) => {
  const latestRecord = await fetchSynctegralLatestTelemetry();
  return ingestSynctegralRecordForOrganisation(organisationId, latestRecord);
};

export const syncSynctegralTelemetryForAllOrganisations = async () => {
  if (isSyncing) return { skipped: true, reason: "Sync already running" };
  isSyncing = true;

  try {
    const latestRecord = await fetchSynctegralLatestTelemetry();
    return ingestSynctegralRecordForAllOrganisations(latestRecord);
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
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  stopSynctegralTelemetryStream();
};

export const startSynctegralTelemetryStream = () => {
  if (!env.synctegralStreamEnabled || streamSocket) return;
  if (!env.synctegralCustomerKey || env.synctegralCustomerKey === "your_synctegral_customer_key_here") return;

  streamSocket = new WebSocket(env.synctegralStreamUrl, {
    headers: { "X-API-Key": env.synctegralCustomerKey }
  });

  streamSocket.on("message", async (message) => {
    try {
      const payload = JSON.parse(message.toString());
      const record = normalizeSynctegralRecord(payload?.data ?? payload);
      await ingestSynctegralRecordForAllOrganisations(record);
    } catch {
      // Ignore malformed stream records so one bad frame does not kill live telemetry.
    }
  });

  streamSocket.on("close", scheduleStreamReconnect);
  streamSocket.on("error", scheduleStreamReconnect);
};

const stopSynctegralTelemetryStream = () => {
  if (streamReconnectTimer) {
    clearTimeout(streamReconnectTimer);
    streamReconnectTimer = null;
  }
  if (streamSocket) {
    streamSocket.removeAllListeners();
    streamSocket.close();
    streamSocket = null;
  }
};

const scheduleStreamReconnect = () => {
  if (streamSocket) {
    streamSocket.removeAllListeners();
    streamSocket = null;
  }
  if (!env.synctegralStreamEnabled || streamReconnectTimer) return;

  streamReconnectTimer = setTimeout(() => {
    streamReconnectTimer = null;
    startSynctegralTelemetryStream();
  }, 5000);
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

const ingestSynctegralRecordForAllOrganisations = async (record) => {
  const organisations = await findOrganisationsUsingSimulatorDrone(record.drone_id);
  const results = await Promise.allSettled(
    organisations.map((organisationId) => ingestSynctegralRecordForOrganisation(organisationId, record))
  );

  return {
    droneId: record.drone_id,
    missionId: record.mission_id,
    sequence: record.sequence,
    organisations: organisations.length,
    ingested: results.filter((result) => result.status === "fulfilled" && result.value?.ingested).length,
    skipped: results.filter((result) => result.status === "fulfilled" && result.value?.skipped).length,
    failed: results.filter((result) => result.status === "rejected").length
  };
};

const ingestSynctegralRecordForOrganisation = async (organisationId, record) => {
  const drone = await prisma.drone.findFirst({
    where: {
      organisationId,
      telemetryProvider: { not: "NONE" },
      externalDeviceId: record.drone_id
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, batteryType: true }
  }) ?? await prisma.drone.findFirst({
    where: {
      organisationId,
      telemetryProvider: { not: "NONE" },
      OR: [
        { droneCode: record.drone_id },
        { serialNumber: record.drone_id }
      ]
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, batteryType: true }
  });

  if (!drone) {
    return { skipped: true, reason: `No DroneOps drone is linked to ${record.drone_id}` };
  }

  const timestamp = new Date(record.timestamp);
  const [mission, previousTelemetry, existing] = await Promise.all([
    resolveSynctegralMission(organisationId, drone.id, record),
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
      select: { id: true, missionId: true }
    })
  ]);

  if (record.mission_id && !mission) {
    return {
      skipped: true,
      reason: `No DroneOps mission is linked to Synctegral mission ${record.mission_id}`
    };
  }

  if (existing) {
    const missionProgress = await reconcileExistingTelemetry(organisationId, drone.id, existing, mission, record, timestamp);
    return {
      skipped: true,
      reason: "Telemetry timestamp already ingested",
      telemetryId: existing.id,
      missionProgress
    };
  }

  const latestTelemetry = await prisma.telemetryLog.findFirst({
    where: {
      organisationId,
      droneId: drone.id,
      ...(mission?.id ? { missionId: mission.id } : {})
    },
    orderBy: { timestamp: "desc" },
    select: {
      timestamp: true,
      rawPayload: true
    }
  });

  const result = await ingestTelemetry(
    organisationId,
    toDroneOpsTelemetryPayload(record, {
      droneId: drone.id,
      missionId: mission?.id,
      batteryType: drone.batteryType,
      previousTelemetry,
      suppressLivePublish: shouldSuppressLivePublish(record, latestTelemetry)
    })
  );
  return { ingested: true, ...result };
};

const reconcileExistingTelemetry = async (organisationId, droneId, telemetry, mission, record, timestamp) => {
  if (!mission) return null;

  const telemetryLinked = await linkTelemetryToMission(telemetry, mission.id);
  if (mapSynctegralStatus(record.flight_status) !== "MISSION_COMPLETE") {
    return {
      telemetryId: telemetry.id,
      telemetryLinked
    };
  }

  const missionProgress = await syncMissionProgressFromTelemetry(mission, {
    timestamp,
    latitude: record.latitude,
    longitude: record.longitude,
    altitude: record.altitude_m,
    status: "MISSION_COMPLETE"
  });

  if (missionProgress?.completed) {
    await prisma.drone.update({
      where: { id: droneId },
      data: {
        connectorStatus: "ONLINE",
        lastTelemetryAt: timestamp
      }
    });
  }

  return { telemetryId: telemetry.id, telemetryLinked, ...missionProgress };
};

const linkTelemetryToMission = async (telemetry, missionId) => {
  if (telemetry.missionId === missionId) return false;

  await prisma.telemetryLog.update({
    where: { id: telemetry.id },
    data: { missionId }
  });

  return true;
};

const resolveSynctegralMission = async (organisationId, droneId, record) => {
  const synctegralMissionId = record?.mission_id;
  if (synctegralMissionId) {
    const mission = await prisma.mission.findFirst({
      where: {
        organisationId,
        synctegralMissionId,
        OR: [
          { droneId },
          { droneAssignments: { some: { droneId } } }
        ]
      },
      include: { droneAssignments: true },
      orderBy: { updatedAt: "desc" }
    });

    if (mission) return syncMissionLifecycleFromSynctegral(mission, record);
    if (mapSynctegralStatus(record.flight_status) === "MISSION_COMPLETE") return null;

    const activeMission = await findActiveDroneMission(organisationId, droneId);
    if (!activeMission) return null;

    if (activeMission.synctegralMissionId && activeMission.synctegralMissionId !== synctegralMissionId) {
      return null;
    }

    if (!activeMission.synctegralMissionId) {
      return prisma.mission.update({
        where: { id: activeMission.id },
        data: {
          synctegralMissionId,
          synctegralSyncStatus: "LINKED_FROM_TELEMETRY",
          synctegralSyncError: null,
          synctegralSyncedAt: new Date()
        },
        include: { droneAssignments: true }
      });
    }

    return syncMissionLifecycleFromSynctegral(activeMission, record);
  }

  const activeMission = await findActiveDroneMission(organisationId, droneId);
  return syncMissionLifecycleFromSynctegral(activeMission, record);
};

const findActiveDroneMission = (organisationId, droneId) => (
  prisma.mission.findFirst({
    where: {
      organisationId,
      status: "ACTIVE",
      OR: [
        { droneId },
        { droneAssignments: { some: { droneId } } }
      ]
    },
    include: { droneAssignments: true },
    orderBy: { updatedAt: "desc" }
  })
);

const syncMissionLifecycleFromSynctegral = async (mission, record) => {
  if (!mission) return null;

  const telemetryStatus = mapSynctegralStatus(record.flight_status);
  const isLiveTelemetry = ["READY", "IN_FLIGHT"].includes(telemetryStatus);

  if (mission.status !== "COMPLETED" || !isLiveTelemetry) {
    return mission;
  }

  return prisma.mission.update({
    where: { id: mission.id },
    data: {
      status: "ACTIVE",
      progress: Math.min(Number(mission.progress ?? 0), 99)
    },
    include: { droneAssignments: true }
  });
};

const findOrganisationsUsingSimulatorDrone = async (droneId) => {
  const drones = await prisma.drone.findMany({
    where: {
      telemetryProvider: { not: "NONE" },
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

  const latitude = Number(record.position?.latitude ?? record.latitude);
  const longitude = Number(record.position?.longitude ?? record.longitude);
  const timestamp = new Date(
    record.timing?.aircraft_timestamp_utc
    ?? record.timing?.publisher_sent_at_utc
    ?? record.timing?.server_received_at_utc
    ?? record.timestamp
    ?? Date.now()
  );

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Number.isNaN(timestamp.getTime())) {
    throw new AppError("Synctegral telemetry response includes invalid GPS or timestamp data", 502, "SYNCTEGRAL_PAYLOAD_INVALID");
  }

  return {
    drone_id: String(record.drone_id),
    mission_id: record.mission_id ? String(record.mission_id) : null,
    sequence: record.sequence ?? null,
    timestamp: timestamp.toISOString(),
    latitude,
    longitude,
    altitude_m: numberOrZero(record.position?.altitude_agl_m ?? record.position?.altitude_amsl_m ?? record.altitude_m),
    speed_mps: numberOrZero(record.motion?.ground_speed_mps ?? record.speed_mps),
    heading_deg: numberOrNull(record.motion?.heading_deg ?? record.attitude?.yaw_deg ?? record.heading_deg),
    battery_percent: clamp(record.power?.remaining_percent ?? record.battery_percent, 0, 100),
    battery_voltage: numberOrNull(record.power?.voltage_v),
    signal_percent: numberOrNull(record.link?.command_quality_percent ?? record.link?.video_quality_percent),
    link_quality: record.navigation?.gps_health ?? record.link_quality,
    engine_status: String(record.aircraft?.engine_status ?? record.engine_status ?? "UNKNOWN"),
    flight_mode: String(record.aircraft?.flight_mode ?? record.flight_mode ?? "UNKNOWN"),
    flight_status: String(record.aircraft?.flight_status ?? record.flight_status ?? "READY"),
    current_waypoint: record.mission_context?.waypoint ?? record.current_waypoint,
    current_leg: record.mission_context?.leg ?? record.current_leg,
    elapsed_seconds: record.timing?.simulation_elapsed_s ?? record.elapsed_seconds,
    remaining_distance_m: record.remaining_distance_m,
    raw: record
  };
};

const toDroneOpsTelemetryPayload = (record, context) => {
  const batteryLevel = clamp(record.battery_percent, 0, 100);
  const heading = Number.isFinite(record.heading_deg)
    ? Math.round(record.heading_deg)
    : calculateHeadingFromPreviousPoint(context.previousTelemetry, record);
  const batteryVoltage = Number.isFinite(record.battery_voltage)
    ? record.battery_voltage
    : estimateBatteryVoltage(context.batteryType, batteryLevel);
  const signalStrength = Number.isFinite(record.signal_percent)
    ? clamp(record.signal_percent, 0, 100)
    : getSignalStrength(record.engine_status, record.flight_status);
  const linkQuality = getLinkQuality(record);

  return {
    drone_id: context.droneId,
    ...(context.missionId ? { mission_id: context.missionId } : {}),
    suppressLivePublish: context.suppressLivePublish,
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
      missionId: record.mission_id,
      sequence: record.sequence,
      waypoint: record.current_waypoint,
      leg: record.current_leg,
      elapsedSeconds: record.elapsed_seconds,
      remainingDistanceMeters: record.remaining_distance_m,
      engineStatus: record.engine_status,
      flightMode: record.flight_mode,
      flightStatus: record.flight_status,
      raw: record.raw
    },
    fieldSources: {
      drone_id: "Mapped from Synctegral drone_id to DroneOps externalDeviceId/drone ID",
      mission_id: context.missionId ? "Resolved from Synctegral mission_id or active DroneOps mission" : "No correlated mission found",
      heading: Number.isFinite(record.heading_deg) ? "Mapped from Synctegral motion.heading_deg" : "Calculated from previous telemetry coordinate",
      battery_voltage: batteryVoltage === undefined ? "Unavailable because Synctegral did not provide voltage and battery cell count is unknown" : "Mapped or estimated from telemetry",
      signal_strength: Number.isFinite(record.signal_percent) ? "Mapped from Synctegral link quality" : "Estimated from Synctegral aircraft status",
      link_quality: "Mapped from Synctegral navigation/link health where available"
    }
  };
};

const shouldSuppressLivePublish = (record, latestTelemetry) => {
  if (!latestTelemetry) return false;

  const recordSequence = Number(record.sequence);
  const latestSequence = Number(
    latestTelemetry.rawPayload?.simulator?.sequence
    ?? latestTelemetry.rawPayload?.sequence
    ?? latestTelemetry.rawPayload?.simulator?.raw?.sequence_no
    ?? latestTelemetry.rawPayload?.simulator?.raw?.sequence
  );

  if (Number.isFinite(recordSequence) && Number.isFinite(latestSequence) && recordSequence < latestSequence) {
    return true;
  }

  const recordTimestamp = new Date(record.timestamp).getTime();
  const latestTimestamp = new Date(latestTelemetry.timestamp).getTime();
  return Number.isFinite(recordTimestamp) && Number.isFinite(latestTimestamp) && recordTimestamp < latestTimestamp;
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
  if (normalizedStatus === "COMPLETED") return "AIRCRAFT_COMPLETED";
  return normalizedStatus || "READY";
};

const getSignalStrength = (engineStatus = "", flightStatus = "") => {
  if (["MISSION_COMPLETE", "COMPLETED"].includes(flightStatus.toUpperCase()) || engineStatus.toUpperCase() === "STOPPED") return 0;
  if (["NORMAL", "RUNNING"].includes(engineStatus.toUpperCase())) return 95;
  return 55;
};

const getLinkQuality = (record) => {
  if (record.link_quality) return String(record.link_quality).toUpperCase();
  if (["MISSION_COMPLETE", "COMPLETED"].includes(record.flight_status.toUpperCase()) || record.engine_status.toUpperCase() === "STOPPED") return "OFFLINE";
  if (["NORMAL", "RUNNING"].includes(record.engine_status.toUpperCase())) return "GOOD";
  return "DEGRADED";
};

const numberOrZero = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const numberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const degreesToRadians = (degrees) => degrees * (Math.PI / 180);

const radiansToDegrees = (radians) => radians * (180 / Math.PI);

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

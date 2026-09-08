import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

const SYNCED = "SYNCED";
const FAILED = "FAILED";
const SKIPPED = "SKIPPED";
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SYNC_RETRY_ATTEMPTS = 3;
const TERMINAL_MISSION_STATUSES = new Set(["COMPLETED", "ABORTED", "CANCELLED"]);

export const syncMissionToSynctegral = async (organisationId, missionId) => {
  if (!env.synctegralMissionApiEnabled) {
    return markMissionSync(organisationId, missionId, {
      status: SKIPPED,
      error: "Synctegral Mission API sync is disabled"
    });
  }

  if (!env.synctegralCustomerKey || env.synctegralCustomerKey === "your_synctegral_customer_key_here") {
    return markMissionSync(organisationId, missionId, {
      status: FAILED,
      error: "DRONEOPS_CUSTOMER_KEY is missing"
    });
  }

  const mission = await prisma.mission.findFirst({
    where: { id: missionId, organisationId },
    include: {
      organisation: { select: { id: true, name: true, industry: true } },
      createdBy: { select: { id: true, name: true, email: true, role: true } },
      droneAssignments: {
        include: {
          drone: {
            select: {
              id: true,
              droneCode: true,
              manufacturer: true,
              model: true,
              serialNumber: true,
              batteryType: true,
              telemetryProvider: true,
              externalDeviceId: true
            }
          }
        },
        orderBy: { createdAt: "asc" }
      },
      pilotAssignments: {
        include: {
          pilot: { select: { id: true, name: true, email: true, role: true } }
        },
        orderBy: { createdAt: "asc" }
      },
      riskAssessment: true
    }
  });

  if (!mission) {
    return { skipped: true, reason: "Mission not found" };
  }

  if (mission.synctegralMissionId) {
    return patchSynctegralMission(organisationId, missionId, mission.synctegralMissionId, buildSynctegralMissionPayload(mission));
  }

  const body = buildSynctegralMissionPayload(mission);

  try {
    const response = await requestSynctegralMissionApi(env.synctegralMissionApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.synctegralCustomerKey,
        "Idempotency-Key": `droneops-mission-${mission.id}-create`
      },
      body: JSON.stringify(body)
    });

    const responsePayload = response.payload;
    if (response.status === 409) {
      const existingId = extractConflictMissionId(responsePayload);
      if (existingId) {
        const existing = await requestSynctegralMissionApi(`${env.synctegralMissionApiUrl}/${encodeURIComponent(existingId)}`, {
          method: "GET",
          headers: { "X-API-Key": env.synctegralCustomerKey }
        });
        const remoteMission = extractRemoteMission(existing.payload);
        // Recover only a reference verified through the authenticated Mission API.
        if (existing.ok && remoteMission?.external_reference === body.external_reference) {
          await prisma.mission.update({
            where: { id: mission.id, organisationId },
            data: { synctegralMissionId: existingId }
          });
          return patchSynctegralMission(organisationId, missionId, existingId, body);
        }
      }
    }
    if (!response.ok) {
      const message = getMissionApiError(response);
      return markMissionSync(organisationId, missionId, {
        status: FAILED,
        error: message
      });
    }

    const synctegralMissionId = extractSynctegralMissionId(responsePayload);
    if (!synctegralMissionId) {
      return markMissionSync(organisationId, missionId, {
        status: FAILED,
        error: "Synctegral Mission API response did not include mission_id"
      });
    }

    const routeVerification = verifyRouteEcho(responsePayload, body.route.waypoints);
    if (routeVerification.status === "MISMATCH") {
      return markMissionSync(organisationId, missionId, {
        status: FAILED,
        synctegralMissionId,
        error: routeVerification.message
      });
    }

    const updatedMission = await markMissionSync(organisationId, missionId, {
      status: SYNCED,
      synctegralMissionId
    });

    return {
      synced: true,
      status: SYNCED,
      synctegralMissionId,
      mission: updatedMission,
      routeVerification,
      response: responsePayload
    };
  } catch (error) {
    return markMissionSync(organisationId, missionId, {
      status: FAILED,
      error: error.message
    });
  }
};

export const syncMissionPlanningToSynctegral = async (organisationId, missionId) => {
  const mission = await getMissionForSync(organisationId, missionId);
  if (!mission) return { skipped: true, reason: "Mission not found" };

  if (TERMINAL_MISSION_STATUSES.has(mission.status)) {
    if (mission.synctegralMissionId) return getSynctegralMission(organisationId, missionId);

    return markMissionSync(organisationId, missionId, {
      status: FAILED,
      error: "This mission is completed and cannot be created or route-synced in Synctegral."
    });
  }

  if (!mission.synctegralMissionId) {
    return syncMissionToSynctegral(organisationId, missionId);
  }

  return patchSynctegralMission(
    organisationId,
    missionId,
    mission.synctegralMissionId,
    buildSynctegralMissionPayload(mission)
  );
};

export const updateSynctegralMissionStatus = async (organisationId, missionId, status) => {
  const mission = await getMissionForSync(organisationId, missionId);
  if (!mission) return { skipped: true, reason: "Mission not found" };

  if (!mission.synctegralMissionId) {
    const createResult = await syncMissionToSynctegral(organisationId, missionId);
    if (!createResult?.synced || !createResult.synctegralMissionId) return createResult;

    return patchSynctegralMission(organisationId, missionId, createResult.synctegralMissionId, {
      status: mapDroneOpsStatusToSynctegral(status)
    });
  }

  const createResult = { synctegralMissionId: mission.synctegralMissionId };
  const synctegralMissionId = createResult?.synctegralMissionId;

  if (!synctegralMissionId) {
    return markMissionSync(organisationId, missionId, {
      status: FAILED,
      error: createResult?.error ?? "Cannot update Synctegral status before mission_id is available"
    });
  }

  return patchSynctegralMission(organisationId, missionId, synctegralMissionId, {
    status: mapDroneOpsStatusToSynctegral(status)
  });
};

export const getSynctegralMission = async (organisationId, missionId) => {
  const mission = await getMissionForSync(organisationId, missionId);
  if (!mission?.synctegralMissionId) {
    return { skipped: true, reason: "Mission has no Synctegral mission_id" };
  }

  try {
    const response = await requestSynctegralMissionApi(`${env.synctegralMissionApiUrl}/${encodeURIComponent(mission.synctegralMissionId)}`, {
      method: "GET",
      headers: { "X-API-Key": env.synctegralCustomerKey }
    });

    if (!response.ok) {
      return markMissionSync(organisationId, missionId, {
        status: FAILED,
          error: getMissionApiError(response)
      });
    }

    const updatedMission = await markMissionSync(organisationId, missionId, {
      status: SYNCED,
      synctegralMissionId: mission.synctegralMissionId
    });

    return {
      synced: true,
      status: SYNCED,
      synctegralMissionId: mission.synctegralMissionId,
      response: response.payload,
      mission: updatedMission
    };
  } catch (error) {
    return markMissionSync(organisationId, missionId, {
      status: FAILED,
      error: error.message
    });
  }
};

const getMissionForSync = (organisationId, missionId) => (
  prisma.mission.findFirst({
    where: { id: missionId, organisationId },
    include: {
      organisation: { select: { id: true, name: true, industry: true } },
      createdBy: { select: { id: true, name: true, email: true, role: true } },
      droneAssignments: {
        include: {
          drone: {
            select: {
              id: true,
              droneCode: true,
              manufacturer: true,
              model: true,
              serialNumber: true,
              batteryType: true,
              telemetryProvider: true,
              externalDeviceId: true
            }
          }
        },
        orderBy: { createdAt: "asc" }
      },
      pilotAssignments: {
        include: {
          pilot: { select: { id: true, name: true, email: true, role: true } }
        },
        orderBy: { createdAt: "asc" }
      },
      riskAssessment: true
    }
  })
);

const patchSynctegralMission = async (organisationId, missionId, synctegralMissionId, body, options = {}) => {
  // References identify the original creation and must remain unchanged on updates.
  const patchBody = { ...body };
  delete patchBody.external_reference;
  if (!env.synctegralMissionApiEnabled) {
    return markMissionSync(organisationId, missionId, {
      status: SKIPPED,
      synctegralMissionId,
      error: "Synctegral Mission API sync is disabled"
    });
  }

  if (!env.synctegralCustomerKey || env.synctegralCustomerKey === "your_synctegral_customer_key_here") {
    return markMissionSync(organisationId, missionId, {
      status: FAILED,
      synctegralMissionId,
      error: "DRONEOPS_CUSTOMER_KEY is missing"
    });
  }

  try {
    const response = await requestSynctegralMissionApi(`${env.synctegralMissionApiUrl}/${encodeURIComponent(synctegralMissionId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.synctegralCustomerKey,
        "X-Request-ID": `droneops-mission-${missionId}-patch`,
        "Idempotency-Key": `droneops-mission-${missionId}-patch-${synctegralMissionId}`
      },
      body: JSON.stringify(patchBody)
    });

    if (!response.ok) {
      if (response.status === 404 && options.allowMissingRecovery !== false) {
        return recoverMissingSynctegralMission(organisationId, missionId, synctegralMissionId, patchBody);
      }

      return markMissionSync(organisationId, missionId, {
        status: FAILED,
        synctegralMissionId,
        error: getMissionApiError(response)
      });
    }

    const responseMissionId = extractSynctegralMissionId(response.payload) ?? synctegralMissionId;
    const routeVerification = verifyRouteEcho(response.payload, patchBody.route?.waypoints);
    if (routeVerification.status === "MISMATCH") {
      return markMissionSync(organisationId, missionId, {
        status: FAILED,
        synctegralMissionId: responseMissionId,
        error: routeVerification.message
      });
    }

    const updatedMission = await markMissionSync(organisationId, missionId, {
      status: SYNCED,
      synctegralMissionId: responseMissionId
    });

    return {
      synced: true,
      status: SYNCED,
      synctegralMissionId: responseMissionId,
      mission: updatedMission,
      routeVerification,
      response: response.payload
    };
  } catch (error) {
    return markMissionSync(organisationId, missionId, {
      status: FAILED,
      synctegralMissionId,
      error: error.message
    });
  }
};

const buildSynctegralMissionPayload = (mission) => {
  const primaryDrone = mission.droneAssignments[0]?.drone;
  const primaryPilot = mission.pilotAssignments[0]?.pilot ?? mission.createdBy;
  const plannedRoute = normaliseJson(mission.plannedRoute);
  const waypoints = extractRouteWaypoints(plannedRoute);
  const description = [
    mission.launchSite ? `Launch site: ${mission.launchSite}` : null,
    mission.operatingArea ? `Operating area: ${mission.operatingArea}` : null
  ].filter(Boolean).join(" | ");

  return cleanPayload({
    external_reference: mission.missionCode ?? mission.id,
    mission_name: mission.name,
    description: description || "DroneOps mission",
    planned_start_utc: mission.plannedStartAt?.toISOString() ?? null,
    operation_type: mission.type ?? "VLOS",
    aircraft: {
      external_device_id: primaryDrone?.externalDeviceId || env.synctegralDroneId
    },
    pilot: {
      name: primaryPilot?.name ?? "DroneOps Pilot"
    },
    route: {
      waypoints
    },
    approval_requirements: buildApprovalRequirements(mission),
    status: mapDroneOpsStatusToSynctegral(mission.status)
  });
};

const buildApprovalRequirements = (mission) => {
  const geofenceConfig = normaliseJson(mission.geofenceConfig);
  const authorities = Array.isArray(geofenceConfig?.approvalRequirements)
    ? geofenceConfig.approvalRequirements
    : Array.isArray(geofenceConfig?.authorities)
      ? geofenceConfig.authorities
      : [];

  return authorities.map((authority, index) => ({
    authority_type: authority.authorityType ?? authority.authority_type ?? "COUNCIL",
    authority_name: authority.authorityName ?? authority.authority_name ?? authority.name ?? `Authority ${index + 1}`,
    approval_required: authority.approvalRequired ?? authority.approval_required ?? true,
    approval_status: authority.approvalStatus ?? authority.approval_status ?? "PENDING",
    reference: authority.reference ?? authority.id ?? `${mission.missionCode ?? mission.id}-AUTH-${index + 1}`
  }));
};

const extractRouteWaypoints = (plannedRoute) => {
  const candidateWaypoints = Array.isArray(plannedRoute)
    ? plannedRoute
    : plannedRoute?.waypoints ?? plannedRoute?.points ?? plannedRoute?.route ?? [];

  if (!Array.isArray(candidateWaypoints)) return [];

  return candidateWaypoints
    .map((point, index) => {
      const latitude = Number(point.latitude ?? point.lat ?? point.location?.latitude);
      const longitude = Number(point.longitude ?? point.lng ?? point.lon ?? point.location?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      return {
        sequence: Number(point.sequence ?? point.order ?? index + 1),
        latitude,
        longitude,
        planned_agl_m: Number(point.planned_agl_m ?? point.altitude ?? point.altitudeM ?? point.location?.altitude ?? 60)
      };
    })
    .filter(Boolean);
};

const mapDroneOpsStatusToSynctegral = (status = "") => {
  const normalizedStatus = String(status).toUpperCase();
  if (normalizedStatus === "ACTIVE") return "IN_PROGRESS";
  if (normalizedStatus === "COMPLETED") return "COMPLETED";
  if (["ABORTED", "CANCELLED"].includes(normalizedStatus)) return "CANCELLED";
  return "DRAFT";
};

const requestSynctegralMissionApi = async (url, options) => {
  let lastError;

  for (let attempt = 0; attempt < SYNC_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(env.telemetryTimeoutSeconds * 1000)
      });
      const result = {
        ok: response.ok,
        status: response.status,
        payload: await readJsonResponse(response)
      };

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === SYNC_RETRY_ATTEMPTS - 1) return result;
    } catch (error) {
      lastError = error;
      if (attempt === SYNC_RETRY_ATTEMPTS - 1) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
  }

  throw lastError ?? new Error("Synctegral Mission API request failed");
};

const cleanPayload = (value) => {
  if (Array.isArray(value)) {
    return value.map(cleanPayload).filter((item) => item !== null && item !== undefined);
  }

  if (!value || typeof value !== "object") return value;

  return Object.entries(value).reduce((payload, [key, entry]) => {
    const nextValue = cleanPayload(entry);
    if (nextValue === null || nextValue === undefined) return payload;
    if (Array.isArray(nextValue) && !nextValue.length && key !== "waypoints") return payload;
    payload[key] = nextValue;
    return payload;
  }, {});
};

const markMissionSync = async (organisationId, missionId, { status, synctegralMissionId, error }) => {
  const currentMission = await prisma.mission.findFirst({
    where: { id: missionId, organisationId },
    select: { id: true }
  });

  if (!currentMission) {
    return { skipped: true, reason: "Mission not found" };
  }

  const updatedMission = await prisma.mission.update({
    where: { id: currentMission.id },
    data: {
      ...(synctegralMissionId ? { synctegralMissionId } : {}),
      synctegralSyncStatus: status,
      synctegralSyncError: error ? String(error).slice(0, 500) : null,
      ...(status === SYNCED ? { synctegralSyncedAt: new Date() } : {})
    }
  });

  return {
    synced: status === SYNCED,
    skipped: status === SKIPPED,
    failed: status === FAILED,
    status,
    synctegralMissionId: updatedMission.synctegralMissionId,
    error,
    mission: updatedMission
  };
};

const extractSynctegralMissionId = (payload) => (
  payload?.synctegral_mission_id
  ?? payload?.data?.synctegral_mission_id
  ?? payload?.mission?.synctegral_mission_id
  ?? payload?.data?.mission?.synctegral_mission_id
  ?? payload?.id
  ?? payload?.mission_id
  ?? payload?.data?.id
  ?? payload?.data?.mission_id
  ?? payload?.mission?.id
  ?? payload?.mission?.mission_id
  ?? payload?.data?.mission?.id
  ?? payload?.data?.mission?.mission_id
  ?? null
);

const extractConflictMissionId = (payload) => {
  const explicitId = extractSynctegralMissionId(payload);
  if (explicitId) return explicitId;

  const detail = payload?.detail ?? payload?.message ?? payload?.error;
  if (typeof detail !== "string") return null;

  return detail.match(/external_reference already exists:\s*(\S+)/i)?.[1]
    ?? detail.match(/mission(?:_id| id)?\s*[:=]\s*(\S+)/i)?.[1]
    ?? null;
};

const verifyRouteEcho = (payload, expectedWaypoints) => {
  if (!Array.isArray(expectedWaypoints)) {
    return {
      status: "NOT_CHECKED",
      reason: "Route was not included in this Synctegral request."
    };
  }

  const remoteWaypoints = extractRemoteWaypoints(payload);
  if (!remoteWaypoints) {
    return {
      status: "ACCEPTED_NO_ROUTE_ECHO",
      expectedWaypoints: expectedWaypoints.length
    };
  }

  const expected = normalizeComparableWaypoints(expectedWaypoints);
  const actual = normalizeComparableWaypoints(remoteWaypoints);
  const matches = expected.length === actual.length
    && expected.every((point, index) => (
      point.sequence === actual[index].sequence
      && Math.abs(point.latitude - actual[index].latitude) < 0.000001
      && Math.abs(point.longitude - actual[index].longitude) < 0.000001
      && Math.abs(point.planned_agl_m - actual[index].planned_agl_m) < 0.01
    ));

  return matches
    ? { status: "VERIFIED", expectedWaypoints: expected.length, remoteWaypoints: actual.length }
    : {
      status: "MISMATCH",
      expectedWaypoints: expected.length,
      remoteWaypoints: actual.length,
      message: `Synctegral accepted the mission but returned a different route (${expected.length} planned waypoints vs ${actual.length} remote waypoints).`
    };
};

const extractRemoteWaypoints = (payload) => (
  payload?.route?.waypoints
  ?? payload?.mission?.route?.waypoints
  ?? payload?.data?.route?.waypoints
  ?? payload?.data?.mission?.route?.waypoints
  ?? payload?.waypoints
  ?? payload?.mission?.waypoints
  ?? payload?.data?.waypoints
  ?? payload?.data?.mission?.waypoints
  ?? null
);

const normalizeComparableWaypoints = (waypoints) => (
  (Array.isArray(waypoints) ? waypoints : [])
    .map((point, index) => ({
      sequence: Number(point.sequence ?? point.order ?? index + 1),
      latitude: Number(point.latitude ?? point.lat ?? point.location?.latitude),
      longitude: Number(point.longitude ?? point.lng ?? point.lon ?? point.location?.longitude),
      planned_agl_m: Number(point.planned_agl_m ?? point.altitude ?? point.altitudeM ?? point.location?.altitude ?? 60)
    }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
);

const extractRemoteMission = (payload) => (
  payload?.mission
  ?? payload?.data?.mission
  ?? payload?.data
  ?? payload
);

const readJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const getMissionApiError = (response) => {
  const detail = response.payload?.message ?? response.payload?.detail;
  return typeof detail === "string" ? detail : `Synctegral Mission API request failed with ${response.status}`;
};

const recoverMissingSynctegralMission = async (organisationId, missionId, staleSynctegralMissionId, patchBody = null) => {
  await prisma.mission.updateMany({
    where: { id: missionId, organisationId, synctegralMissionId: staleSynctegralMissionId },
    data: {
      synctegralMissionId: null,
      synctegralSyncStatus: FAILED,
      synctegralSyncError: `Synctegral mission ${staleSynctegralMissionId} was not found; DroneOps will recreate the remote mission.`
    }
  });

  const createResult = await syncMissionToSynctegral(organisationId, missionId);
  if (!createResult?.synced || !createResult.synctegralMissionId || !patchBody || !Object.keys(patchBody).length) {
    return createResult;
  }

  return patchSynctegralMission(organisationId, missionId, createResult.synctegralMissionId, patchBody, {
    allowMissingRecovery: false
  });
};

const normaliseJson = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

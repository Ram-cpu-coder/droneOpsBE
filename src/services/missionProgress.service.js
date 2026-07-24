import { prisma } from "../config/prisma.js";
import { distanceMeters, normalizeGeoPoint, projectPointOntoRoute } from "../utils/geo.js";

const DEFAULT_WAYPOINT_RADIUS_METERS = 50;

export const syncMissionProgressFromTelemetry = async (mission, telemetryRecord) => {
  if (!mission || mission.status !== "ACTIVE") return null;

  const plannedRoute = normalizeRouteContainer(mission.plannedRoute);
  const waypoints = extractWaypoints(mission.plannedRoute);
  if (waypoints.length < 2) return null;

  const currentPoint = normalizeGeoPoint({
    latitude: telemetryRecord.latitude,
    longitude: telemetryRecord.longitude,
    altitude: telemetryRecord.altitude
  });
  if (!currentPoint) return null;

  const routeProjection = projectPointOntoRoute(currentPoint, waypoints);
  if (!routeProjection) return null;

  const arrivalRadiusMeters = Number(plannedRoute.arrivalRadiusMeters) || DEFAULT_WAYPOINT_RADIUS_METERS;
  const reachedWaypointIndex = getReachedWaypointIndex(currentPoint, waypoints, arrivalRadiusMeters);
  const previousProgress = Number(mission.progress ?? 0);
  const nextProgress = Math.min(Math.max(previousProgress, routeProjection.percent), 99);

  const previousRouteProgress = plannedRoute.progress ?? {};
  const shouldUpdateProgress = nextProgress > previousProgress;
  const shouldUpdateRouteProgress = reachedWaypointIndex > Number(previousRouteProgress.reachedWaypointIndex ?? -1)
    || shouldUpdateProgress;

  if (!shouldUpdateProgress && !shouldUpdateRouteProgress) {
    return {
      progress: previousProgress,
      source: "TELEMETRY",
      updated: false
    };
  }

  const routeProgress = {
    source: "TELEMETRY",
    percent: nextProgress,
    reachedWaypointIndex: Math.max(reachedWaypointIndex, Number(previousRouteProgress.reachedWaypointIndex ?? -1)),
    reachedWaypoints: Math.max(reachedWaypointIndex + 1, Number(previousRouteProgress.reachedWaypoints ?? 0)),
    totalWaypoints: waypoints.length,
    distanceAlongRouteMeters: Math.round(routeProjection.distanceAlongRouteMeters),
    totalDistanceMeters: Math.round(routeProjection.totalDistanceMeters),
    distanceToRouteMeters: Math.round(routeProjection.distanceToRouteMeters),
    lastTelemetryAt: telemetryRecord.timestamp
  };

  const updatedMission = await prisma.mission.update({
    where: { id: mission.id },
    data: {
      progress: nextProgress,
      plannedRoute: {
        ...plannedRoute,
        progress: routeProgress
      }
    },
    select: {
      id: true,
      missionCode: true,
      progress: true,
      plannedRoute: true
    }
  });

  return {
    missionId: updatedMission.id,
    missionCode: updatedMission.missionCode,
    progress: updatedMission.progress,
    routeProgress,
    source: "TELEMETRY",
    updated: true
  };
};

export const extractWaypoints = (plannedRoute) => {
  const route = normalizeRouteContainer(plannedRoute);
  const candidates = [
    route.waypoints,
    route.points,
    route.coordinates,
    route.geometry?.coordinates,
    Array.isArray(plannedRoute) ? plannedRoute : null
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const points = candidate.map(normalizeGeoPoint).filter(Boolean);
    if (points.length >= 2) return points;
  }

  return [];
};

const getReachedWaypointIndex = (currentPoint, waypoints, radiusMeters) => {
  let reachedIndex = -1;

  waypoints.forEach((waypoint, index) => {
    if (distanceMeters(currentPoint, waypoint) <= radiusMeters) {
      reachedIndex = Math.max(reachedIndex, index);
    }
  });

  return reachedIndex;
};

const normalizeRouteContainer = (plannedRoute) => {
  if (Array.isArray(plannedRoute)) {
    return { waypoints: plannedRoute };
  }

  if (!plannedRoute || typeof plannedRoute !== "object") {
    return {};
  }

  return plannedRoute;
};

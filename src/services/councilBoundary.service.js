import { env } from "../config/env.js";

const QUERY_TIMEOUT_MS = 10000;
export const resolveRouteAuthorities = async (plannedRoute) => {
  const routePoints = extractRoutePoints(plannedRoute);
  const operatingArea = normalizeGeoPoint(plannedRoute?.operatingArea) ?? deriveOperatingArea(routePoints);

  if (!env.councilBoundaryLookupEnabled) {
    return buildAuthorityAnalysis({
      status: "DISABLED",
      message: "Council boundary lookup is disabled in server configuration.",
      authorities: [],
      operatingArea
    });
  }

  if (routePoints.length < 2) {
    return buildAuthorityAnalysis({
      status: "INSUFFICIENT_ROUTE",
      message: "At least two route points are required for council boundary analysis.",
      authorities: [],
      operatingArea
    });
  }

  try {
    const routeGeojson = await queryNswLocalGovernmentAreas("esriGeometryPolyline", buildRoutePolyline(routePoints));
    const operatingAreaGeojson = operatingArea
      ? await queryNswLocalGovernmentAreas("esriGeometryPolygon", buildOperatingAreaPolygon(operatingArea))
      : null;
    const features = [
      ...(routeGeojson?.features ?? []),
      ...(operatingAreaGeojson?.features ?? [])
    ];
    const authorities = normalizeAuthorityFeatures(features);

    return buildAuthorityAnalysis({
      status: "READY",
      message: authorities.length
        ? `${authorities.length} council area${authorities.length === 1 ? "" : "s"} intersect this mission route.`
        : "No NSW council boundary intersection was returned for this mission route.",
      authorities,
      operatingArea,
      sourceFeatureCount: features.length
    });
  } catch (error) {
    return buildAuthorityAnalysis({
      status: "UNAVAILABLE",
      message: `Council boundary lookup failed: ${error.message}`,
      authorities: [],
      operatingArea
    });
  }
};

export const mergeAuthorityAnalysisIntoMissionPlan = (plannedRoute, geofenceConfig, authorityAnalysis, options = {}) => {
  const approvalStatuses = getExistingApprovalStatuses(plannedRoute, geofenceConfig);
  const storedAuthorityAnalysis = options.includeGeometry
    ? authorityAnalysis
    : compactAuthorityAnalysis(authorityAnalysis, approvalStatuses);

  return {
    plannedRoute: {
      ...plannedRoute,
      ...(plannedRoute?.operatingArea ? {} : { operatingArea: authorityAnalysis.operatingArea }),
      routeAnalysis: {
        ...(plannedRoute?.routeAnalysis ?? {}),
        councilCount: authorityAnalysis.authorities.length,
        councilSummary: authorityAnalysis.authorities.length
          ? authorityAnalysis.authorities.map((authority) => authority.authorityName).join(", ")
          : authorityAnalysis.message,
        authorityAnalysis: storedAuthorityAnalysis
      }
    },
    geofenceConfig: {
      ...(geofenceConfig && typeof geofenceConfig === "object" && !Array.isArray(geofenceConfig) ? geofenceConfig : {}),
      authorityAnalysis: storedAuthorityAnalysis,
      approvalRequirements: storedAuthorityAnalysis.authorities.map((authority) => ({
        authorityType: authority.authorityType,
        authorityName: authority.authorityName,
        lgaName: authority.lgaName,
        absCode: authority.absCode,
        reference: authority.reference,
        approvalRequired: true,
        approvalStatus: authority.approvalStatus,
        source: authority.source
      }))
    }
  };
};

const queryNswLocalGovernmentAreas = async (geometryType, geometry) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      f: "geojson",
      where: "1=1",
      outFields: "lganame,councilname,abscode,shapeuuid",
      returnGeometry: "true",
      geometryType,
      inSR: "4326",
      outSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      geometry: JSON.stringify(geometry)
    });

    const response = await fetch(env.councilBoundaryServiceUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/geo+json, application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    if (!response.ok) {
      throw new Error(`NSW boundary service returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.error) {
      throw new Error(payload.error.message ?? "NSW boundary service returned an error");
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const buildRoutePolyline = (routePoints) => ({
  paths: [routePoints.map((point) => [Number(point.longitude), Number(point.latitude)])],
  spatialReference: { wkid: 4326 }
});

const buildOperatingAreaPolygon = (operatingArea) => {
  const radiusMeters = Number(operatingArea.radiusMeters) || 500;
  const coordinates = [];
  const steps = 72;
  const earthRadiusMeters = 6371008.8;
  const distance = radiusMeters / earthRadiusMeters;
  const centerLongitude = toRadians(Number(operatingArea.longitude));
  const centerLatitude = toRadians(Number(operatingArea.latitude));

  for (let index = 0; index <= steps; index += 1) {
    const bearing = 2 * Math.PI * (index / steps);
    const latitude = Math.asin(
      Math.sin(centerLatitude) * Math.cos(distance) +
      Math.cos(centerLatitude) * Math.sin(distance) * Math.cos(bearing)
    );
    const longitude = centerLongitude + Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(centerLatitude),
      Math.cos(distance) - Math.sin(centerLatitude) * Math.sin(latitude)
    );

    coordinates.push([toDegrees(longitude), toDegrees(latitude)]);
  }

  return {
    rings: [coordinates],
    spatialReference: { wkid: 4326 }
  };
};

const normalizeAuthorityFeatures = (features) => {
  const authoritiesByReference = new Map();

  features.forEach((feature) => {
    const properties = feature?.properties ?? {};
    const councilName = cleanName(properties.councilname);
    const lgaName = cleanName(properties.lganame);
    const reference = properties.shapeuuid ?? properties.abscode ?? councilName ?? lgaName;
    if (!reference) return;

    authoritiesByReference.set(String(reference), {
      authorityType: "COUNCIL",
      authorityName: councilName || lgaName || "Unknown Council",
      lgaName: lgaName || councilName || "Unknown LGA",
      absCode: properties.abscode ?? null,
      reference: String(reference),
      source: "NSW_SPATIAL_SERVICES_LOCAL_GOVERNMENT_AREA",
      geometry: feature.geometry ?? null
    });
  });

  return [...authoritiesByReference.values()].sort((a, b) => a.authorityName.localeCompare(b.authorityName));
};

const buildAuthorityAnalysis = ({ status, message, authorities, operatingArea = null, sourceFeatureCount = 0 }) => ({
  status,
  message,
  authorities,
  operatingArea,
  source: "NSW Spatial Services LocalGovernmentArea FeatureServer",
  sourceUrl: env.councilBoundaryServiceUrl,
  sourceFeatureCount,
  analysedAt: new Date().toISOString()
});

const compactAuthorityAnalysis = (authorityAnalysis, approvalStatuses = new Map()) => ({
  status: authorityAnalysis.status,
  message: authorityAnalysis.message,
  source: authorityAnalysis.source,
  sourceUrl: authorityAnalysis.sourceUrl,
  sourceFeatureCount: authorityAnalysis.sourceFeatureCount,
  analysedAt: authorityAnalysis.analysedAt,
  authorities: authorityAnalysis.authorities.map((authority) => ({
    authorityType: authority.authorityType,
    authorityName: authority.authorityName,
    lgaName: authority.lgaName,
    absCode: authority.absCode,
    reference: authority.reference,
    approvalRequired: true,
    approvalStatus: approvalStatuses.get(getAuthorityKey(authority)) ?? "PENDING",
    source: authority.source
  }))
});

const getExistingApprovalStatuses = (plannedRoute, geofenceConfig) => {
  const statuses = new Map();
  const existingAuthorities = [
    ...(plannedRoute?.routeAnalysis?.authorityAnalysis?.authorities ?? []),
    ...(geofenceConfig?.authorityAnalysis?.authorities ?? []),
    ...(geofenceConfig?.approvalRequirements ?? [])
  ];

  existingAuthorities.forEach((authority) => {
    const key = getAuthorityKey(authority);
    if (!key || !authority.approvalStatus) return;
    statuses.set(key, authority.approvalStatus);
  });

  return statuses;
};

const getAuthorityKey = (authority) => String(authority?.reference ?? authority?.absCode ?? authority?.authorityName ?? authority?.lgaName ?? "");

const extractRoutePoints = (plannedRoute) => {
  const route = plannedRoute && typeof plannedRoute === "object" && !Array.isArray(plannedRoute) ? plannedRoute : {};
  const candidates = Array.isArray(route.waypoints)
    ? route.waypoints
    : Array.isArray(route.coordinates)
      ? route.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }))
      : [];

  return candidates.map(normalizeGeoPoint).filter(Boolean);
};

const normalizeGeoPoint = (point) => {
  if (!point) return null;
  const latitude = Number(point.latitude ?? point.lat);
  const longitude = Number(point.longitude ?? point.lng ?? point.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, radiusMeters: point.radiusMeters };
};

const deriveOperatingArea = (routePoints) => {
  if (!Array.isArray(routePoints) || routePoints.length < 2) return null;

  const latitudes = routePoints.map((point) => Number(point.latitude));
  const longitudes = routePoints.map((point) => Number(point.longitude));
  const center = {
    label: "Backend derived operating area",
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2
  };
  const maxDistanceMeters = routePoints.reduce((maxDistance, point) => (
    Math.max(maxDistance, getDistanceMeters(center, point))
  ), 0);

  return {
    ...center,
    radiusMeters: Math.max(500, Math.ceil((maxDistanceMeters + 150) / 50) * 50),
    derivedFrom: "ROUTE_ENVELOPE"
  };
};

const getDistanceMeters = (from, to) => {
  const earthRadiusMeters = 6371008.8;
  const fromLatitude = toRadians(Number(from.latitude));
  const toLatitude = toRadians(Number(to.latitude));
  const latitudeDelta = toRadians(Number(to.latitude) - Number(from.latitude));
  const longitudeDelta = toRadians(Number(to.longitude) - Number(from.longitude));
  const halfChordLength = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(halfChordLength), Math.sqrt(1 - halfChordLength));
};

const cleanName = (value) => (
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
);

const toRadians = (degrees) => degrees * Math.PI / 180;
const toDegrees = (radians) => radians * 180 / Math.PI;

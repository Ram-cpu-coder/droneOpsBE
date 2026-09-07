import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";

const governmentTypeByValue = {
  PROHIBITED: "RESTRICTED",
  RESTRICTED: "RESTRICTED",
  DANGER: "WARNING",
  WARNING: "WARNING",
  ADVISORY: "ADVISORY",
  CONTROLLED: "ADVISORY",
  CTA: "ADVISORY",
  CTR: "WARNING",
  NO_FLY: "RESTRICTED",
  NOFLY: "RESTRICTED"
};

export const getGovernmentAirspaceStatus = async (organisationId) => {
  const [count, latest] = await Promise.all([
    prisma.geofence.count({ where: { organisationId, source: "GOVERNMENT", isActive: true } }),
    prisma.geofence.findFirst({
      where: { organisationId, source: "GOVERNMENT" },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true, provider: true }
    })
  ]);

  return {
    configured: Boolean(env.governmentAirspaceEnabled && env.governmentAirspaceUrl),
    enabled: env.governmentAirspaceEnabled,
    provider: env.governmentAirspaceProvider,
    urlConfigured: Boolean(env.governmentAirspaceUrl),
    activeRestrictions: count,
    lastSyncedAt: latest?.updatedAt ?? null,
    lastProvider: latest?.provider ?? env.governmentAirspaceProvider
  };
};

export const syncGovernmentAirspace = async ({ organisationId }) => {
  if (!env.governmentAirspaceEnabled || !env.governmentAirspaceUrl) {
    throw new AppError("Government airspace provider is not configured", 503, "GOVERNMENT_AIRSPACE_NOT_CONFIGURED");
  }

  const response = await fetch(env.governmentAirspaceUrl, {
    headers: buildProviderHeaders(),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new AppError(`Government airspace provider returned HTTP ${response.status}`, 502, "GOVERNMENT_AIRSPACE_UNAVAILABLE");
  }

  const payload = await response.json();
  const features = normalizeGeoJsonFeatures(payload);
  const zones = features.map(normalizeAirspaceFeature).filter(Boolean);

  if (!zones.length) {
    throw new AppError("Government airspace provider returned no usable polygon restrictions", 502, "GOVERNMENT_AIRSPACE_EMPTY");
  }

  const provider = env.governmentAirspaceProvider;
  const syncedIds = await prisma.$transaction(async (tx) => {
    const saved = [];

    for (const zone of zones) {
      const geofence = await tx.geofence.upsert({
        where: {
          organisationId_source_provider_externalId: {
            organisationId,
            source: "GOVERNMENT",
            provider,
            externalId: zone.externalId
          }
        },
        create: {
          organisationId,
          source: "GOVERNMENT",
          provider,
          ...zone
        },
        update: {
          name: zone.name,
          type: zone.type,
          polygon: zone.polygon,
          metadata: zone.metadata,
          validFrom: zone.validFrom,
          validTo: zone.validTo,
          isActive: true
        },
        select: { id: true }
      });

      saved.push(geofence.id);
    }

    await tx.geofence.updateMany({
      where: {
        organisationId,
        source: "GOVERNMENT",
        provider,
        id: { notIn: saved }
      },
      data: { isActive: false }
    });

    return saved;
  }, { isolationLevel: "Serializable" });

  return {
    provider,
    syncedCount: syncedIds.length,
    syncedAt: new Date().toISOString()
  };
};

const buildProviderHeaders = () => {
  const headers = { Accept: "application/geo+json, application/json" };

  if (env.governmentAirspaceApiKey) {
    headers.Authorization = `Bearer ${env.governmentAirspaceApiKey}`;
  }

  return headers;
};

const normalizeGeoJsonFeatures = (payload) => {
  if (payload?.type === "FeatureCollection" && Array.isArray(payload.features)) {
    return payload.features;
  }

  if (payload?.type === "Feature") {
    return [payload];
  }

  if (Array.isArray(payload?.features)) {
    return payload.features;
  }

  return [];
};

const normalizeAirspaceFeature = (feature) => {
  const properties = feature.properties ?? {};
  const polygons = extractPolygons(feature.geometry);
  const polygon = polygons.find((candidate) => candidate.length >= 3);
  if (!polygon) return null;

  const externalId = String(
    properties.id ??
    properties.identifier ??
    properties.designator ??
    properties.name ??
    feature.id ??
    hashPolygon(polygon)
  );

  return {
    externalId,
    name: String(properties.name ?? properties.title ?? properties.designator ?? `Airspace ${externalId}`).slice(0, 160),
    type: resolveGovernmentType(properties),
    polygon,
    validFrom: parseDate(properties.validFrom ?? properties.valid_from ?? properties.effectiveFrom ?? properties.start),
    validTo: parseDate(properties.validTo ?? properties.valid_to ?? properties.effectiveTo ?? properties.end),
    metadata: {
      source: "government_airspace",
      class: properties.class ?? properties.airspaceClass ?? properties.airspace_class,
      category: properties.category ?? properties.type,
      lowerLimit: properties.lowerLimit ?? properties.lower_limit ?? properties.lower,
      upperLimit: properties.upperLimit ?? properties.upper_limit ?? properties.upper,
      rawProperties: properties
    },
    isActive: true
  };
};

const extractPolygons = (geometry) => {
  if (!geometry) return [];

  if (geometry.type === "Polygon") {
    return [normalizeRing(geometry.coordinates?.[0])].filter((ring) => ring.length >= 3);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      ?.map((polygon) => normalizeRing(polygon?.[0]))
      .filter((ring) => ring.length >= 3) ?? [];
  }

  return [];
};

const normalizeRing = (ring = []) => ring
  .map((point) => {
    const longitude = Number(point?.[0]);
    const latitude = Number(point?.[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
    return [longitude, latitude];
  })
  .filter(Boolean);

const resolveGovernmentType = (properties) => {
  const values = [
    properties.restrictionType,
    properties.restriction_type,
    properties.type,
    properties.category,
    properties.class,
    properties.airspaceClass
  ].filter(Boolean).map((value) => String(value).toUpperCase().replace(/[^A-Z]/g, "_"));

  for (const value of values) {
    if (governmentTypeByValue[value]) return governmentTypeByValue[value];
    if (value.includes("PROHIBITED") || value.includes("RESTRICTED") || value.includes("NO_FLY")) return "RESTRICTED";
    if (value.includes("DANGER") || value.includes("WARNING") || value.includes("CTR")) return "WARNING";
  }

  return "ADVISORY";
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const hashPolygon = (polygon) => polygon
  .slice(0, 8)
  .map(([longitude, latitude]) => `${longitude.toFixed(5)},${latitude.toFixed(5)}`)
  .join("|");

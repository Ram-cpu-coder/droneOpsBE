export const isPointInPolygon = ([longitude, latitude], polygon) => {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > latitude !== yj > latitude
      && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
};

export const distanceMeters = (from, to) => {
  const fromPoint = normalizeGeoPoint(from);
  const toPoint = normalizeGeoPoint(to);
  if (!fromPoint || !toPoint) return Number.POSITIVE_INFINITY;

  const earthRadiusMeters = 6371000;
  const fromLatitude = toRadians(fromPoint.latitude);
  const toLatitude = toRadians(toPoint.latitude);
  const deltaLatitude = toRadians(toPoint.latitude - fromPoint.latitude);
  const deltaLongitude = toRadians(toPoint.longitude - fromPoint.longitude);

  const halfChord = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(deltaLongitude / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord));
};

export const normalizeGeoPoint = (value) => {
  if (!value) return null;

  if (Array.isArray(value)) {
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    const altitude = Number(value[2]);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude, altitude: Number.isFinite(altitude) ? altitude : undefined }
      : null;
  }

  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng ?? value.lon);
  const altitude = Number(value.altitude ?? value.alt);

  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude, altitude: Number.isFinite(altitude) ? altitude : undefined }
    : null;
};

export const projectPointOntoRoute = (point, waypoints) => {
  const currentPoint = normalizeGeoPoint(point);
  const route = waypoints.map(normalizeGeoPoint).filter(Boolean);
  if (!currentPoint || route.length < 2) return null;

  const origin = route[0];
  const projectedRoute = route.map((waypoint) => toLocalMeters(waypoint, origin));
  const projectedPoint = toLocalMeters(currentPoint, origin);
  const cumulativeDistances = [0];

  for (let index = 1; index < route.length; index += 1) {
    cumulativeDistances[index] = cumulativeDistances[index - 1] + distanceMeters(route[index - 1], route[index]);
  }

  const totalDistanceMeters = cumulativeDistances[cumulativeDistances.length - 1];
  if (!Number.isFinite(totalDistanceMeters) || totalDistanceMeters <= 0) return null;

  let nearest = {
    distanceToRouteMeters: Number.POSITIVE_INFINITY,
    distanceAlongRouteMeters: 0,
    segmentIndex: 0
  };

  for (let index = 0; index < projectedRoute.length - 1; index += 1) {
    const start = projectedRoute[index];
    const end = projectedRoute[index + 1];
    const segment = subtract(end, start);
    const segmentLengthSquared = segment.x ** 2 + segment.y ** 2;
    if (segmentLengthSquared === 0) continue;

    const ratio = clamp(dot(subtract(projectedPoint, start), segment) / segmentLengthSquared, 0, 1);
    const projected = {
      x: start.x + segment.x * ratio,
      y: start.y + segment.y * ratio
    };
    const distanceToRouteMeters = Math.hypot(projectedPoint.x - projected.x, projectedPoint.y - projected.y);
    const segmentLengthMeters = cumulativeDistances[index + 1] - cumulativeDistances[index];
    const distanceAlongRouteMeters = cumulativeDistances[index] + segmentLengthMeters * ratio;

    if (distanceToRouteMeters < nearest.distanceToRouteMeters) {
      nearest = {
        distanceToRouteMeters,
        distanceAlongRouteMeters,
        segmentIndex: index
      };
    }
  }

  return {
    ...nearest,
    totalDistanceMeters,
    percent: clamp(Math.round((nearest.distanceAlongRouteMeters / totalDistanceMeters) * 100), 0, 100)
  };
};

const toRadians = (degrees) => degrees * (Math.PI / 180);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const dot = (first, second) => first.x * second.x + first.y * second.y;
const subtract = (first, second) => ({ x: first.x - second.x, y: first.y - second.y });

const toLocalMeters = (point, origin) => {
  const earthRadiusMeters = 6371000;
  const latitude = toRadians(point.latitude);
  const longitude = toRadians(point.longitude);
  const originLatitude = toRadians(origin.latitude);
  const originLongitude = toRadians(origin.longitude);

  return {
    x: (longitude - originLongitude) * Math.cos((latitude + originLatitude) / 2) * earthRadiusMeters,
    y: (latitude - originLatitude) * earthRadiusMeters
  };
};

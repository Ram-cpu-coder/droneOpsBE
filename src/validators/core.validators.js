import { z } from "zod";

export const idParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

export const droneCreateSchema = z.object({
  body: z.object({
    droneCode: z.string().min(2),
    model: z.string().min(2),
    manufacturer: z.string().optional(),
    serialNumber: z.string().min(2),
    batteryType: z.string().optional(),
    firmwareVersion: z.string().optional(),
    status: z.enum(["AVAILABLE", "IN_MISSION", "MAINTENANCE", "GROUNDED", "DISCONNECTED", "AWAITING_APPROVAL"]).default("AVAILABLE"),
    flightHours: z.number().nonnegative().default(0),
    purchaseDate: z.string().datetime().optional(),
    certificationStatus: z.enum(["CERTIFIED", "AWAITING_APPROVAL", "AWAITING_RENEWAL", "EXPIRED", "GROUNDED_PENDING_INSPECTION"]).default("AWAITING_APPROVAL"),
    telemetryProvider: z.enum(["NONE", "GENERIC_REST", "DJI", "AUTEL", "MAVLINK"]).default("NONE"),
    externalDeviceId: z.string().optional(),
    connectorConfig: z.record(z.unknown()).optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const missionCreateSchema = z.object({
  body: z.object({
    missionCode: z.string().min(2),
    name: z.string().min(2),
    type: z.string().min(2),
    droneId: z.string().uuid().optional(),
    pilotId: z.string().uuid().optional(),
    plannedRoute: z.unknown().optional(),
    geofenceConfig: z.unknown().optional(),
    launchSite: z.string().optional(),
    operatingArea: z.string().optional(),
    plannedStartAt: z.string().datetime().optional(),
    plannedEndAt: z.string().datetime().optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const incidentCreateSchema = z.object({
  body: z.object({
    incidentCode: z.string().min(2),
    type: z.enum(["LOSS_OF_SIGNAL", "GEOFENCE_BREACH", "LOW_BATTERY", "COLLISION", "EMERGENCY_LANDING", "EQUIPMENT_FAILURE", "WEATHER_EVENT"]),
    title: z.string().min(2),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    droneId: z.string().uuid(),
    missionId: z.string().uuid().optional(),
    assignedToId: z.string().uuid().optional(),
    location: z.string().optional(),
    source: z.string().optional(),
    details: z.string().optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const telemetryCreateSchema = z.object({
  body: z.object({
    drone_id: z.string(),
    mission_id: z.string().optional(),
    timestamp: z.string().datetime(),
    location: z.object({
      latitude: z.number(),
      longitude: z.number(),
      altitude: z.number()
    }),
    velocity: z.object({
      speed: z.number(),
      heading: z.number()
    }),
    battery: z.object({
      level: z.number().int().min(0).max(100),
      voltage: z.number().optional()
    }),
    signal: z.object({
      strength: z.number().int().min(0).max(100),
      link_quality: z.string()
    }),
    status: z.string()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

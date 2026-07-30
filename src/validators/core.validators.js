import { z } from "zod";

export const idParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({}).optional(),
  query: z.object({}).optional()
});

export const droneCatalogModelSchema = z.object({
  body: z.object({
    manufacturer: z.string().min(2),
    model: z.string().min(2),
    batteryType: z.string().min(2),
    telemetryProvider: z.enum(["NONE", "DJI", "AUTEL", "MAVLINK"]).default("NONE"),
    category: z.string().min(2).optional(),
    sourceUrl: z.string().url().optional(),
    isActive: z.boolean().optional(),
    lastVerifiedAt: z.string().datetime().optional()
  }),
  params: z.object({ id: z.string().uuid().optional() }).optional(),
  query: z.object({}).optional()
});

export const droneCreateSchema = z.object({
  body: z.object({
    droneCode: z.string().min(2).optional(),
    model: z.string().min(2),
    manufacturer: z.string().optional(),
    serialNumber: z.string().min(2),
    batteryType: z.string().optional(),
    firmwareVersion: z.string().optional(),
    status: z.enum(["AVAILABLE", "IN_MISSION", "MAINTENANCE", "GROUNDED", "DISCONNECTED", "AWAITING_APPROVAL"]).default("AVAILABLE"),
    flightHours: z.number().nonnegative().default(0),
    purchaseDate: z.string().datetime().optional(),
    lastMaintenanceDate: z.string().datetime().optional(),
    nextMaintenanceDate: z.string().datetime().optional(),
    inspectionThresholdHours: z.number().int().nonnegative().optional(),
    certificationStatus: z.enum(["CERTIFIED", "AWAITING_APPROVAL", "AWAITING_RENEWAL", "EXPIRED", "GROUNDED_PENDING_INSPECTION"]).default("AWAITING_APPROVAL"),
    certificationReference: z.string().min(2).optional(),
    certificationExpiry: z.string().datetime().optional(),
    remoteId: z.string().min(2).optional(),
    telemetryProvider: z.enum(["NONE", "GENERIC_REST", "DJI", "AUTEL", "MAVLINK"]).default("NONE"),
    externalDeviceId: z.string().optional(),
    connectorConfig: z.record(z.unknown()).optional()
  }).superRefine((data, ctx) => {
    const today = startOfToday();
    const purchaseDate = data.purchaseDate ? new Date(data.purchaseDate) : null;
    const lastMaintenanceDate = data.lastMaintenanceDate ? new Date(data.lastMaintenanceDate) : null;
    const certificationExpiry = data.certificationExpiry ? new Date(data.certificationExpiry) : null;
    const nextMaintenanceDate = data.nextMaintenanceDate ? new Date(data.nextMaintenanceDate) : null;

    if (purchaseDate && purchaseDate > today) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["purchaseDate"], message: "Purchase date cannot be in the future" });
    }

    if (purchaseDate && lastMaintenanceDate && lastMaintenanceDate < purchaseDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lastMaintenanceDate"], message: "Last maintenance date cannot be before purchase date" });
    }

    if (lastMaintenanceDate && lastMaintenanceDate > today) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lastMaintenanceDate"], message: "Last maintenance date cannot be in the future" });
    }

    if (nextMaintenanceDate && lastMaintenanceDate && nextMaintenanceDate < lastMaintenanceDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nextMaintenanceDate"], message: "Next inspection due cannot be before last maintenance date" });
    }

    if (data.certificationStatus === "CERTIFIED" && !data.certificationReference) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["certificationReference"], message: "Certification reference is required for certified drones" });
    }

    if (data.certificationStatus === "CERTIFIED" && !certificationExpiry) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["certificationExpiry"], message: "Certification expiry is required for certified drones" });
    }

    if (certificationExpiry && certificationExpiry < today && data.certificationStatus === "CERTIFIED") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["certificationExpiry"], message: "Expired certification cannot be marked certified" });
    }

    if (data.status === "AVAILABLE" && data.certificationStatus !== "CERTIFIED") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Only certified drones can be marked available" });
    }

    if (data.status === "AVAILABLE" && certificationExpiry && certificationExpiry < today) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "A drone with expired certification cannot be marked available" });
    }

    if (data.telemetryProvider !== "NONE" && !data.externalDeviceId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["externalDeviceId"], message: "Vendor drone/device ID is required when a telemetry connector is selected" });
    }

    if (data.telemetryProvider === "GENERIC_REST") {
      const telemetryUrl = data.connectorConfig?.telemetryUrl;
      if (typeof telemetryUrl !== "string" || !z.string().url().safeParse(telemetryUrl).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["connectorConfig", "telemetryUrl"], message: "A valid vendor telemetry URL is required for Generic REST" });
      }
    }
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

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

export const reportStatusSchema = z.object({
  body: z.object({
    status: z.enum(["REVIEW", "READY"])
  }),
  params: z.object({ id: z.string().uuid() }),
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

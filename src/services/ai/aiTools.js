import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { hasPermission } from "../../constants/roles.js";
import * as droneService from "../drone.service.js";
import * as missionService from "../mission.service.js";
import { writeAudit } from "../audit.service.js";
import { AppError } from "../../utils/AppError.js";

const readOnlyTools = new Set([
  "listDrones",
  "getDrone",
  "getDroneLocation",
  "getDroneStatus",
  "listMissions",
  "getMission",
  "listUsers"
]);

const schemas = {
  listDrones: z.object({
    status: z.string().optional()
  }),
  getDrone: z.object({
    droneIdentifier: z.string().trim().min(1)
  }),
  getDroneLocation: z.object({
    droneIdentifier: z.string().trim().min(1)
  }),
  getDroneStatus: z.object({
    droneIdentifier: z.string().trim().min(1)
  }),
  listMissions: z.object({
    status: z.string().optional(),
    droneIdentifier: z.string().optional(),
    pilotIdentifier: z.string().optional()
  }),
  getMission: z.object({
    missionIdentifier: z.string().trim().min(1)
  }),
  listUsers: z.object({
    role: z.string().optional(),
    query: z.string().optional()
  }),
  createMission: z.object({
    missionName: z.string().trim().min(2),
    missionType: z.string().trim().min(2),
    droneIdentifier: z.string().trim().min(1),
    pilotIdentifier: z.string().trim().min(1),
    scheduledAt: z.string().datetime(),
    durationMinutes: z.number().int().min(10).max(480),
    location: z.string().trim().min(2),
    description: z.string().optional()
  }),
  updateMission: z.object({
    missionIdentifier: z.string().trim().min(1),
    missionName: z.string().trim().min(2).optional(),
    missionType: z.string().trim().min(2).optional(),
    status: z.enum(["AWAITING_AUTHORITY_APPROVAL", "PLANNED", "APPROVED", "RISK_ASSESSMENT_COMPLETED", "ACTIVE", "COMPLETED", "ABORTED", "CANCELLED"]).optional(),
    scheduledAt: z.string().datetime().optional(),
    durationMinutes: z.number().int().min(10).max(480).optional(),
    location: z.string().trim().min(2).optional(),
    description: z.string().optional()
  }),
  assignMission: z.object({
    missionIdentifier: z.string().trim().min(1),
    pilotIdentifier: z.string().trim().min(1)
  })
};

const toolDefinition = (name, description, schema) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: zodToJsonSchema(schema)
  }
});

const zodToJsonSchema = (schema) => {
  const shape = schema.shape;
  const required = [];
  const properties = {};

  Object.entries(shape).forEach(([key, value]) => {
    const isOptional = value.safeParse(undefined).success;
    const inner = value._def?.innerType ?? value;
    if (!isOptional) required.push(key);
    properties[key] = zodFieldToJsonSchema(inner);
  });

  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
};

const zodFieldToJsonSchema = (field) => {
  const typeName = field._def?.typeName;
  if (typeName === "ZodNumber") return { type: "number" };
  if (typeName === "ZodEnum") return { type: "string", enum: field._def.values };
  return { type: "string" };
};

export const aiToolDefinitions = [
  toolDefinition("listDrones", "List drones in the current user's organisation. Optional status filter.", schemas.listDrones),
  toolDefinition("getDrone", "Get one drone by ID, drone code, serial number, or close text match.", schemas.getDrone),
  toolDefinition("getDroneLocation", "Get the latest known telemetry location for one drone.", schemas.getDroneLocation),
  toolDefinition("getDroneStatus", "Get operational, certification, maintenance, and telemetry status for one drone.", schemas.getDroneStatus),
  toolDefinition("listMissions", "List missions in the current user's organisation. Supports optional status, drone, and pilot filters.", schemas.listMissions),
  toolDefinition("getMission", "Get one mission by ID or mission code.", schemas.getMission),
  toolDefinition("listUsers", "List users in the current organisation for assignment lookup.", schemas.listUsers),
  toolDefinition("createMission", "Create a mission after user confirmation. Requires drone, pilot, mission type, scheduled time, duration, and location.", schemas.createMission),
  toolDefinition("updateMission", "Update editable mission planning fields after user confirmation.", schemas.updateMission),
  toolDefinition("assignMission", "Assign a mission to a pilot after user confirmation.", schemas.assignMission)
];

export const isReadOnlyAiTool = (toolName) => readOnlyTools.has(toolName);

export const executeAiTool = async ({ toolName, rawArguments, user, dryRun = false }) => {
  const schema = schemas[toolName];
  if (!schema) throw new AppError("AI requested an unsupported tool.", 400, "AI_TOOL_UNSUPPORTED");

  const args = schema.parse(rawArguments ?? {});
  const startedAt = Date.now();
  const result = await toolHandlers[toolName]({ args, user, dryRun });
  console.log(`[ai] tool=${toolName} user=${user.id} organisation=${user.organisationId} dryRun=${dryRun} success=true latencyMs=${Date.now() - startedAt}`);
  return result;
};

const toolHandlers = {
  async listDrones({ args, user }) {
    requireToolPermission(user, "drones:read");
    const rows = await droneService.listDrones(user.organisationId);
    const status = args.status?.trim().toUpperCase();
    return {
      drones: rows
        .filter((drone) => !status || String(drone.status).toUpperCase() === status)
        .map(summarizeDrone)
    };
  },

  async getDrone({ args, user }) {
    requireToolPermission(user, "drones:read");
    const drone = await resolveDrone(user.organisationId, args.droneIdentifier);
    return { drone: summarizeDrone(drone) };
  },

  async getDroneLocation({ args, user }) {
    requireToolPermission(user, "telemetry:read");
    const drone = await resolveDrone(user.organisationId, args.droneIdentifier);
    const latest = await prisma.telemetryLog.findFirst({
      where: { organisationId: user.organisationId, droneId: drone.id },
      orderBy: { timestamp: "desc" }
    });

    return {
      drone: summarizeDrone(drone),
      location: latest
        ? {
            latitude: latest.latitude,
            longitude: latest.longitude,
            altitude: latest.altitude,
            timestamp: latest.timestamp,
            batteryLevel: latest.batteryLevel,
            signalStrength: latest.signalStrength,
            status: latest.status
          }
        : null
    };
  },

  async getDroneStatus({ args, user }) {
    requireToolPermission(user, "drones:read");
    const drone = await resolveDrone(user.organisationId, args.droneIdentifier);
    return { drone: summarizeDrone(drone) };
  },

  async listMissions({ args, user }) {
    requireToolPermission(user, "missions:read");
    let rows = await missionService.listMissions(user.organisationId);

    if (args.status) {
      const status = args.status.trim().toUpperCase();
      rows = rows.filter((mission) => String(mission.status).toUpperCase() === status);
    }

    if (args.droneIdentifier) {
      const drone = await resolveDrone(user.organisationId, args.droneIdentifier);
      rows = rows.filter((mission) => missionHasDrone(mission, drone.id));
    }

    if (args.pilotIdentifier) {
      const pilot = await resolveUser(user.organisationId, args.pilotIdentifier);
      rows = rows.filter((mission) => missionHasPilot(mission, pilot.id));
    }

    return { missions: rows.slice(0, 20).map(summarizeMission) };
  },

  async getMission({ args, user }) {
    requireToolPermission(user, "missions:read");
    const mission = await resolveMission(user.organisationId, args.missionIdentifier);
    return { mission: summarizeMission(mission) };
  },

  async listUsers({ args, user }) {
    requireToolPermission(user, "users:read");
    const query = args.query?.trim().toLowerCase();
    const role = args.role?.trim().toUpperCase();
    const users = await prisma.user.findMany({
      where: {
        organisationId: user.organisationId,
        ...(role ? { role } : {})
      },
      select: { id: true, name: true, email: true, role: true, isVerified: true },
      orderBy: { name: "asc" },
      take: 40
    });

    return {
      users: users
        .filter((row) => !query || [row.name, row.email, row.role].some((value) => String(value ?? "").toLowerCase().includes(query)))
        .map(summarizeUser)
    };
  },

  async createMission({ args, user, dryRun }) {
    requireToolPermission(user, "missions:manage");
    const drone = await resolveDrone(user.organisationId, args.droneIdentifier);
    const pilot = await resolveUser(user.organisationId, args.pilotIdentifier);
    const start = parseDate(args.scheduledAt, "scheduledAt");
    const end = new Date(start.getTime() + args.durationMinutes * 60 * 1000);
    const payload = {
      name: args.missionName,
      type: args.missionType,
      droneIds: [drone.id],
      pilotIds: [pilot.id],
      launchSite: args.location,
      operatingArea: args.location,
      plannedStartAt: start.toISOString(),
      plannedEndAt: end.toISOString()
    };

    if (dryRun) {
      return {
        confirmation: {
          action: "createMission",
          summary: {
            missionName: payload.name,
            missionType: payload.type,
            drone: drone.droneCode,
            pilot: pilot.name,
            location: args.location,
            scheduledAt: start.toISOString(),
            plannedEndAt: end.toISOString()
          }
        }
      };
    }

    const mission = await missionService.createMission(user.organisationId, payload, user);
    await writeAudit({
      organisationId: user.organisationId,
      actorId: user.id,
      action: "AI_MISSION_CREATED",
      entityType: "MISSION",
      entityId: mission.id,
      metadata: { missionCode: mission.missionCode, name: mission.name }
    });
    return { mission: summarizeMission(mission) };
  },

  async updateMission({ args, user, dryRun }) {
    requireToolPermission(user, "missions:manage");
    const mission = await resolveMission(user.organisationId, args.missionIdentifier);
    const data = {};
    if (args.missionName) data.name = args.missionName;
    if (args.missionType) data.type = args.missionType;
    if (args.status) data.status = args.status;
    if (args.location) {
      data.launchSite = args.location;
      data.operatingArea = args.location;
    }
    if (args.scheduledAt) {
      const start = parseDate(args.scheduledAt, "scheduledAt");
      const duration = args.durationMinutes ?? getMissionDurationMinutes(mission) ?? 60;
      data.plannedStartAt = start;
      data.plannedEndAt = new Date(start.getTime() + duration * 60 * 1000);
    }
    if (args.description) {
      data.plannedRoute = {
        ...(mission.plannedRoute && typeof mission.plannedRoute === "object" ? mission.plannedRoute : {}),
        notes: args.description
      };
    }

    if (!Object.keys(data).length) {
      throw new AppError("No mission updates were provided.", 400, "AI_TOOL_NO_CHANGES");
    }

    if (dryRun) {
      return {
        confirmation: {
          action: "updateMission",
          summary: {
            mission: mission.missionCode,
            fields: Object.keys(data)
          }
        }
      };
    }

    const updated = await missionService.updateMission(user.organisationId, mission.id, data, user.role);
    await writeAudit({
      organisationId: user.organisationId,
      actorId: user.id,
      action: "AI_MISSION_UPDATED",
      entityType: "MISSION",
      entityId: updated.id,
      metadata: { missionCode: updated.missionCode, fields: Object.keys(data) }
    });
    return { mission: summarizeMission(updated) };
  },

  async assignMission({ args, user, dryRun }) {
    requireToolPermission(user, "missions:manage");
    const mission = await resolveMission(user.organisationId, args.missionIdentifier);
    const pilot = await resolveUser(user.organisationId, args.pilotIdentifier);
    const droneIds = assignedDroneIds(mission);
    const pilotIds = [...new Set([...assignedPilotIds(mission), pilot.id])];

    if (dryRun) {
      return {
        confirmation: {
          action: "assignMission",
          summary: {
            mission: mission.missionCode,
            pilot: pilot.name
          }
        }
      };
    }

    const updated = await missionService.updateMission(user.organisationId, mission.id, { droneIds, pilotIds }, user.role);
    await writeAudit({
      organisationId: user.organisationId,
      actorId: user.id,
      action: "AI_MISSION_ASSIGNED",
      entityType: "MISSION",
      entityId: updated.id,
      metadata: { missionCode: updated.missionCode, pilotId: pilot.id }
    });
    return { mission: summarizeMission(updated) };
  }
};

const requireToolPermission = (user, permission) => {
  if (!hasPermission(user.role, permission)) {
    throw new AppError("You do not have permission to perform that AI action.", 403, "AI_TOOL_FORBIDDEN");
  }
};

const resolveDrone = async (organisationId, identifier) => {
  const query = String(identifier ?? "").trim();
  const lowered = query.toLowerCase();
  const drones = await droneService.listDrones(organisationId);
  const matches = drones.filter((drone) => (
    [drone.id, drone.droneCode, drone.serialNumber, drone.remoteId, drone.externalDeviceId]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === lowered)
    || [drone.droneCode, drone.serialNumber, drone.model, drone.manufacturer]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(lowered))
  ));

  return resolveSingleMatch(matches, "drone", query, (drone) => drone.droneCode);
};

const resolveMission = async (organisationId, identifier) => {
  const query = String(identifier ?? "").trim();
  const lowered = query.toLowerCase();
  const missions = await missionService.listMissions(organisationId);
  const matches = missions.filter((mission) => (
    [mission.id, mission.missionCode, mission.name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === lowered)
    || [mission.missionCode, mission.name, mission.type]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(lowered))
  ));

  return resolveSingleMatch(matches, "mission", query, (mission) => mission.missionCode);
};

const resolveUser = async (organisationId, identifier) => {
  const query = String(identifier ?? "").trim();
  const lowered = query.toLowerCase();
  const users = await prisma.user.findMany({
    where: { organisationId },
    select: { id: true, name: true, email: true, role: true, isVerified: true, pilotCredentials: true }
  });
  const matches = users.filter((user) => (
    [user.id, user.email, user.name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === lowered)
    || [user.name, user.email, user.role]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(lowered))
  ));

  return resolveSingleMatch(matches, "user", query, (user) => `${user.name} (${user.email})`);
};

const resolveSingleMatch = (matches, entity, query, label) => {
  if (!matches.length) {
    throw new AppError(`No ${entity} matched "${query}".`, 404, `AI_${entity.toUpperCase()}_NOT_FOUND`);
  }
  if (matches.length > 1) {
    throw new AppError(
      `Multiple ${entity}s matched "${query}". Please be more specific: ${matches.slice(0, 5).map(label).join(", ")}.`,
      409,
      `AI_${entity.toUpperCase()}_AMBIGUOUS`
    );
  }
  return matches[0];
};

const parseDate = (value, field) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`Invalid ${field}. Use an ISO date/time.`, 400, "AI_INVALID_DATE");
  }
  return date;
};

const summarizeDrone = (drone) => ({
  id: drone.id,
  droneCode: drone.droneCode,
  model: drone.model,
  manufacturer: drone.manufacturer,
  serialNumber: drone.serialNumber,
  status: drone.status,
  certificationStatus: drone.certificationStatus,
  connectorStatus: drone.connectorStatus,
  telemetryProvider: drone.telemetryProvider,
  batteryType: drone.batteryType,
  flightHours: drone.flightHours,
  maintenanceOverdue: Boolean(drone.maintenanceOverdue),
  lastTelemetryAt: drone.lastTelemetryAt,
  activeMission: drone.activeMission
});

const summarizeMission = (mission) => ({
  id: mission.id,
  missionCode: mission.missionCode,
  name: mission.name,
  type: mission.type,
  status: mission.status,
  progress: mission.progress,
  launchSite: mission.launchSite,
  operatingArea: mission.operatingArea,
  plannedStartAt: mission.plannedStartAt,
  plannedEndAt: mission.plannedEndAt,
  drones: assignedDroneLabels(mission),
  pilots: assignedPilotLabels(mission),
  riskLevel: mission.riskAssessment?.level ?? null
});

const summarizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  isVerified: user.isVerified
});

const assignedDroneIds = (mission) => [
  mission.droneId,
  ...(mission.droneAssignments?.map((assignment) => assignment.droneId) ?? [])
].filter(Boolean);

const assignedPilotIds = (mission) => [
  mission.pilotId,
  ...(mission.pilotAssignments?.map((assignment) => assignment.pilotId) ?? [])
].filter(Boolean);

const assignedDroneLabels = (mission) => {
  const labels = [
    mission.drone?.droneCode,
    ...(mission.droneAssignments?.map((assignment) => assignment.drone?.droneCode) ?? [])
  ].filter(Boolean);
  return [...new Set(labels)];
};

const assignedPilotLabels = (mission) => {
  const labels = [
    mission.pilot?.name,
    ...(mission.pilotAssignments?.map((assignment) => assignment.pilot?.name) ?? [])
  ].filter(Boolean);
  return [...new Set(labels)];
};

const missionHasDrone = (mission, droneId) => assignedDroneIds(mission).includes(droneId);

const missionHasPilot = (mission, pilotId) => assignedPilotIds(mission).includes(pilotId);

const getMissionDurationMinutes = (mission) => {
  if (!mission.plannedStartAt || !mission.plannedEndAt) return null;
  const start = new Date(mission.plannedStartAt);
  const end = new Date(mission.plannedEndAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(10, Math.round((end.getTime() - start.getTime()) / 60000));
};

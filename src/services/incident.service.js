import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";

export const listIncidents = (organisationId) => {
  return prisma.incident.findMany({
    where: { organisationId },
    include: {
      drone: { select: { id: true, droneCode: true } },
      mission: { select: { id: true, missionCode: true, name: true } },
      reportedBy: { select: { id: true, name: true, role: true } },
      assignedTo: { select: { id: true, name: true, role: true } }
    },
    orderBy: { createdAt: "desc" }
  });
};

export const createIncident = async (organisationId, reportedById, data) => {
  const incidentCode = data.incidentCode ?? await generateIncidentCode(organisationId);
  const incident = await prisma.incident.create({
    data: {
      organisationId,
      incidentCode,
      type: data.type,
      title: data.title,
      severity: data.severity,
      droneId: data.droneId,
      missionId: data.missionId,
      reportedById,
      assignedToId: data.assignedToId,
      location: data.location,
      source: data.source,
      details: data.details,
      timeline: [{ at: new Date().toISOString(), event: "Incident created", by: reportedById }]
    }
  });

  if (data.severity === "CRITICAL") {
    await prisma.drone.update({ where: { id: data.droneId }, data: { status: "GROUNDED" } });
  }

  return incident;
};

export const updateIncident = async (organisationId, id, data) => {
  const incident = await prisma.incident.findFirst({ where: { id, organisationId } });
  if (!incident) throw new AppError("Incident not found", 404, "INCIDENT_NOT_FOUND");
  if (data.status === "CLOSED" && !data.rootCause && !incident.rootCause) {
    throw new AppError("Root cause is required before closing an incident", 409, "ROOT_CAUSE_REQUIRED");
  }

  return prisma.incident.update({
    where: { id },
    data
  });
};

export const deleteIncident = async (organisationId, id) => {
  const incident = await prisma.incident.findFirst({ where: { id, organisationId } });
  if (!incident) throw new AppError("Incident not found", 404, "INCIDENT_NOT_FOUND");

  await prisma.incident.delete({ where: { id } });
  return incident;
};

const generateIncidentCode = async (organisationId) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const count = await prisma.incident.count({ where: { organisationId } });
    const candidate = `INC-${String(count + 1 + attempt).padStart(4, "0")}`;
    const existing = await prisma.incident.findFirst({
      where: { organisationId, incidentCode: candidate },
      select: { id: true }
    });

    if (!existing) return candidate;
  }

  return `INC-${Date.now().toString().slice(-6)}`;
};

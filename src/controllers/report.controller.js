import { prisma } from "../config/prisma.js";
import { writeAudit } from "../services/audit.service.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const reports = await prisma.report.findMany({
    where: { organisationId: req.user.organisationId },
    include: {
      generatedBy: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });
  return ok(res, reports);
});

export const create = asyncHandler(async (req, res) => {
  const { type, title, status, dataSnapshot, fileUrl } = req.validated.body;
  const report = await prisma.report.create({
    data: {
      organisationId: req.user.organisationId,
      generatedById: req.user.id,
      type,
      title,
      status: status === "READY" ? "READY" : "REVIEW",
      dataSnapshot,
      fileUrl
    }
  });
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "REPORT_CREATED",
    entityType: "REPORT",
    entityId: report.id,
    metadata: {
      title: report.title,
      type: report.type
    }
  });
  return created(res, report, "Report generated");
});

export const summary = asyncHandler(async (req, res) => {
  const [drones, missions, incidents, maintenance] = await Promise.all([
    prisma.drone.count({ where: { organisationId: req.user.organisationId } }),
    prisma.mission.count({ where: { organisationId: req.user.organisationId } }),
    prisma.incident.count({ where: { organisationId: req.user.organisationId, status: { not: "CLOSED" } } }),
    prisma.maintenanceRecord.count({ where: { organisationId: req.user.organisationId, status: { in: ["SCHEDULED", "OVERDUE"] } } })
  ]);

  return ok(res, { drones, missions, openIncidents: incidents, pendingMaintenance: maintenance }, "Operations summary");
});

export const generate = asyncHandler(async (req, res) => {
  const requestedType = String(req.validated.body?.type ?? "UTILIZATION").toUpperCase();
  const scope = buildReportScope(req.validated.body ?? {});
  const take = scope.limit;

  const [drones, missions, incidents, maintenance] = await Promise.all([
    prisma.drone.findMany({
      where: {
        organisationId: req.user.organisationId,
        ...buildDateWhere("createdAt", scope)
      },
      orderBy: { createdAt: "desc" },
      take
    }),
    prisma.mission.findMany({
      where: {
        organisationId: req.user.organisationId,
        ...buildMissionDateWhere(scope)
      },
      include: {
        drone: { select: { droneCode: true, model: true } },
        pilot: { select: { name: true } },
        riskAssessment: { select: { level: true } }
      },
      orderBy: { createdAt: "desc" },
      take
    }),
    prisma.incident.findMany({
      where: {
        organisationId: req.user.organisationId,
        ...buildDateWhere("createdAt", scope)
      },
      include: {
        assignedTo: { select: { name: true } },
        drone: { select: { droneCode: true } },
        mission: { select: { missionCode: true, name: true } }
      },
      orderBy: { createdAt: "desc" },
      take
    }),
    prisma.maintenanceRecord.findMany({
      where: {
        organisationId: req.user.organisationId,
        ...buildMaintenanceDateWhere(scope)
      },
      include: {
        drone: { select: { droneCode: true, model: true } },
        assignedTo: { select: { name: true } }
      },
      orderBy: { createdAt: "desc" },
      take
    })
  ]);

  const summary = {
    drones: drones.length,
    activeMissions: missions.filter((mission) => mission.status === "ACTIVE").length,
    openIncidents: incidents.filter((incident) => incident.status !== "CLOSED").length,
    pendingMaintenance: maintenance.filter((record) => ["SCHEDULED", "OVERDUE", "IN_PROGRESS"].includes(record.status)).length
  };

  const snapshotByType = {
    FLIGHT_ACTIVITY: {
      scope: buildSnapshotScope(scope, "Mission planned date"),
      summary: {
        value: `${missions.length} missions`,
        change: `${missions.filter((mission) => mission.status === "ACTIVE").length} active missions in current snapshot`,
        status: "READY",
        owner: req.user.name
      },
      missions: missions.map((mission) => ({
        missionCode: mission.missionCode,
        name: mission.name,
        status: mission.status,
        progress: mission.progress,
        plannedStartAt: mission.plannedStartAt,
        plannedEndAt: mission.plannedEndAt,
        pilot: mission.pilot?.name,
        drone: mission.drone?.droneCode,
        risk: mission.riskAssessment?.level
      }))
    },
    INCIDENT: {
      scope: buildSnapshotScope(scope, "Incident reported date"),
      summary: {
        value: `${incidents.length} incidents`,
        change: `${incidents.filter((incident) => ["HIGH", "CRITICAL"].includes(incident.severity)).length} high-severity incidents`,
        status: "READY",
        owner: req.user.name
      },
      incidents: incidents.map((incident) => ({
        incidentCode: incident.incidentCode,
        title: incident.title,
        status: incident.status,
        severity: incident.severity,
        owner: incident.assignedTo?.name,
        drone: incident.drone?.droneCode,
        mission: incident.mission?.missionCode ?? incident.mission?.name,
        reportedAt: incident.createdAt
      }))
    },
    MAINTENANCE: {
      scope: buildSnapshotScope(scope, "Maintenance due date"),
      summary: {
        value: `${maintenance.length} maintenance items`,
        change: `${maintenance.filter((record) => record.status === "OVERDUE").length} overdue items`,
        status: "READY",
        owner: req.user.name
      },
      maintenance: maintenance.map((record) => ({
        type: record.type,
        status: record.status,
        triggerType: record.triggerType,
        dueAt: record.dueAt,
        drone: record.drone?.droneCode,
        assignedTo: record.assignedTo?.name
      }))
    },
    COMPLIANCE: {
      scope: buildSnapshotScope(scope, "Compliance snapshot date"),
      summary: {
        value: `${summary.openIncidents} open issues`,
        change: `${summary.pendingMaintenance} maintenance items pending review`,
        status: "READY",
        owner: req.user.name
      },
      compliance: {
        openIncidents: summary.openIncidents,
        pendingMaintenance: summary.pendingMaintenance,
        certifiedDrones: drones.filter((drone) => drone.certificationStatus === "CERTIFIED").length,
        awaitingApproval: drones.filter((drone) => drone.certificationStatus === "AWAITING_APPROVAL").length,
        includedDrones: drones.length,
        includedIncidents: incidents.length,
        includedMaintenance: maintenance.length
      }
    },
    UTILIZATION: {
      scope: buildSnapshotScope(scope, "Fleet activity date"),
      summary: {
        value: `${summary.drones} drones`,
        change: `${summary.activeMissions} active missions across fleet`,
        status: "READY",
        owner: req.user.name
      },
      utilization: {
        totalDrones: summary.drones,
        activeMissions: summary.activeMissions,
        inMissionDrones: drones.filter((drone) => drone.status === "IN_MISSION").length,
        availableDrones: drones.filter((drone) => drone.status === "AVAILABLE").length,
        includedMissions: missions.length
      }
    }
  };

  const snapshot = snapshotByType[requestedType] ?? snapshotByType.UTILIZATION;
  const title = `${requestedType.toLowerCase().replaceAll("_", " ")} report - ${new Date().toLocaleDateString("en-AU")}`;

  const report = await prisma.report.create({
    data: {
      organisationId: req.user.organisationId,
      generatedById: req.user.id,
      type: requestedType,
      title,
      status: "READY",
      dataSnapshot: snapshot
    },
    include: {
      generatedBy: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "REPORT_GENERATED",
    entityType: "REPORT",
    entityId: report.id,
    metadata: {
      title: report.title,
      type: report.type,
      scope: snapshot.scope
    }
  });

  return created(res, report, "Report generated from live organisation data");
});

const buildReportScope = (body) => {
  const dateFrom = body.dateFrom ? parseReportBoundary(body.dateFrom, "start") : null;
  const dateTo = body.dateTo ? parseReportBoundary(body.dateTo, "end") : null;

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AppError("Report start date cannot be after the end date", 400, "INVALID_REPORT_SCOPE");
  }

  return {
    dateFrom,
    dateTo,
    limit: Math.min(Math.max(Number(body.limit ?? 50), 1), 250)
  };
};

const parseReportBoundary = (value, boundary) => {
  const date = new Date(`${value}T${boundary === "end" ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new AppError("Invalid report date range", 400, "INVALID_REPORT_SCOPE");
  }
  return date;
};

const buildDateWhere = (fieldName, scope) => {
  const range = {};
  if (scope.dateFrom) range.gte = scope.dateFrom;
  if (scope.dateTo) range.lte = scope.dateTo;
  return Object.keys(range).length ? { [fieldName]: range } : {};
};

const buildMissionDateWhere = (scope) => {
  const range = buildDateWhere("plannedStartAt", scope);
  return Object.keys(range).length ? range : {};
};

const buildMaintenanceDateWhere = (scope) => {
  const dueAtRange = buildDateWhere("dueAt", scope);
  return Object.keys(dueAtRange).length ? dueAtRange : {};
};

const buildSnapshotScope = (scope, dateField) => ({
  dateField,
  dateFrom: scope.dateFrom?.toISOString() ?? null,
  dateTo: scope.dateTo?.toISOString() ?? null,
  limit: scope.limit
});

export const updateStatus = asyncHandler(async (req, res) => {
  const status = req.validated.body.status;
  const report = await prisma.report.findFirst({
    where: {
      id: req.params.id,
      organisationId: req.user.organisationId
    }
  });

  if (!report) {
    throw new AppError("Report not found", 404, "REPORT_NOT_FOUND");
  }

  const updatedReport = await prisma.report.update({
    where: { id: report.id },
    data: { status },
    include: {
      generatedBy: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "REPORT_STATUS_UPDATED",
    entityType: "REPORT",
    entityId: updatedReport.id,
    metadata: {
      title: updatedReport.title,
      type: updatedReport.type,
      status: updatedReport.status
    }
  });

  return ok(res, updatedReport, "Report status updated");
});

export const remove = asyncHandler(async (req, res) => {
  const report = await prisma.report.findFirst({
    where: {
      id: req.params.id,
      organisationId: req.user.organisationId
    }
  });

  if (!report) {
    return ok(res, null, "Report already removed");
  }

  await prisma.report.delete({ where: { id: report.id } });
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "REPORT_DELETED",
    entityType: "REPORT",
    entityId: report.id,
    metadata: {
      title: report.title,
      type: report.type
    }
  });
  return ok(res, { id: report.id }, "Report deleted");
});

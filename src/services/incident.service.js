import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { storeUploadedFile } from "./fileStorage.service.js";

const INCIDENT_EVIDENCE_WINDOW_SECONDS = 5 * 60;

export const listIncidents = async (organisationId) => {
  const incidents = await prisma.incident.findMany({
    where: { organisationId },
    include: {
      drone: { select: { id: true, droneCode: true } },
      mission: { select: { id: true, missionCode: true, name: true } },
      reportedBy: { select: { id: true, name: true, role: true } },
      assignedTo: { select: { id: true, name: true, role: true } },
      droneLinks: {
        include: { drone: { select: { id: true, droneCode: true, model: true, manufacturer: true, status: true, batteryType: true } } },
        orderBy: { createdAt: "asc" }
      },
      assigneeLinks: {
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: "asc" }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return attachIncidentEvidenceDocuments(organisationId, incidents);
};

export const createIncident = async (organisationId, reportedById, data) => {
  const incidentCode = data.incidentCode ?? await generateIncidentCode(organisationId);
  const droneIds = normalizeAssignmentIds(data.droneId, data.droneIds);
  const assigneeIds = normalizeAssignmentIds(data.assignedToId, data.assignedToIds);
  if (!droneIds.length) throw new AppError("Select at least one affected drone before logging the incident", 400, "INCIDENT_DRONE_REQUIRED");

  const incident = await prisma.$transaction(async (tx) => {
    const createdIncident = await tx.incident.create({
      data: {
        organisationId,
        incidentCode,
        type: data.type,
        title: data.title,
        severity: data.severity,
        droneId: droneIds[0],
        missionId: data.missionId,
        reportedById,
        assignedToId: assigneeIds[0],
        location: data.location,
        source: data.source,
        details: data.details,
        timeline: [{ at: new Date().toISOString(), event: "Incident created", by: reportedById }],
        droneLinks: {
          create: droneIds.map((droneId, index) => ({ organisationId, droneId, isPrimary: index === 0 }))
        },
        assigneeLinks: {
          create: assigneeIds.map((userId, index) => ({ organisationId, userId, isPrimary: index === 0 }))
        }
      }
    });

    const evidence = await captureIncidentTelemetryEvidence(tx, organisationId, {
      incident: createdIncident,
      droneIds,
      missionId: data.missionId
    });

    if (!evidence) return createdIncident;

    return tx.incident.update({
      where: { id: createdIncident.id },
      data: {
        evidence,
        timeline: [
          ...(Array.isArray(createdIncident.timeline) ? createdIncident.timeline : []),
          {
            at: evidence.capturedAt,
            event: `Incident evidence capture stored ${evidence.blackBox.recordCount} telemetry record(s)`,
            by: "system"
          }
        ]
      }
    });
  });

  if (data.severity === "CRITICAL") {
    await prisma.drone.updateMany({ where: { organisationId, id: { in: droneIds } }, data: { status: "GROUNDED" } });
  }

  return incident;
};

export const uploadIncidentEvidence = async (organisationId, uploadedById, incidentId, file, metadata = {}) => {
  if (!file) throw new AppError("Evidence file is required", 400, "INCIDENT_EVIDENCE_FILE_REQUIRED");
  validateIncidentEvidenceFile(file);

  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, organisationId },
    select: { id: true, incidentCode: true, title: true }
  });
  if (!incident) throw new AppError("Incident not found", 404, "INCIDENT_NOT_FOUND");

  const storedFile = await storeUploadedFile(file, {
    organisationId,
    entityType: "incidents",
    entityCode: incident.incidentCode ?? incident.id,
    subfolder: "evidence"
  });

  const document = await prisma.document.create({
    data: {
      organisationId,
      entityType: "INCIDENT",
      entityId: incident.id,
      category: "INCIDENT_EVIDENCE_CAPTURE",
      title: metadata.title || file.originalname || `${incident.incidentCode} evidence`,
      fileUrl: storedFile.fileUrl,
      uploadedById,
      metadata: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storageProvider: storedFile.storageProvider,
        publicId: storedFile.publicId,
        resourceType: storedFile.resourceType,
        evidenceType: file.mimetype.startsWith("video/") ? "video" : file.mimetype.startsWith("image/") ? "photo" : "document",
        capturedBy: "user",
        notes: metadata.notes || null
      }
    }
  });

  return document;
};

export const getIncidentEvidence = async (organisationId, incidentId) => {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, organisationId },
    include: {
      droneLinks: { select: { droneId: true } }
    }
  });
  if (!incident) throw new AppError("Incident not found", 404, "INCIDENT_NOT_FOUND");

  let evidence = incident.evidence;
  if (!evidence?.blackBox?.summary?.hasTelemetry) {
    evidence = await captureIncidentTelemetryEvidence(prisma, organisationId, {
      incident,
      droneIds: incident.droneLinks.map((link) => link.droneId),
      missionId: incident.missionId
    });

    await prisma.incident.update({
      where: { id: incident.id },
      data: { evidence }
    });
  }

  const documents = await prisma.document.findMany({
    where: {
      organisationId,
      entityType: "INCIDENT",
      entityId: incident.id,
      category: "INCIDENT_EVIDENCE_CAPTURE"
    },
    orderBy: { createdAt: "desc" }
  });

  return {
    incidentId: incident.id,
    incidentCode: incident.incidentCode,
    blackBox: evidence?.blackBox ?? null,
    documents
  };
};

export const updateIncident = async (organisationId, id, data) => {
  const incident = await prisma.incident.findFirst({
    where: { id, organisationId },
    include: { droneLinks: true, assigneeLinks: true }
  });
  if (!incident) throw new AppError("Incident not found", 404, "INCIDENT_NOT_FOUND");
  if (data.status === "CLOSED" && !data.rootCause && !incident.rootCause) {
    throw new AppError("Root cause is required before closing an incident", 409, "ROOT_CAUSE_REQUIRED");
  }

  const hasDroneLinks = data.droneId !== undefined || data.droneIds !== undefined;
  const hasAssigneeLinks = data.assignedToId !== undefined || data.assignedToIds !== undefined;
  const droneIds = hasDroneLinks ? normalizeAssignmentIds(data.droneId, data.droneIds) : [];
  const assigneeIds = hasAssigneeLinks ? normalizeAssignmentIds(data.assignedToId, data.assignedToIds) : [];
  const updateData = { ...data };
  delete updateData.droneIds;
  delete updateData.assignedToIds;
  if (hasDroneLinks) updateData.droneId = droneIds[0];
  if (hasAssigneeLinks) updateData.assignedToId = assigneeIds[0] ?? null;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.incident.update({
      where: { id },
      data: updateData
    });

    if (hasDroneLinks) {
      await tx.incidentDroneLink.deleteMany({ where: { incidentId: id } });
      await tx.incidentDroneLink.createMany({
        data: droneIds.map((droneId, index) => ({ organisationId, incidentId: id, droneId, isPrimary: index === 0 })),
        skipDuplicates: true
      });
    }

    if (hasAssigneeLinks) {
      await tx.incidentAssigneeLink.deleteMany({ where: { incidentId: id } });
      await tx.incidentAssigneeLink.createMany({
        data: assigneeIds.map((userId, index) => ({ organisationId, incidentId: id, userId, isPrimary: index === 0 })),
        skipDuplicates: true
      });
    }

    if (data.severity === "CRITICAL" && droneIds.length) {
      await tx.drone.updateMany({ where: { organisationId, id: { in: droneIds } }, data: { status: "GROUNDED" } });
    }

    return updated;
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

const normalizeAssignmentIds = (primaryId, ids = []) => (
  [...new Set([primaryId, ...(Array.isArray(ids) ? ids : [])].filter(Boolean))]
);

const captureIncidentTelemetryEvidence = async (tx, organisationId, { incident, droneIds, missionId }) => {
  const capturedAt = new Date();
  const currentWindow = buildIncidentTelemetryWindow(capturedAt);
  let captureAnchor = capturedAt;
  let captureWindow = currentWindow;
  let captureSource = "CURRENT_TIME_WINDOW";
  let telemetryWhere = {
    organisationId,
    droneId: { in: droneIds },
    timestamp: {
      gte: currentWindow.from,
      lte: currentWindow.to
    },
    ...(missionId ? { OR: [{ missionId }, { missionId: null }] } : {})
  };

  let telemetryRecords = await findIncidentTelemetryRecords(tx, telemetryWhere);

  if (!telemetryRecords.length && missionId) {
    const latestMissionTelemetry = await findLatestMissionTelemetry(tx, organisationId, missionId, droneIds);

    if (latestMissionTelemetry) {
      captureAnchor = latestMissionTelemetry.timestamp;
      captureWindow = buildIncidentTelemetryWindow(captureAnchor);
      captureSource = "MISSION_LATEST_TELEMETRY_WINDOW";
      telemetryWhere = {
        organisationId,
        missionId,
        timestamp: {
          gte: captureWindow.from,
          lte: captureWindow.to
        },
        ...(latestMissionTelemetry.droneId ? { droneId: latestMissionTelemetry.droneId } : {})
      };
      telemetryRecords = await findIncidentTelemetryRecords(tx, telemetryWhere);
    }
  }

  const replay = telemetryRecords.map(toIncidentTelemetryPoint);

  return {
    capturedAt: captureAnchor.toISOString(),
    captureType: "INCIDENT_EVIDENCE_CAPTURE",
    blackBox: {
      windowSeconds: INCIDENT_EVIDENCE_WINDOW_SECONDS,
      from: captureWindow.from.toISOString(),
      to: captureWindow.to.toISOString(),
      source: captureSource,
      droneIds,
      missionId: missionId ?? null,
      incidentId: incident.id,
      incidentCode: incident.incidentCode,
      recordCount: replay.length,
      summary: summarizeTelemetryReplay(replay),
      replay
    }
  };
};

const findIncidentTelemetryRecords = (tx, telemetryWhere) => (
  tx.telemetryLog.findMany({
    where: telemetryWhere,
    orderBy: { timestamp: "asc" },
    take: 600,
    include: {
      drone: { select: { id: true, droneCode: true, model: true, externalDeviceId: true } },
      mission: { select: { id: true, missionCode: true, name: true } }
    }
  })
);

const findLatestMissionTelemetry = async (tx, organisationId, missionId, droneIds) => {
  const linkedDroneTelemetry = droneIds.length
    ? await tx.telemetryLog.findFirst({
      where: { organisationId, missionId, droneId: { in: droneIds } },
      orderBy: { timestamp: "desc" }
    })
    : null;

  if (linkedDroneTelemetry) return linkedDroneTelemetry;

  return tx.telemetryLog.findFirst({
    where: { organisationId, missionId },
    orderBy: { timestamp: "desc" }
  });
};

const buildIncidentTelemetryWindow = (anchorDate) => ({
  from: new Date(anchorDate.getTime() - INCIDENT_EVIDENCE_WINDOW_SECONDS * 1000),
  to: anchorDate
});

const toIncidentTelemetryPoint = (record) => ({
  id: record.id,
  timestamp: record.timestamp?.toISOString?.() ?? record.timestamp,
  droneId: record.droneId,
  droneCode: record.drone?.droneCode,
  externalDeviceId: record.drone?.externalDeviceId,
  missionId: record.missionId,
  missionCode: record.mission?.missionCode,
  location: {
    latitude: record.latitude,
    longitude: record.longitude,
    altitude: record.altitude
  },
  velocity: {
    speed: record.speed,
    heading: record.heading
  },
  battery: {
    level: record.batteryLevel,
    voltage: record.batteryVoltage
  },
  signal: {
    strength: record.signalStrength,
    linkQuality: record.linkQuality
  },
  status: record.status
});

const summarizeTelemetryReplay = (replay) => {
  if (!replay.length) {
    return {
      hasTelemetry: false,
      message: "No telemetry records were available in the evidence window."
    };
  }

  const first = replay[0];
  const last = replay[replay.length - 1];
  const batteryLevels = replay.map((point) => point.battery.level).filter(Number.isFinite);
  const speeds = replay.map((point) => point.velocity.speed).filter(Number.isFinite);
  const altitudes = replay.map((point) => point.location.altitude).filter(Number.isFinite);

  return {
    hasTelemetry: true,
    firstTimestamp: first.timestamp,
    lastTimestamp: last.timestamp,
    startLocation: first.location,
    lastLocation: last.location,
    minBattery: batteryLevels.length ? Math.min(...batteryLevels) : null,
    maxSpeed: speeds.length ? Math.max(...speeds) : null,
    maxAltitude: altitudes.length ? Math.max(...altitudes) : null,
    status: last.status,
    droneCount: new Set(replay.map((point) => point.droneId)).size
  };
};

const attachIncidentEvidenceDocuments = async (organisationId, incidents) => {
  if (!incidents.length) return incidents;

  const documents = await prisma.document.findMany({
    where: {
      organisationId,
      entityType: "INCIDENT",
      entityId: { in: incidents.map((incident) => incident.id) },
      category: "INCIDENT_EVIDENCE_CAPTURE"
    },
    orderBy: { createdAt: "desc" }
  });
  const documentsByIncident = documents.reduce((accumulator, document) => {
    accumulator.set(document.entityId, [...(accumulator.get(document.entityId) ?? []), document]);
    return accumulator;
  }, new Map());

  return incidents.map((incident) => ({
    ...incident,
    evidenceDocuments: documentsByIncident.get(incident.id) ?? []
  }));
};

const validateIncidentEvidenceFile = (file) => {
  if (!hasExpectedFileSignature(file)) {
    throw new AppError("Attachment content does not match the selected file type", 415, "UPLOAD_SIGNATURE_MISMATCH");
  }
};

const hasExpectedFileSignature = (file) => {
  const buffer = file.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;

  if (file.mimetype === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (file.mimetype === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (file.mimetype === "image/webp") return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (["image/heic", "image/heif", "video/mp4", "video/quicktime"].includes(file.mimetype)) return buffer.toString("ascii", 4, 8) === "ftyp";
  if (file.mimetype === "video/webm") return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  if (file.mimetype === "application/pdf") return buffer.toString("ascii", 0, 5) === "%PDF-";
  if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (file.mimetype === "application/msword") return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (file.mimetype === "text/plain") return !buffer.subarray(0, Math.min(buffer.length, 2048)).includes(0);

  return false;
};

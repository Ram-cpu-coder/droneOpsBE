CREATE TABLE "MissionDroneAssignment" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "droneId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MissionDroneAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MissionPilotAssignment" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "pilotId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MissionPilotAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IncidentDroneLink" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "droneId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IncidentDroneLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IncidentAssigneeLink" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IncidentAssigneeLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MissionDroneAssignment_missionId_droneId_key" ON "MissionDroneAssignment"("missionId", "droneId");
CREATE INDEX "MissionDroneAssignment_organisationId_droneId_idx" ON "MissionDroneAssignment"("organisationId", "droneId");

CREATE UNIQUE INDEX "MissionPilotAssignment_missionId_pilotId_key" ON "MissionPilotAssignment"("missionId", "pilotId");
CREATE INDEX "MissionPilotAssignment_organisationId_pilotId_idx" ON "MissionPilotAssignment"("organisationId", "pilotId");

CREATE UNIQUE INDEX "IncidentDroneLink_incidentId_droneId_key" ON "IncidentDroneLink"("incidentId", "droneId");
CREATE INDEX "IncidentDroneLink_organisationId_droneId_idx" ON "IncidentDroneLink"("organisationId", "droneId");

CREATE UNIQUE INDEX "IncidentAssigneeLink_incidentId_userId_key" ON "IncidentAssigneeLink"("incidentId", "userId");
CREATE INDEX "IncidentAssigneeLink_organisationId_userId_idx" ON "IncidentAssigneeLink"("organisationId", "userId");

ALTER TABLE "MissionDroneAssignment" ADD CONSTRAINT "MissionDroneAssignment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionDroneAssignment" ADD CONSTRAINT "MissionDroneAssignment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionDroneAssignment" ADD CONSTRAINT "MissionDroneAssignment_droneId_fkey" FOREIGN KEY ("droneId") REFERENCES "Drone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MissionPilotAssignment" ADD CONSTRAINT "MissionPilotAssignment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionPilotAssignment" ADD CONSTRAINT "MissionPilotAssignment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionPilotAssignment" ADD CONSTRAINT "MissionPilotAssignment_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IncidentDroneLink" ADD CONSTRAINT "IncidentDroneLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentDroneLink" ADD CONSTRAINT "IncidentDroneLink_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentDroneLink" ADD CONSTRAINT "IncidentDroneLink_droneId_fkey" FOREIGN KEY ("droneId") REFERENCES "Drone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IncidentAssigneeLink" ADD CONSTRAINT "IncidentAssigneeLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentAssigneeLink" ADD CONSTRAINT "IncidentAssigneeLink_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentAssigneeLink" ADD CONSTRAINT "IncidentAssigneeLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "MissionDroneAssignment" ("id", "organisationId", "missionId", "droneId", "isPrimary", "createdAt")
SELECT 'mda_' || md5("id" || "droneId"), "organisationId", "id", "droneId", true, "createdAt"
FROM "Mission"
WHERE "droneId" IS NOT NULL
ON CONFLICT ("missionId", "droneId") DO NOTHING;

INSERT INTO "MissionPilotAssignment" ("id", "organisationId", "missionId", "pilotId", "isPrimary", "createdAt")
SELECT 'mpa_' || md5("id" || "pilotId"), "organisationId", "id", "pilotId", true, "createdAt"
FROM "Mission"
WHERE "pilotId" IS NOT NULL
ON CONFLICT ("missionId", "pilotId") DO NOTHING;

INSERT INTO "IncidentDroneLink" ("id", "organisationId", "incidentId", "droneId", "isPrimary", "createdAt")
SELECT 'idl_' || md5("id" || "droneId"), "organisationId", "id", "droneId", true, "createdAt"
FROM "Incident"
WHERE "droneId" IS NOT NULL
ON CONFLICT ("incidentId", "droneId") DO NOTHING;

INSERT INTO "IncidentAssigneeLink" ("id", "organisationId", "incidentId", "userId", "isPrimary", "createdAt")
SELECT 'ial_' || md5("id" || "assignedToId"), "organisationId", "id", "assignedToId", true, "createdAt"
FROM "Incident"
WHERE "assignedToId" IS NOT NULL
ON CONFLICT ("incidentId", "userId") DO NOTHING;

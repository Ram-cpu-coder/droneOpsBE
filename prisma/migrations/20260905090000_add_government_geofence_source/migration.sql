CREATE TYPE "GeofenceSource" AS ENUM ('MANUAL', 'GOVERNMENT');

ALTER TABLE "Geofence"
ADD COLUMN "source" "GeofenceSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "provider" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "validFrom" TIMESTAMP(3),
ADD COLUMN "validTo" TIMESTAMP(3),
ADD COLUMN "metadata" JSONB;

CREATE INDEX "Geofence_organisationId_source_isActive_idx" ON "Geofence"("organisationId", "source", "isActive");

CREATE UNIQUE INDEX "Geofence_organisationId_source_provider_externalId_key"
ON "Geofence"("organisationId", "source", "provider", "externalId");

CREATE TYPE "TelemetryProvider" AS ENUM ('NONE', 'GENERIC_REST', 'DJI', 'AUTEL', 'MAVLINK');

CREATE TYPE "ConnectorStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED', 'ONLINE', 'DEGRADED', 'OFFLINE');

ALTER TABLE "Drone"
ADD COLUMN "telemetryProvider" "TelemetryProvider" NOT NULL DEFAULT 'NONE',
ADD COLUMN "externalDeviceId" TEXT,
ADD COLUMN "connectorConfig" JSONB,
ADD COLUMN "connectorStatus" "ConnectorStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
ADD COLUMN "lastTelemetryAt" TIMESTAMP(3);

CREATE INDEX "Drone_organisationId_telemetryProvider_connectorStatus_idx"
ON "Drone"("organisationId", "telemetryProvider", "connectorStatus");

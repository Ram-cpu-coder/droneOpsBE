CREATE INDEX "TelemetryLog_organisationId_droneId_timestamp_idx"
ON "TelemetryLog"("organisationId", "droneId", "timestamp");

CREATE INDEX "TelemetryLog_organisationId_missionId_timestamp_idx"
ON "TelemetryLog"("organisationId", "missionId", "timestamp");

CREATE INDEX "AuditLog_organisationId_entityType_createdAt_idx"
ON "AuditLog"("organisationId", "entityType", "createdAt");

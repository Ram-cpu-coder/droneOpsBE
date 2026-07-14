CREATE INDEX IF NOT EXISTS "AuditLog_organisationId_createdAt_idx"
ON "AuditLog"("organisationId", "createdAt");

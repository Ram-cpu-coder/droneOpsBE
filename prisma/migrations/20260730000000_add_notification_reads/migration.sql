CREATE TABLE "NotificationRead" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auditLogId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationRead_userId_auditLogId_key" ON "NotificationRead"("userId", "auditLogId");
CREATE INDEX "NotificationRead_organisationId_userId_readAt_idx" ON "NotificationRead"("organisationId", "userId", "readAt");
CREATE INDEX "NotificationRead_auditLogId_idx" ON "NotificationRead"("auditLogId");

ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_auditLogId_fkey" FOREIGN KEY ("auditLogId") REFERENCES "AuditLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

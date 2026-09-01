ALTER TABLE "Mission"
ADD COLUMN "synctegralMissionId" TEXT,
ADD COLUMN "synctegralSyncStatus" TEXT,
ADD COLUMN "synctegralSyncError" TEXT,
ADD COLUMN "synctegralSyncedAt" TIMESTAMP(3);

CREATE INDEX "Mission_organisationId_synctegralMissionId_idx" ON "Mission"("organisationId", "synctegralMissionId");

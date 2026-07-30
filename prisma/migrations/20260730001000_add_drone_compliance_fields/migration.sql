ALTER TABLE "Drone"
ADD COLUMN "lastMaintenanceDate" TIMESTAMP(3),
ADD COLUMN "certificationReference" TEXT,
ADD COLUMN "certificationExpiry" TIMESTAMP(3),
ADD COLUMN "remoteId" TEXT,
ADD COLUMN "inspectionThresholdHours" INTEGER;

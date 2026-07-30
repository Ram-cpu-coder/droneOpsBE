-- CreateTable
CREATE TABLE "DroneModelCatalog" (
    "id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "batteryType" TEXT NOT NULL,
    "telemetryProvider" "TelemetryProvider" NOT NULL DEFAULT 'NONE',
    "category" TEXT,
    "sourceUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DroneModelCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DroneModelCatalog_manufacturer_isActive_idx" ON "DroneModelCatalog"("manufacturer", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DroneModelCatalog_manufacturer_model_key" ON "DroneModelCatalog"("manufacturer", "model");

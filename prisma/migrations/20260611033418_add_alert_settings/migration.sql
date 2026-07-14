-- CreateTable
CREATE TABLE "AlertSettings" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "minimumLandingBattery" INTEGER NOT NULL DEFAULT 20,
    "maximumWindSpeed" INTEGER NOT NULL DEFAULT 34,
    "lowSignalWarning" INTEGER NOT NULL DEFAULT 70,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertSettings_organisationId_key" ON "AlertSettings"("organisationId");

-- AddForeignKey
ALTER TABLE "AlertSettings" ADD CONSTRAINT "AlertSettings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('REVIEW', 'READY');

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "status" "ReportStatus" NOT NULL DEFAULT 'REVIEW';

-- CreateIndex
CREATE INDEX "Report_organisationId_status_idx" ON "Report"("organisationId", "status");

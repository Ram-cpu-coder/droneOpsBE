ALTER TABLE "Mission" ADD COLUMN "createdById" TEXT;

CREATE INDEX "Mission_createdById_idx" ON "Mission"("createdById");

ALTER TABLE "Mission" ADD CONSTRAINT "Mission_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

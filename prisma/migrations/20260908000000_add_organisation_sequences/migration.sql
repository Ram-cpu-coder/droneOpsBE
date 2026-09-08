-- CreateTable
CREATE TABLE "OrganisationSequence" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganisationSequence_organisationId_idx" ON "OrganisationSequence"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationSequence_organisationId_scope_key" ON "OrganisationSequence"("organisationId", "scope");

-- AddForeignKey
ALTER TABLE "OrganisationSequence" ADD CONSTRAINT "OrganisationSequence_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

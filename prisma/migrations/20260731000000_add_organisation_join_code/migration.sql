-- Add organisation join codes used to protect workspace self-join during signup.
ALTER TABLE "Organisation" ADD COLUMN "joinCode" TEXT;

CREATE UNIQUE INDEX "Organisation_joinCode_key" ON "Organisation"("joinCode");

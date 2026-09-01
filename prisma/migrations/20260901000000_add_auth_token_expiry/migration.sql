ALTER TABLE "User" ADD COLUMN "verificationTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailChangeTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "resetTokenExpiresAt" TIMESTAMP(3);

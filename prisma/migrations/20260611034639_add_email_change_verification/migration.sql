-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailChangeToken" TEXT,
ADD COLUMN     "pendingEmail" TEXT;

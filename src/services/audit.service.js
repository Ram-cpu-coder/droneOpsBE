import { prisma } from "../config/prisma.js";
import { publishActivity } from "../sockets/index.js";

export const writeAudit = async ({ organisationId, actorId, action, entityType, entityId, metadata }) => {
  const auditLog = await prisma.auditLog.create({
    data: {
      organisationId,
      actorId,
      action,
      entityType,
      entityId,
      metadata
    }
  });

  publishActivity({
    id: auditLog.id,
    organisationId: auditLog.organisationId,
    actorId: auditLog.actorId,
    action: auditLog.action,
    entityType: auditLog.entityType,
    entityId: auditLog.entityId,
    createdAt: auditLog.createdAt
  });

  return auditLog;
};

export const listAuditLogs = async (organisationId, filters = {}) => {
  return prisma.auditLog.findMany({
    where: {
      organisationId,
      entityType: filters.entityType,
      entityId: filters.entityId,
      actorId: filters.actorId
    },
    include: {
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(filters.limit ?? 100), 500)
  });
};

import { prisma } from "../config/prisma.js";
import { hasPermission } from "../constants/roles.js";

const notificationPermissions = {
  DRONE: ["drones:read"],
  MISSION: ["missions:read", "missions:assigned"],
  INCIDENT: ["incidents:read", "incidents:create"],
  REPORT: ["reports:read"],
  DOCUMENT: ["documents:read"],
  USER: ["users:read", "*"]
};

const getReadableEntityTypes = (role) => {
  if (hasPermission(role, "*")) return Object.keys(notificationPermissions);

  return Object.entries(notificationPermissions)
    .filter(([, permissions]) => permissions.some((permission) => hasPermission(role, permission)))
    .map(([entityType]) => entityType);
};

const getVisibleAuditWhere = (user, filters = {}) => {
  const entityTypes = getReadableEntityTypes(user.role);
  const entityType = filters.entityType
    ? entityTypes.includes(filters.entityType)
      ? filters.entityType
      : "__NONE__"
    : entityTypes.length
      ? { in: entityTypes }
      : "__NONE__";

  return {
    organisationId: user.organisationId,
    entityType,
    entityId: filters.entityId,
    NOT: {
      actorId: user.id,
      entityType: "USER"
    }
  };
};

export const listNotifications = async (user, filters = {}) => {
  const where = getVisibleAuditWhere(user, filters);
  const limit = Math.min(Number(filters.limit ?? 30), 100);

  const logs = await prisma.auditLog.findMany({
    where,
    include: {
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      },
      notificationReads: {
        where: { userId: user.id },
        select: { readAt: true }
      }
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  const unreadCount = await prisma.auditLog.count({
    where: {
      ...where,
      notificationReads: {
        none: { userId: user.id }
      }
    }
  });

  return {
    items: logs.map(({ notificationReads, ...log }) => {
      const readAt = notificationReads[0]?.readAt ?? null;
      return {
        ...log,
        isRead: Boolean(readAt),
        readAt
      };
    }),
    unreadCount
  };
};

export const markNotificationsRead = async (user, auditLogIds = []) => {
  const uniqueIds = Array.from(new Set(auditLogIds.filter(Boolean)));
  if (!uniqueIds.length) return listNotifications(user);

  const visibleLogs = await prisma.auditLog.findMany({
    where: {
      ...getVisibleAuditWhere(user),
      id: { in: uniqueIds }
    },
    select: { id: true }
  });
  if (!visibleLogs.length) return listNotifications(user);

  await prisma.notificationRead.createMany({
    data: visibleLogs.map((log) => ({
      organisationId: user.organisationId,
      userId: user.id,
      auditLogId: log.id
    })),
    skipDuplicates: true
  });

  return listNotifications(user);
};

export const markAllNotificationsRead = async (user) => {
  const unreadLogs = await prisma.auditLog.findMany({
    where: {
      ...getVisibleAuditWhere(user),
      notificationReads: {
        none: { userId: user.id }
      }
    },
    select: { id: true },
    take: 500
  });
  if (!unreadLogs.length) return listNotifications(user);

  await prisma.notificationRead.createMany({
    data: unreadLogs.map((log) => ({
      organisationId: user.organisationId,
      userId: user.id,
      auditLogId: log.id
    })),
    skipDuplicates: true
  });

  return listNotifications(user);
};

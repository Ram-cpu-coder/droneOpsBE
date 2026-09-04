export const permissions = {
  OPERATIONS_MANAGER: [
    "pilots:read", "pilots:manage", "maintenance:read",
    "missions:manage",
    "drones:manage",
    "drones:read",
    "telemetry:read",
    "geofences:read",
    "incidents:read",
    "reports:read",
    "documents:read",
    "audit:read"
  ],
  REMOTE_PILOT: [
    "pilots:read",
    "missions:read",
    "missions:assigned",
    "drones:read",
    "flight_logs:manage",
    "risk:complete",
    "telemetry:read",
    "geofences:read",
    "incidents:create",
    "documents:read",
    "audit:read"
  ],
  MAINTENANCE_COORDINATOR: [
    "maintenance:read",
    "maintenance:manage",
    "drones:read",
    "defects:manage",
    "documents:read",
    "reports:read",
    "audit:read"
  ],
  SAFETY_OFFICER: [
    "incidents:manage",
    "incidents:read",
    "geofences:manage",
    "geofences:read",
    "risk:manage",
    "telemetry:read",
    "documents:read",
    "reports:read",
    "audit:read"
  ],
  COMPLIANCE_OFFICER: [
    "documents:manage",
    "documents:read",
    "reports:manage",
    "reports:read",
    "audit:read"
  ],
  SYSTEM_ADMINISTRATOR: ["*"]
};

export const hasPermission = (role, permission) => {
  const rolePermissions = permissions[role] ?? [];
  if (rolePermissions.includes("*") || rolePermissions.includes(permission)) {
    return true;
  }

  const [resource, action] = permission.split(":");
  return action === "read" && rolePermissions.includes(`${resource}:manage`);
};

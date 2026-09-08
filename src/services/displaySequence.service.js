import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";

export const nextDisplayCode = async ({
  organisationId,
  scope,
  prefix,
  width,
  getExistingCodes,
  exists
}) => {
  const [existingCodes, auditCodes] = await Promise.all([
    getExistingCodes(),
    getAuditReservedCodes(organisationId, prefix)
  ]);
  const reservedCodes = new Set([...existingCodes, ...auditCodes].map((code) => String(code ?? "")));
  const seedValue = getNextSeed([...reservedCodes], prefix);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await nextOrganisationSequenceValue({ organisationId, scope, seedValue });
    const candidate = `${prefix}-${String(value).padStart(width, "0")}`;
    if (!reservedCodes.has(candidate) && !(await exists(candidate))) return candidate;
  }

  throw new Error(`Unable to allocate a unique ${prefix} display code`);
};

const nextOrganisationSequenceValue = async ({ organisationId, scope, seedValue }) => {
  const initialNextValue = Math.max(1, Number(seedValue) || 1) + 1;
  const rows = await prisma.$queryRaw`
    INSERT INTO "OrganisationSequence" ("id", "organisationId", "scope", "nextValue", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${organisationId}, ${scope}, ${initialNextValue}, NOW(), NOW())
    ON CONFLICT ("organisationId", "scope")
    DO UPDATE SET "nextValue" = GREATEST("OrganisationSequence"."nextValue" + 1, ${initialNextValue}), "updatedAt" = NOW()
    RETURNING "nextValue" - 1 AS "value"
  `;

  return Number(rows?.[0]?.value ?? seedValue);
};

const getNextSeed = (codes, prefix) => {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const maxValue = codes.reduce((max, code) => {
    const match = pattern.exec(String(code ?? ""));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return maxValue + 1;
};

const auditCodeFieldsByPrefix = {
  DRN: { entityType: "DRONE", metadataField: "droneCode" },
  MIS: { entityType: "MISSION", metadataField: "missionCode" },
  INC: { entityType: "INCIDENT", metadataField: "incidentCode" }
};

const getAuditReservedCodes = async (organisationId, prefix) => {
  const config = auditCodeFieldsByPrefix[prefix];
  if (!config) return [];

  const logs = await prisma.auditLog.findMany({
    where: {
      organisationId,
      entityType: config.entityType
    },
    select: { metadata: true }
  });

  return logs
    .map((log) => log.metadata?.[config.metadataField])
    .filter(Boolean);
};

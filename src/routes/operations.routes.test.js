import assert from "node:assert/strict";
import test from "node:test";
import { operationsRouter } from "./operations.routes.js";
import { create as createGeofence } from "../controllers/geofence.controller.js";
import { prisma } from "../config/prisma.js";

const user = { id: "11111111-1111-4111-8111-111111111111", organisationId: "22222222-2222-4222-8222-222222222222" };
const droneId = "33333333-3333-4333-8333-333333333333";
const handler = (path, method) => operationsRouter.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const invoke = async (fn, body, params = {}) => {
  let error;
  let payload;
  const res = { status() { return this; }, json(value) { payload = value; return this; } };
  await fn({ user, body, params }, res, value => { error = value; });
  return { error, payload };
};

test("geofence rejects untrusted organisation overrides and degenerate boundaries", async () => {
  const base = { name: "Test zone", type: "WARNING", polygon: [[151,-33],[152,-33],[151,-34]] };
  assert.ok((await invoke(createGeofence, { ...base, organisationId: user.organisationId })).error);
  const invalid = await invoke(createGeofence, { ...base, polygon: [[151,-33],[151,-33],[151,-33]] });
  assert.equal(invalid.error.code, "INVALID_BOUNDARY");
});

test("maintenance blocks work during a flight and requires completion evidence", async () => {
  const original = prisma.$transaction;
  let status = "IN_MISSION";
  prisma.$transaction = async fn => fn({ drone: { findFirst: async () => ({ id: droneId, status }) } });
  try {
    const body = { droneId, type: "Inspection", triggerType: "CALENDAR", status: "IN_PROGRESS" };
    assert.equal((await invoke(handler("/maintenance", "post"), body)).error.code, "DRONE_IN_MISSION");
    status = "MAINTENANCE";
    assert.equal((await invoke(handler("/maintenance", "post"), { ...body, status: "COMPLETED" })).error.code, "WORK_REQUIRED");
  } finally { prisma.$transaction = original; }
});

test("pilot listing is organisation scoped and excludes secrets", async () => {
  const original = prisma.user.findMany;
  prisma.user.findMany = async args => {
    assert.equal(args.where.organisationId, user.organisationId);
    assert.equal(args.where.role, "REMOTE_PILOT");
    assert.equal(args.select.passwordHash, undefined);
    return [];
  };
  try { assert.equal((await invoke(handler("/pilots", "get"))).error, undefined); }
  finally { prisma.user.findMany = original; }
});

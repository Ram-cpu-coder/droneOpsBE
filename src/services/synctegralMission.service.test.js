import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../config/env.js";
import { prisma, disconnectPrisma } from "../config/prisma.js";
import { syncMissionToSynctegral } from "./synctegralMission.service.js";

test("mission references use stable display codes and preserve existing links", async () => {
  const originalFetch = globalThis.fetch;
  const originalFind = prisma.mission.findFirst;
  const originalUpdate = prisma.mission.update;
  const originalEnabled = env.synctegralMissionApiEnabled;
  const originalKey = env.synctegralCustomerKey;
  let mission;
  const requests = [];
  let respond;
  const fixture = (id, remoteId = null, missionCode = "MIS-0023") => ({
    id, organisationId: "test-org", missionCode, name: "Test mission",
    status: "APPROVED", synctegralMissionId: remoteId, droneAssignments: [], pilotAssignments: []
  });
  try {
    env.synctegralMissionApiEnabled = true;
    env.synctegralCustomerKey = "test-only";
    prisma.mission.findFirst = async () => mission;
    prisma.mission.update = async ({ data }) => (mission = { ...mission, ...data });
    globalThis.fetch = async (url, options) => {
      requests.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
      return respond(options);
    };
    respond = () => new Response(JSON.stringify({ mission_id: "remote-test" }), { status: 201 });
    mission = fixture("uuid-first");
    await syncMissionToSynctegral("test-org", mission.id);
    mission = fixture("uuid-second", null, "MIS-0024");
    await syncMissionToSynctegral("test-org", mission.id);
    assert.deepEqual(requests.map((request) => request.body.external_reference), ["MIS-0023", "MIS-0024"]);

    requests.length = 0;
    mission = fixture("uuid-legacy", "existing-remote");
    await syncMissionToSynctegral("test-org", mission.id);
    assert.equal(requests[0].method, "PATCH");
    assert.equal(Object.hasOwn(requests[0].body, "external_reference"), false);

    requests.length = 0;
    mission = fixture("uuid-new", null, "MIS-0025");
    respond = ({ method }) => method === "POST"
      ? new Response(JSON.stringify({ detail: "A mission with this external_reference already exists: old-remote" }), { status: 409 })
      : new Response(JSON.stringify({ external_reference: "MIS-9999" }), { status: 200 });
    const rejected = await syncMissionToSynctegral("test-org", mission.id);
    assert.equal(rejected.failed, true);
    assert.equal(mission.synctegralMissionId, null);
    assert.equal(requests.some((request) => request.method === "PATCH"), false);

    requests.length = 0;
    mission = fixture("uuid-retry", null, "MIS-0026");
    respond = ({ method }) => method === "POST"
      ? new Response(JSON.stringify({ detail: "A mission with this external_reference already exists: same-remote" }), { status: 409 })
      : new Response(JSON.stringify({ external_reference: "MIS-0026", mission_id: "same-remote" }), { status: 200 });
    const recovered = await syncMissionToSynctegral("test-org", mission.id);
    assert.equal(recovered.synced, true);
    assert.equal(mission.synctegralMissionId, "same-remote");
    assert.equal(requests.at(-1).method, "PATCH");
  } finally {
    globalThis.fetch = originalFetch;
    prisma.mission.findFirst = originalFind;
    prisma.mission.update = originalUpdate;
    env.synctegralMissionApiEnabled = originalEnabled;
    env.synctegralCustomerKey = originalKey;
    await disconnectPrisma();
  }
});

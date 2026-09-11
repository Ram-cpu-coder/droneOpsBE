import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../utils/AppError.js";
import { chatWithAssistant } from "./ai.service.js";

const user = {
  id: "user-1",
  organisationId: "org-1",
  name: "Ram Kumar Dhimal",
  role: "SYSTEM_ADMINISTRATOR"
};

const providerFromMessages = (messages) => ({
  name: "mock",
  model: "mock-model",
  calls: 0,
  async chat() {
    const message = messages[this.calls];
    this.calls += 1;
    if (message instanceof Error) throw message;
    return {
      provider: "mock",
      model: "mock-model",
      message,
      latencyMs: 1
    };
  }
});

test("executes read tools and returns final provider answer", async () => {
  const provider = providerFromMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "tool-1",
          type: "function",
          function: {
            name: "getDroneStatus",
            arguments: JSON.stringify({ droneIdentifier: "DRN-001" })
          }
        }
      ]
    },
    {
      role: "assistant",
      content: "DRN-001 is AVAILABLE."
    }
  ]);
  const toolCalls = [];
  const result = await chatWithAssistant({
    user,
    message: "What is the status of DRN-001?",
    provider,
    toolExecutor: async (call) => {
      toolCalls.push(call);
      return { drone: { droneCode: "DRN-001", status: "AVAILABLE" } };
    }
  });

  assert.equal(result.reply, "DRN-001 is AVAILABLE.");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].dryRun, false);
});

test("requires confirmation before write tools execute", async () => {
  const provider = providerFromMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "tool-1",
          type: "function",
          function: {
            name: "createMission",
            arguments: JSON.stringify({
              missionName: "Inspection",
              missionType: "Inspection",
              droneIdentifier: "DRN-001",
              pilotIdentifier: "Ram",
              scheduledAt: "2026-09-12T00:00:00.000Z",
              durationMinutes: 60,
              location: "Sector 4"
            })
          }
        }
      ]
    }
  ]);
  const toolCalls = [];
  const result = await chatWithAssistant({
    user,
    message: "Create a mission.",
    provider,
    toolExecutor: async (call) => {
      toolCalls.push(call);
      return {
        confirmation: {
          summary: {
            missionName: "Inspection",
            drone: "DRN-001",
            pilot: "Ram",
            location: "Sector 4"
          }
        }
      };
    }
  });

  assert.equal(result.pendingAction.toolName, "createMission");
  assert.match(result.reply, /Please confirm/i);
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].dryRun, true);
});

test("confirmed write tools execute", async () => {
  const result = await chatWithAssistant({
    user,
    message: "Confirmed",
    confirmation: {
      toolName: "assignMission",
      arguments: {
        missionIdentifier: "MIS-0001",
        pilotIdentifier: "Ram"
      }
    },
    provider: providerFromMessages([]),
    toolExecutor: async (call) => {
      assert.equal(call.dryRun, false);
      return { mission: { missionCode: "MIS-0001" } };
    }
  });

  assert.match(result.reply, /MIS-0001 was assigned successfully/);
});

test("tool authorization failures are returned as app errors", async () => {
  const provider = providerFromMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "tool-1",
          type: "function",
          function: {
            name: "listMissions",
            arguments: "{}"
          }
        }
      ]
    }
  ]);

  await assert.rejects(
    () => chatWithAssistant({
      user,
      message: "Show missions",
      provider,
      toolExecutor: async () => {
        throw new AppError("Forbidden", 403, "FORBIDDEN");
      }
    }),
    /Forbidden/
  );
});

test("malformed tool arguments fail safely", async () => {
  const provider = providerFromMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "tool-1",
          type: "function",
          function: {
            name: "getDrone",
            arguments: "{bad-json"
          }
        }
      ]
    }
  ]);

  await assert.rejects(
    () => chatWithAssistant({
      user,
      message: "Find drone",
      provider,
      toolExecutor: async () => ({})
    }),
    /malformed tool arguments/i
  );
});

test("provider failures surface without real API calls", async () => {
  const provider = providerFromMessages([
    new AppError("AI provider is unavailable.", 502, "AI_PROVIDER_UNAVAILABLE")
  ]);

  await assert.rejects(
    () => chatWithAssistant({
      user,
      message: "Where is DRN-001?",
      provider,
      toolExecutor: async () => ({})
    }),
    /AI provider is unavailable/
  );
});

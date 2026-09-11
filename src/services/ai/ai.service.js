import { ZodError } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import { createAiProvider } from "./aiProvider.js";
import { aiToolDefinitions, executeAiTool as defaultExecuteAiTool, isReadOnlyAiTool } from "./aiTools.js";

const conversationState = new Map();
const MAX_TOOL_ROUNDS = 3;

export const chatWithAssistant = async ({ user, message, history = [], confirmation, provider, toolExecutor = defaultExecuteAiTool }) => {
  if (confirmation) {
    const result = await runConfirmedTool({ user, confirmation, toolExecutor });
    rememberToolResult(user.id, result);
    return {
      reply: formatConfirmedToolReply(confirmation.toolName, result),
      toolResults: [{ name: confirmation.toolName, result }],
      pendingAction: null,
      provider: provider?.name ?? env.aiProvider,
      model: provider?.model ?? env.aiModel
    };
  }

  const aiProvider = provider ?? createAiProvider();
  const messages = buildMessages({ user, history, message });
  const toolResults = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await aiProvider.chat({
      messages,
      tools: aiToolDefinitions,
      toolChoice: "auto"
    });

    const assistantMessage = response.message;
    const toolCalls = assistantMessage.tool_calls ?? [];

    if (!toolCalls.length) {
      return {
        reply: assistantMessage.content || "I could not produce a useful response.",
        toolResults,
        pendingAction: null,
        provider: response.provider,
        model: response.model
      };
    }

    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? "",
      tool_calls: toolCalls
    });

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name;
      const rawArguments = parseToolArguments(toolCall.function?.arguments);

      if (!isReadOnlyAiTool(toolName)) {
        const preview = await executeToolSafely({ toolName, rawArguments, user, dryRun: true, toolExecutor });
        return {
          reply: formatConfirmationPrompt(toolName, preview),
          toolResults,
          pendingAction: {
            toolName,
            arguments: rawArguments,
            summary: preview.confirmation?.summary ?? preview
          },
          provider: response.provider,
          model: response.model
        };
      }

      const result = await executeToolSafely({ toolName, rawArguments, user, dryRun: false, toolExecutor });
      toolResults.push({ name: toolName, result });
      rememberToolResult(user.id, result);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolName,
        content: JSON.stringify(result)
      });
    }
  }

  return {
    reply: "I checked the available tools, but the request needs a more specific follow-up.",
    toolResults,
    pendingAction: null,
    provider: aiProvider.name,
    model: aiProvider.model
  };
};

const runConfirmedTool = async ({ user, confirmation, toolExecutor }) => {
  if (isReadOnlyAiTool(confirmation.toolName)) {
    throw new AppError("This action does not require confirmation.", 400, "AI_CONFIRMATION_NOT_REQUIRED");
  }

  return executeToolSafely({
    toolName: confirmation.toolName,
    rawArguments: confirmation.arguments,
    user,
    dryRun: false,
    toolExecutor
  });
};

const executeToolSafely = async ({ toolName, rawArguments, user, dryRun, toolExecutor }) => {
  try {
    return await toolExecutor({ toolName, rawArguments, user, dryRun });
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError("The AI produced invalid tool parameters. Please rephrase with the missing details.", 400, "AI_TOOL_VALIDATION_FAILED", error.flatten());
    }
    throw error;
  }
};

const buildMessages = ({ user, history, message }) => {
  const state = conversationState.get(user.id);
  return [
    {
      role: "system",
      content: [
        "You are DroneOps Assistant inside a fleet operations system.",
        "Use tools for all factual answers about drones, missions, users, telemetry, and application data.",
        "Never invent DroneOps records. If a tool cannot find information, say it is unavailable.",
        "Write actions require backend confirmation. If required fields are missing, ask for the missing fields instead of guessing.",
        "When creating a mission, collect missionName, missionType, droneIdentifier, pilotIdentifier, scheduledAt as ISO 8601, durationMinutes, and location.",
        `Current server date/time: ${new Date().toISOString()}.`,
        `Current user: ${user.name} (${user.role}).`,
        state ? `Recent context: ${JSON.stringify(state).slice(0, 1200)}` : ""
      ].filter(Boolean).join("\n")
    },
    ...history.slice(-10).map((item) => ({
      role: item.role,
      content: item.content
    })),
    {
      role: "user",
      content: message
    }
  ];
};

const parseToolArguments = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError("AI returned malformed tool arguments.", 502, "AI_TOOL_ARGUMENTS_MALFORMED");
  }
};

const rememberToolResult = (userId, result) => {
  const next = {};
  if (result?.drone) next.lastDrone = result.drone;
  if (result?.location) next.lastLocation = result.location;
  if (result?.mission) next.lastMission = result.mission;
  if (result?.missions?.[0]) next.lastMission = result.missions[0];
  if (!Object.keys(next).length) return;

  conversationState.set(userId, {
    ...(conversationState.get(userId) ?? {}),
    ...next,
    updatedAt: new Date().toISOString()
  });
};

const formatConfirmationPrompt = (toolName, preview) => {
  const summary = preview.confirmation?.summary ?? preview;
  if (toolName === "createMission") {
    return `I can create this mission:\n${formatSummary(summary)}\n\nPlease confirm if you want me to create it.`;
  }
  if (toolName === "updateMission") {
    return `I can update this mission:\n${formatSummary(summary)}\n\nPlease confirm if you want me to save this change.`;
  }
  if (toolName === "assignMission") {
    return `I can assign this mission:\n${formatSummary(summary)}\n\nPlease confirm if you want me to save this assignment.`;
  }
  return `Please confirm this action:\n${formatSummary(summary)}`;
};

const formatSummary = (value) => (
  Object.entries(value ?? {})
    .map(([key, fieldValue]) => `${formatLabel(key)}: ${Array.isArray(fieldValue) ? fieldValue.join(", ") : fieldValue}`)
    .join("\n")
);

const formatLabel = (key) => key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());

const formatConfirmedToolReply = (toolName, result) => {
  if (toolName === "createMission") {
    return `Mission ${result.mission?.missionCode ?? result.mission?.id ?? ""} was created successfully.`;
  }
  if (toolName === "updateMission") {
    return `Mission ${result.mission?.missionCode ?? result.mission?.id ?? ""} was updated successfully.`;
  }
  if (toolName === "assignMission") {
    return `Mission ${result.mission?.missionCode ?? result.mission?.id ?? ""} was assigned successfully.`;
  }
  return "Action completed successfully.";
};

export const getAiProviderStatus = () => ({
  provider: env.aiProvider,
  model: env.aiModel,
  configured: Boolean(env.aiApiKey)
});

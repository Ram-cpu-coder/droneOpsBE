import { chatWithAssistant, getAiProviderStatus } from "../services/ai/ai.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/apiResponse.js";

export const chat = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const result = await chatWithAssistant({
    user: req.user,
    message: req.validated.body.message,
    history: req.validated.body.history ?? [],
    confirmation: req.validated.body.confirmation
  });

  console.log(`[ai] request user=${req.user.id} organisation=${req.user.organisationId} provider=${result.provider} model=${result.model} pending=${Boolean(result.pendingAction)} latencyMs=${Date.now() - startedAt}`);
  return ok(res, result, "AI assistant response ready");
});

export const status = asyncHandler(async (_req, res) => {
  return ok(res, getAiProviderStatus(), "AI assistant status");
});

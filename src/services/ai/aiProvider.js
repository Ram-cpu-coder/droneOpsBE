import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";

const providerDefaults = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b"
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/free"
  }
};

export const createAiProvider = (options = {}) => {
  const providerName = (options.provider ?? env.aiProvider ?? "groq").toLowerCase();
  const defaults = providerDefaults[providerName];
  if (!defaults) {
    throw new AppError(`Unsupported AI provider: ${providerName}`, 500, "AI_PROVIDER_UNSUPPORTED");
  }

  const apiKey = options.apiKey ?? env.aiApiKey;
  if (!apiKey) {
    throw new AppError("AI assistant is not configured. Add AI_API_KEY on the backend.", 503, "AI_NOT_CONFIGURED");
  }

  const baseUrl = (options.baseUrl ?? env.aiBaseUrl ?? defaults.baseUrl).replace(/\/+$/, "");
  const model = options.model ?? env.aiModel ?? defaults.model;

  return {
    name: providerName,
    model,
    async chat({ messages, tools, toolChoice = "auto" }) {
      const startedAt = Date.now();
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: buildHeaders({ providerName, apiKey }),
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: toolChoice,
          temperature: 0.2
        }),
        signal: AbortSignal.timeout(env.aiTimeoutMs)
      }).catch((error) => {
        if (error.name === "TimeoutError") {
          console.error(`[ai] provider=${providerName} model=${model} baseUrl=${baseUrl} error=timeout`);
          throw new AppError("AI provider timed out. Please try again.", 504, "AI_PROVIDER_TIMEOUT");
        }
        console.error(`[ai] provider=${providerName} model=${model} baseUrl=${baseUrl} error=${error.message}`);
        throw new AppError("AI provider connection failed. Check AI_BASE_URL, provider network access, and backend logs.", 502, "AI_PROVIDER_UNAVAILABLE", {
          provider: providerName,
          model,
          baseUrl
        });
      });

      const payload = await readProviderJson(response);
      if (!response.ok) {
        throw mapProviderError(response.status, payload, { providerName, model, baseUrl });
      }

      return {
        message: payload.choices?.[0]?.message ?? { role: "assistant", content: "" },
        provider: providerName,
        model: payload.model ?? model,
        latencyMs: Date.now() - startedAt
      };
    }
  };
};

const buildHeaders = ({ providerName, apiKey }) => {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };

  if (providerName === "openrouter") {
    headers["HTTP-Referer"] = env.clientPublicUrl;
    headers["X-Title"] = "DroneOps";
  }

  return headers;
};

const readProviderJson = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("AI provider returned an unreadable response.", 502, "AI_PROVIDER_MALFORMED_RESPONSE");
  }
};

const mapProviderError = (status, payload, context) => {
  const providerMessage = payload?.error?.message ?? payload?.message ?? "";
  console.error(`[ai] provider=${context.providerName} model=${context.model} baseUrl=${context.baseUrl} status=${status} code=${payload?.error?.code ?? payload?.code ?? ""} message=${providerMessage}`);
  if (status === 401 || status === 403) {
    return new AppError("AI provider rejected the API key or permissions.", 502, "AI_PROVIDER_AUTH_FAILED");
  }
  if (status === 429) {
    return new AppError("AI provider rate limit reached. Please wait and try again.", 429, "AI_PROVIDER_RATE_LIMIT");
  }
  if (status >= 500) {
    return new AppError("AI provider is temporarily unavailable.", 502, "AI_PROVIDER_UNAVAILABLE");
  }
  return new AppError(providerMessage || "AI provider request failed.", 502, "AI_PROVIDER_ERROR");
};

# DroneOps AI Assistant

## Architecture

The AI assistant runs server-side only.

Frontend:
- Opens a floating assistant panel inside the authenticated DroneOps layout.
- Sends messages to `POST /api/v1/ai/chat`.
- Never receives or stores the AI provider API key.

Backend:
- Authenticates the request with the same JWT middleware as other DroneOps APIs.
- Applies a dedicated AI rate limiter.
- Calls the configured AI provider through `src/services/ai/aiProvider.js`.
- Exposes only defined tools from `src/services/ai/aiTools.js`.
- Executes tools using the current user's organisation and permissions.
- Requires confirmation before write tools execute.

The AI is an interface to existing DroneOps business logic, not a privileged database user.

## Provider

Default provider: Groq

Default model: `openai/gpt-oss-20b`

Why:
- Groq currently provides a usable free tier for development/testing.
- Groq supports OpenAI-compatible chat completions and local tool/function calling.
- Free plan limits are enforced by requests/tokens per minute/day and can change by account/model.

Alternative provider:
- OpenRouter can be used by setting `AI_PROVIDER=openrouter` and a model such as `openrouter/free`.
- OpenRouter free models have low limits, commonly 50 requests/day unless account credits are added.

Always confirm current free-tier limits in the provider dashboard before relying on them for demos.

## Environment Variables

```env
AI_PROVIDER=groq
AI_API_KEY=
AI_MODEL=openai/gpt-oss-20b
AI_BASE_URL=
AI_TIMEOUT_MS=20000
```

`AI_BASE_URL` is optional. Leave it empty for the provider default.

For Groq, create an API key in Groq Console and set `AI_API_KEY` on the backend host.

## Tools

Read tools:
- `listDrones`
- `getDrone`
- `getDroneLocation`
- `getDroneStatus`
- `listMissions`
- `getMission`
- `listUsers`

Write tools:
- `createMission`
- `updateMission`
- `assignMission`

Write tools return a confirmation request first. They execute only after the frontend sends the selected pending action back as confirmation.

## Authorization

Every AI request uses `requireAuth`.

Each tool checks the logged-in user's role permissions before it reads or changes data:
- Drone tools require `drones:read` or `telemetry:read`.
- Mission reads require `missions:read`.
- Mission writes require `missions:manage`.
- User listing requires `users:read`.

Organisation boundaries come from `req.user.organisationId`.

## Example Prompts

- `Where is DRN-001?`
- `What is the current status of DRN-001?`
- `Show active missions.`
- `What missions are assigned to Ram?`
- `Create a mission for DRN-001 with Ram as pilot to inspect Sector 4 tomorrow at 10 AM for 60 minutes.`
- `Assign MIS-0004 to Ram.`

## Tests

Run AI tests without a real provider call:

```bash
npm run test:ai
```

The tests mock the provider and tool execution.

## Manual Verification

1. Add `AI_API_KEY` to the backend environment.
2. Start the backend.
3. Start the frontend.
4. Sign in as a verified user.
5. Open the AI assistant button above the alert button.
6. Ask `What drones are available?`.
7. Ask a write request such as `Assign MIS-DEMO-005 to Ram`.
8. Confirm that the assistant asks for confirmation before saving.
9. Confirm and verify the mission changed in the Missions page.

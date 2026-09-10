import dotenv from "dotenv";

dotenv.config();

["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].forEach((key) => {
  if (process.env[key] === "http://127.0.0.1:9") {
    delete process.env[key];
  }
});

const requiredInProduction = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
const explicitNodeEnv = process.env.NODE_ENV?.trim();
const hostedRuntime = Boolean(process.env.RENDER || process.env.K_SERVICE || process.env.FLY_APP_NAME || process.env.RAILWAY_ENVIRONMENT);
const nodeEnv = explicitNodeEnv || (hostedRuntime ? "production" : "development");
const configuredClientPublicUrl = process.env.CLIENT_PUBLIC_URL?.trim();
const defaultClientPublicUrl = nodeEnv === "production"
  ? "https://droneops-five.vercel.app"
  : "http://127.0.0.1:5173";
const clientPublicUrl = nodeEnv === "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(configuredClientPublicUrl ?? "")
  ? defaultClientPublicUrl
  : configuredClientPublicUrl || defaultClientPublicUrl;
const configuredMailFrom = process.env.MAIL_FROM?.trim();
const mailFrom = configuredMailFrom || (process.env.BREVO_SMTP_USER?.trim()
  ? `DroneOps <${process.env.BREVO_SMTP_USER.trim()}>`
  : "DroneOps <no-reply@droneops.local>");
const apiPrefix = process.env.API_PREFIX ?? "/api/v1";
const configuredApiPublicUrl = process.env.API_PUBLIC_URL?.trim();
const defaultApiPublicUrl = nodeEnv === "production" && process.env.RENDER_EXTERNAL_URL
  ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, "")}${apiPrefix}`
  : `http://localhost:${Number(process.env.PORT ?? 5000)}${apiPrefix}`;
const apiPublicUrl = configuredApiPublicUrl || defaultApiPublicUrl;

if (nodeEnv === "production") {
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
  }

  const weakSecrets = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"].filter((key) => process.env[key].length < 32);
  if (weakSecrets.length) {
    throw new Error(`Production secrets must be at least 32 characters: ${weakSecrets.join(", ")}`);
  }
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 5000),
  apiPrefix,
  clientOrigins: (process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5178,http://localhost:5178,https://droneops-five.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  clientPublicUrl,
  databaseUrl: process.env.DATABASE_URL,
  databaseSslRejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED
    ? process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"
    : nodeEnv === "production",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me",
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
  telemetryTimeoutSeconds: Number(process.env.TELEMETRY_TIMEOUT_SECONDS ?? 5),
  lowBatteryThreshold: Number(process.env.LOW_BATTERY_THRESHOLD ?? 20),
  telemetryDefaultIntervalSeconds: Number(process.env.TELEMETRY_DEFAULT_INTERVAL_SECONDS ?? 2),
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  brevoSmtpHost: process.env.BREVO_SMTP_HOST ?? "smtp-relay.brevo.com",
  brevoSmtpPort: Number(process.env.BREVO_SMTP_PORT ?? 587),
  brevoSmtpUser: process.env.BREVO_SMTP_USER,
  brevoSmtpPass: process.env.BREVO_SMTP_PASS,
  brevoApiKey: process.env.BREVO_API_KEY,
  mailFrom,
  apiPublicUrl,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
  connectorWorkerEnabled: process.env.CONNECTOR_WORKER_ENABLED === "true",
  connectorPollIntervalMs: Number(process.env.CONNECTOR_POLL_INTERVAL_MS ?? 5000),
  genericTelemetryApiKey: process.env.GENERIC_TELEMETRY_API_KEY,
  synctegralTelemetryEnabled: process.env.SYNCTEGRAL_TELEMETRY_ENABLED === "true",
  synctegralCustomerKey: process.env.DRONEOPS_CUSTOMER_KEY?.trim(),
  synctegralDroneId: process.env.SYNCTEGRAL_DRONE_ID ?? "SIM-001",
  synctegralApiBaseUrl: process.env.SYNCTEGRAL_API_BASE_URL ?? "https://synctegral-droneops-api.onrender.com",
  synctegralLatestUrl: process.env.SYNCTEGRAL_LATEST_URL ?? `${process.env.SYNCTEGRAL_API_BASE_URL ?? "https://synctegral-droneops-api.onrender.com"}/v1/drones/${process.env.SYNCTEGRAL_DRONE_ID ?? "SIM-001"}/latest`,
  synctegralTelemetryPollIntervalMs: Number(process.env.SYNCTEGRAL_TELEMETRY_POLL_INTERVAL_MS ?? 3000),
  synctegralStreamEnabled: process.env.SYNCTEGRAL_STREAM_ENABLED === "true",
  synctegralStreamUrl: process.env.SYNCTEGRAL_STREAM_URL ?? `${(process.env.SYNCTEGRAL_API_BASE_URL ?? "https://synctegral-droneops-api.onrender.com").replace(/^http/, "ws")}/v1/stream/${process.env.SYNCTEGRAL_DRONE_ID ?? "SIM-001"}`,
  synctegralMissionApiEnabled: process.env.SYNCTEGRAL_MISSION_API_ENABLED === "true",
  synctegralMissionApiUrl: process.env.SYNCTEGRAL_MISSION_API_URL ?? `${process.env.SYNCTEGRAL_API_BASE_URL ?? "https://synctegral-droneops-api.onrender.com"}/v1/missions`,
  councilBoundaryLookupEnabled: process.env.COUNCIL_BOUNDARY_LOOKUP_ENABLED
    ? process.env.COUNCIL_BOUNDARY_LOOKUP_ENABLED === "true"
    : nodeEnv !== "production",
  councilBoundaryServiceUrl: process.env.COUNCIL_BOUNDARY_SERVICE_URL ?? "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Administrative_Boundaries_Theme_multiCRS/FeatureServer/8/query",
  governmentAirspaceEnabled: process.env.GOVERNMENT_AIRSPACE_ENABLED === "true",
  governmentAirspaceProvider: process.env.GOVERNMENT_AIRSPACE_PROVIDER ?? "configured-provider",
  governmentAirspaceUrl: process.env.GOVERNMENT_AIRSPACE_URL,
  governmentAirspaceApiKey: process.env.GOVERNMENT_AIRSPACE_API_KEY,
  governmentAirspaceCacheMinutes: Number(process.env.GOVERNMENT_AIRSPACE_CACHE_MINUTES ?? 15),
  prismaQueryLogEnabled: process.env.PRISMA_QUERY_LOG === "true"
};

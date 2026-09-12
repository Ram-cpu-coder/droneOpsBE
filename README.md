# DroneOps Backend

DroneOps Backend is the API, database, authentication, telemetry, mission, maintenance, reporting, notification, and AI orchestration service for the DroneOps fleet management platform.

The service is built with Node.js, Express, Prisma, PostgreSQL, JWT authentication, HttpOnly refresh cookies, Socket.IO, Zod validation, and provider integrations for email, telemetry, cloud media, council boundary lookup, and AI assistance.

## Backend Responsibilities

- User authentication, signup, email verification, password reset, Google sign-in, and profile image upload.
- Role-based access control for administrators, pilots, operations users, maintenance users, and reporting users.
- Drone fleet registration, certification tracking, maintenance status, telemetry connector state, and mission assignment eligibility.
- Mission planning, route analysis, council/authority checks, operational geofence checks, risk assessment, approval workflow, mission start, mission completion, and replay support.
- Maintenance scheduling, completion, release workflow, last-service tracking, and maintenance-driven drone availability.
- Incident reporting, evidence upload, black-box telemetry capture, ownership assignment, and incident status workflow.
- Live telemetry ingestion, telemetry replay, Synctegral integration, connector polling, and Socket.IO live updates.
- Reports, dashboard summaries, audit logs, notification feed, alert thresholds, organisation settings, and join-code management.
- Backend AI assistant tools for reading operational data and preparing confirmed mission actions.

## Technology Stack

- Runtime: Node.js with ES modules
- API framework: Express
- Database ORM: Prisma
- Database: PostgreSQL
- Authentication: JWT access tokens and HttpOnly refresh cookies
- Validation: Zod
- Realtime: Socket.IO
- Email: Nodemailer with Brevo SMTP
- Media storage: Cloudinary, with local uploads available only outside production
- AI provider abstraction: Groq by default, OpenRouter-compatible fallback
- External data: NSW Spatial Services council boundary API and Synctegral telemetry APIs

## Folder Structure

```text
BE/
  prisma/                 Prisma schema, migrations, seed scripts
  src/
    config/               Environment and Prisma configuration
    constants/            Roles and permissions
    controllers/          Request handlers
    middleware/           Auth, validation, upload, rate limit, error handling
    routes/               API route definitions
    services/             Business logic and integrations
    sockets/              Socket.IO server setup
    templates/            Email templates
    utils/                Shared helpers and API responses
    validators/           Zod request schemas
    app.js                Express app factory
    server.js             HTTP server entrypoint
```

## Prerequisites

- Node.js 20 or later
- PostgreSQL database
- npm
- Prisma CLI through local npm scripts
- Brevo SMTP account for production email delivery
- Cloudinary account if production evidence/profile image uploads are required
- Optional: Groq/OpenRouter key for AI assistant
- Optional: Synctegral simulator/API credentials for telemetry integration

## Environment Setup

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Required for production:

```env
NODE_ENV=production
DATABASE_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
CLIENT_ORIGIN=https://droneops-five.vercel.app
CLIENT_PUBLIC_URL=https://droneops-five.vercel.app
API_PUBLIC_URL=https://your-backend-domain/api/v1
```

Production secrets must be strong. `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` should be at least 32 characters.

Email delivery:

```env
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=
BREVO_SMTP_PASS=
MAIL_FROM=DroneOps <verified-sender@example.com>
```

AI assistant:

```env
AI_PROVIDER=groq
AI_API_KEY=
AI_MODEL=openai/gpt-oss-20b
AI_BASE_URL=
AI_TIMEOUT_MS=20000
```

Council boundary lookup:

```env
COUNCIL_BOUNDARY_LOOKUP_ENABLED=true
```

If `COUNCIL_BOUNDARY_LOOKUP_ENABLED` is not set, local development enables lookup by default, while production disables it by default. For production route authority analysis, set it explicitly to `true`.

Cloudinary uploads:

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Synctegral telemetry:

```env
SYNCTEGRAL_TELEMETRY_ENABLED=
DRONEOPS_CUSTOMER_KEY=
SYNCTEGRAL_DRONE_ID=
SYNCTEGRAL_API_BASE_URL=
SYNCTEGRAL_LATEST_URL=
SYNCTEGRAL_TELEMETRY_POLL_INTERVAL_MS=
SYNCTEGRAL_STREAM_ENABLED=
SYNCTEGRAL_STREAM_URL=
SYNCTEGRAL_MISSION_API_ENABLED=
SYNCTEGRAL_MISSION_API_URL=
```

## Installation

```bash
npm install
npm run prisma:generate
```

## Database Setup

For local development:

```bash
npm run prisma:migrate
npm run seed
```

Optional mission seed data:

```bash
npm run seed:missions
```

For production deployment:

```bash
npm run prisma:deploy
```

The `prisma/migrations` folder contains the full schema evolution history. For a fresh deployment, run `npm run prisma:deploy` to apply all migrations in order.

## Running Locally

```bash
npm run dev
```

The API runs on:

```text
http://localhost:5000/api/v1
```

Health check:

```text
GET /health
```

## Available Scripts

```bash
npm run dev              Start the backend
npm run dev:nodemon      Start with nodemon
npm run start            Start production server
npm run prisma:generate  Generate Prisma client
npm run prisma:migrate   Run local migrations
npm run prisma:deploy    Deploy migrations in production
npm run prisma:studio    Open Prisma Studio
npm run seed             Seed base data
npm run seed:missions    Seed mission data
npm run test:ai          Run AI assistant service tests
npm run lint             Syntax check server entrypoint
```

## Core API Areas

All application routes are mounted under:

```text
/api/v1
```

Main route groups:

- `/auth`
- `/users`
- `/drones`
- `/missions`
- `/maintenance`
- `/incidents`
- `/telemetry`
- `/geofences`
- `/reports`
- `/documents`
- `/settings`
- `/audit`
- `/notifications`
- `/ai`

Most routes require authentication and role permissions. The backend should be treated as the source of truth for permissions and workflow validation.

## Mission Assignment Rules

A drone can be assigned to a planned mission when it is available, certified, not expired, not overdue for maintenance, and not already booked during the selected mission window.

Telemetry freshness is checked when a mission starts, not when a mission is planned. This allows an idle drone to be assigned to future work while still requiring live readiness before activation.

## Production Deployment Notes

The backend has been designed for Render-style deployment:

- Set all production environment variables in the hosting dashboard.
- Use `npm install` as the install command.
- Use `npm run prisma:deploy` during deployment or as a release step.
- Use `npm run start` as the start command.
- Confirm `/health` returns healthy after deployment.
- Confirm CORS allows the deployed frontend origin.
- Confirm `NODE_ENV=production` to avoid development-only behaviour.

## Operational Checks After Deployment

After each deployment, verify:

- `/health` returns healthy.
- User login and refresh-token flow work.
- Password reset email links point to the deployed frontend.
- Signup verification emails are delivered.
- Mission route analysis works with the intended council lookup configuration.
- Drone assignment follows certification, maintenance, booking, and start-readiness rules.
- Telemetry replay and live telemetry load as expected.
- Incident evidence upload works.
- Reports generate correctly.
- AI assistant status shows configured only when `AI_API_KEY` is present.

## Security Notes

- Do not commit `.env`.
- Use strong JWT secrets in production.
- Keep production stack traces disabled.
- Restrict frontend public keys such as Mapbox and Google OAuth by domain where applicable.
- Use HttpOnly refresh cookies and short-lived access tokens.
- Keep upload and evidence storage access policy aligned with client privacy requirements.
- Monitor rate limits for auth, telemetry, uploads, and AI requests.

## Handover Notes

The backend contains the business-critical logic for DroneOps. Any future changes to mission assignment, maintenance eligibility, telemetry readiness, council permission handling, or role permissions should be made in the backend first, then reflected in the frontend UI. This prevents the interface from showing actions that the server later rejects.

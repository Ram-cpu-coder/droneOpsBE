import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectPrisma } from "./config/prisma.js";
import { attachSocketServer } from "./sockets/index.js";

const app = createApp();
const server = http.createServer(app);

attachSocketServer(server);

server.listen(env.port, () => {
  console.log(`DroneOps API running on http://localhost:${env.port}${env.apiPrefix}`);
});

const shutdown = async (signal) => {
  console.log(`${signal} received. Closing DroneOps API...`);
  server.close(async () => {
    await disconnectPrisma();
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

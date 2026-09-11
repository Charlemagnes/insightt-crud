import "dotenv/config";

import { createApp } from "@/app";
import { createDatabase } from "@/db/client";
import { loadEnv } from "@/env";
import { createAuthMiddleware } from "@/middleware/auth";
import { consoleLogSink } from "@/middleware/logging";
import { createDrizzleTaskRepository } from "@/tasks/repository.drizzle";

/**
 * The composition root: the one file that reads the environment, builds the
 * real collaborators and starts listening. Everything it wires up is testable
 * without it, which is why it stays this short.
 */
const env = loadEnv();
const { db } = createDatabase(env.databaseUrl, env.databaseCaCertPath);

const app = createApp({
  taskRepository: createDrizzleTaskRepository(db),
  requireAuth: createAuthMiddleware(env),
  webOrigin: env.webOrigin,
});

app.listen(env.port, () => {
  consoleLogSink({
    ts: new Date().toISOString(),
    requestId: null,
    direction: "startup",
    message: `@insightt/api listening on http://localhost:${env.port}`,
    webOrigin: env.webOrigin,
  });
});

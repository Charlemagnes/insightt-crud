import "dotenv/config";

import { createApp } from "@/app";
import { createDatabase } from "@/db/client";
import { loadEnv } from "@/env";
import { createAuthMiddleware } from "@/middleware/auth";
import { consoleLogSink } from "@/middleware/logging";
import { createPrettyLogSink } from "@/middleware/logging.pretty";
import { createDrizzleTaskRepository } from "@/tasks/repository.drizzle";

/**
 * The composition root: the one file that reads the environment, builds the
 * real collaborators and starts listening. Everything it wires up is testable
 * without it, which is why it stays this short.
 */
const env = loadEnv();
const { db } = createDatabase(env.databaseUrl, env.databaseCaCertPath);

// Same records either way — the sink only decides how they reach the console.
const log = env.logFormat === "pretty" ? createPrettyLogSink() : consoleLogSink;

const app = createApp({
  taskRepository: createDrizzleTaskRepository(db),
  requireAuth: createAuthMiddleware(env),
  webOrigin: env.webOrigin,
  serveDocs: env.serveDocs,
  log,
});

app.listen(env.port, () => {
  log({
    ts: new Date().toISOString(),
    requestId: null,
    direction: "startup",
    message: `@insightt/api listening on http://localhost:${env.port}`,
    webOrigin: env.webOrigin,
  });
});

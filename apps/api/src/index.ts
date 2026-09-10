import "dotenv/config";

import { createApp } from "@/app";
import { loadEnv } from "@/env";
import { createAuthMiddleware } from "@/middleware/auth";
import { emptyTaskRepository } from "@/tasks/repository";

/**
 * The composition root: the one file that reads the environment, builds the
 * real collaborators and starts listening. Everything it wires up is testable
 * without it, which is why it stays this short.
 */
const env = loadEnv();

const app = createApp({
  taskRepository: emptyTaskRepository,
  requireAuth: createAuthMiddleware(env),
  webOrigin: env.webOrigin,
});

app.listen(env.port, () => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      direction: "startup",
      message: `@insightt/api listening on http://localhost:${env.port}`,
      webOrigin: env.webOrigin,
    }),
  );
});

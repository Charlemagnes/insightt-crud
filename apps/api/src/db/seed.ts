import "dotenv/config";

import { eq } from "drizzle-orm";

import { createDatabase } from "@/db/client";
import { tasks, type NewTaskRow } from "@/db/schema";
import { loadEnv } from "@/env";

/**
 * Places a handful of Tasks under one Owner, so the list is demoable before
 * there is an endpoint that can create one.
 *
 * Usage — the User ID is the Auth0 `sub` of whoever you sign in as, which the
 * API writes on the `actor` log line the first time you load the app:
 *
 * ```
 * npm run db:seed -- 'auth0|68c0…'
 * npm run db:seed -- 'auth0|68c0…' --replace   # clear that Owner's Tasks first
 * ```
 *
 * `--replace` deletes only the named Owner's rows. Seeding is a development
 * convenience and it is still someone's data; a blanket `delete from tasks`
 * would take out the other Owner you were using to check that scoping works.
 */
/**
 * `createdAt` is required here even though the column defaults, because the
 * point of the seed is a list with a visible newest-first order — five rows
 * inserted in the same millisecond would only prove the tiebreaker works.
 */
type SeedTask = Omit<NewTaskRow, "ownerId" | "createdAt" | "updatedAt"> & {
  createdAt: Date;
};

const SEED_TASKS: SeedTask[] = [
  {
    title: "Read the brief end to end",
    description: "Every requirement, before writing any of them down.",
    status: "ARCHIVED",
    version: 4,
    completedAt: daysAgo(5),
    createdAt: daysAgo(9),
  },
  {
    title: "Write the implementation plan",
    description: "Decisions and rationale, not a task list.",
    status: "DONE",
    version: 3,
    completedAt: daysAgo(3),
    createdAt: daysAgo(7),
  },
  {
    title: "Stand the API up against Postgres",
    description: "Owner-scoped reads, newest first, with a real total.",
    status: "IN_PROGRESS",
    version: 2,
    createdAt: daysAgo(2),
  },
  {
    title: "Wire the status transitions",
    description: null,
    status: "PENDING",
    createdAt: daysAgo(1),
  },
  {
    title: "Write the README",
    description: "Setup, the two evaluations, and the trade-offs taken.",
    status: "PENDING",
    createdAt: daysAgo(0),
  },
];

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function main(): Promise<void> {
  const [ownerId, ...flags] = process.argv.slice(2);

  if (!ownerId) {
    throw new Error(
      "Usage: npm run db:seed -- '<user id>' [--replace]\n" +
        "The User ID is the Auth0 `sub`, which the API logs on the `actor` line.",
    );
  }

  const env = loadEnv();
  const { db, pool } = createDatabase(env.databaseUrl);

  try {
    if (flags.includes("--replace")) {
      await db.delete(tasks).where(eq(tasks.ownerId, ownerId));
    }

    const inserted = await db
      .insert(tasks)
      .values(
        SEED_TASKS.map((task) => ({
          ...task,
          ownerId,
          // The trigger only fires on UPDATE, so a fresh insert would stamp
          // today onto a Task dated a week ago. Seeded rows say when they were
          // last touched.
          updatedAt: task.completedAt ?? task.createdAt,
        })),
      )
      .returning({ id: tasks.id });

    console.log(`Seeded ${inserted.length} tasks for ${ownerId}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

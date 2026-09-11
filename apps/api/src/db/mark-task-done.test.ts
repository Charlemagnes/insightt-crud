import { canTransition, TaskStatus } from "@insightt/shared";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MarkDoneOutcome } from "@/tasks/repository.drizzle";

/** The outcomes the repository will parse, which the SQL has to produce. */
const OUTCOMES = MarkDoneOutcome.options;

/**
 * The Transition rule into `DONE` is written twice on purpose (ADR-0002): once
 * as a shared predicate, which disables the button and is what the UI and the
 * API agree on, and once in the `WHERE` clause of `mark_task_done()`, which is
 * what actually enforces it under concurrency.
 *
 * Defence in depth only works while the two agree. This reads the migration
 * itself, so changing the rule in TypeScript and not in SQL — or the reverse —
 * fails a test rather than a demonstration.
 */
const MIGRATION = readFileSync(
  join(__dirname, "../../drizzle/0002_mark_task_done.sql"),
  "utf8",
);

/**
 * The migration with its own commentary removed. The comments explain the same
 * rules the SQL states, so a test that read them could pass on a file that had
 * been documented and never changed.
 */
const STATEMENTS = MIGRATION.replaceAll(/^\s*--.*$/gm, "");

/** The function declaration, with the trailing `COMMENT ON FUNCTION` left out. */
const BODY = STATEMENTS.split("COMMENT ON FUNCTION")[0];

/**
 * The conditional `UPDATE` alone, cut at the branch that reacts to it.
 *
 * Assertions about the guard have to be made against this and not the whole
 * body: the read that explains a zero-row result matches on the same id and
 * Owner, so a test that searched the body would stay green with the guard
 * deleted — which is the one change that would let any Actor complete any
 * Task.
 */
const GUARDED_UPDATE = BODY.split("IF FOUND THEN")[0];

describe("mark_task_done()", () => {
  describe("its guard", () => {
    it("names exactly the Status the shared machine lets into DONE", () => {
      const [permitted, ...others] = TaskStatus.options.filter((from) =>
        canTransition(from, "DONE"),
      );

      // One Status, or the machine is no longer linear and the single-statement
      // guard below could not express it.
      expect(others).toEqual([]);
      expect(guardedStatus()).toBe(permitted);
    });

    it("matches on the id and the Owner as well", () => {
      // Without either, the statement would mark a Task Done for whoever asked.
      expect(GUARDED_UPDATE).toContain("t.id = p_task_id");
      expect(GUARDED_UPDATE).toContain("t.owner_id = p_actor");
    });

    it("writes the completion time on the update that changes the Status", () => {
      // Set here and nowhere else, which is what keeps a Replay from
      // overwriting the original completion.
      expect(GUARDED_UPDATE).toMatch(/SET[\s\S]*completed_at\s*=\s*now\(\)/);
      expect(BODY.match(/completed_at\s*=\s*now\(\)/g)).toHaveLength(1);
    });
  });

  describe("its outcomes", () => {
    it("reports exactly the four the repository parses", () => {
      // Lowercase literals in the body are outcomes; the Statuses are upper.
      const reported = new Set(
        [...BODY.matchAll(/'([a-z_]+)'/g)].map(([, outcome]) => outcome),
      );

      expect([...reported].sort()).toEqual([...OUTCOMES].sort());
    });

    it("decides a Replay from a read inside the same transaction", () => {
      // Outside it, a Task that was PENDING at the update — correctly a
      // rejection — could be read back as DONE and reported as a Replay.
      const [update, explanation] = BODY.split("IF FOUND THEN");

      expect(update).toContain("UPDATE tasks");
      expect(explanation).toContain("SELECT * INTO found_task");
      expect(explanation).toContain("'replayed'");
    });
  });

  describe("how it is declared", () => {
    it("is not SECURITY DEFINER", () => {
      // With RLS off and the API on a role that owns `tasks`, the qualifier
      // would change nothing — it would be a phrase with nothing behind it.
      expect(STATEMENTS).not.toMatch(/SECURITY\s+DEFINER/i);
    });

    it("documents the four outcomes where the next person will look", () => {
      const comment = STATEMENTS.split("COMMENT ON FUNCTION")[1];

      expect(comment).toBeDefined();
      for (const outcome of OUTCOMES) {
        expect(comment).toContain(outcome);
      }
    });
  });
});

/**
 * The Status the conditional `UPDATE` requires a Task to already be in.
 *
 * Read off the guarded statement alone. Searched across the whole body, a
 * deleted guard would silently resolve to the `'DONE'` the Replay branch
 * compares against, and this would report the wrong rule rather than none.
 */
function guardedStatus(): string | undefined {
  return /WHERE[\s\S]*?t\.status\s*=\s*'([A-Z_]+)'/.exec(GUARDED_UPDATE)?.[1];
}

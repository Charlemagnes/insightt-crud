-- Hand-written: `drizzle-kit` diffs tables, not functions, so this one will
-- never appear in a generated migration and must not be folded into one.
--
-- This is the custom resolver the brief offers, and the only entrance to DONE
-- (ADR-0002). Marking Done has to be atomic *and* idempotent: two simultaneous
-- requests must produce one completion and two identical successes, and the
-- "why did nothing change?" question must be answered inside the same
-- transaction as the UPDATE. A function body is one transaction, which is what
-- makes both true here and not in application code.
--
-- The guard `status = 'IN_PROGRESS'` is the Transition rule written a second
-- time, in SQL, on purpose: the shared predicate in
-- `packages/shared/src/rules/transitions.ts` disables the button, and this
-- clause is what actually enforces it. `src/db/mark-task-done.test.ts` reads
-- this file and fails if the two spellings drift apart.

CREATE FUNCTION mark_task_done(p_task_id uuid, p_actor text)
RETURNS TABLE (
  outcome      text,
  id           uuid,
  owner_id     text,
  title        text,
  description  text,
  status       task_status,
  version      integer,
  created_at   timestamptz,
  updated_at   timestamptz,
  completed_at timestamptz
) AS $$
DECLARE
  found_task tasks%ROWTYPE;
BEGIN
  -- One conditional statement, so Postgres row locking serialises concurrent
  -- callers and no application-level lock is needed. `completed_at` is only
  -- ever written here, and only on the update that finds the Task still
  -- IN_PROGRESS -- which is why a Replay cannot overwrite it.
  UPDATE tasks AS t
     SET status       = 'DONE',
         completed_at = now(),
         version      = t.version + 1
   WHERE t.id = p_task_id
     AND t.owner_id = p_actor
     AND t.status = 'IN_PROGRESS'
  RETURNING t.* INTO found_task;

  IF FOUND THEN
    outcome := 'completed';
  ELSE
    -- Zero rows changed, and the answer has to say why. Reading the row here
    -- rather than in the API is the point of the function: the explanation is
    -- one statement later on one connection inside one transaction, instead
    -- of a second round trip whose window another request can walk through
    -- and turn a rejection into a Replay.
    --
    -- FOR UPDATE closes the rest of it that can be closed: a completion that
    -- is in flight right now is waited for and then seen, rather than raced
    -- past. What remains is a Task another request completed just before this
    -- statement, reported as a Replay -- which is true. It is DONE.
    SELECT * INTO found_task
      FROM tasks AS t
     WHERE t.id = p_task_id
       AND t.owner_id = p_actor
       FOR UPDATE;

    -- Missing and owned by someone else are deliberately the same answer, so
    -- the API can report both as 404 and leak no existence.
    IF NOT FOUND THEN
      outcome := 'not_found';
      RETURN NEXT;
      RETURN;
    END IF;

    outcome := CASE
      WHEN found_task.status = 'DONE' THEN 'replayed'
      ELSE 'wrong_status'
    END;
  END IF;

  id           := found_task.id;
  owner_id     := found_task.owner_id;
  title        := found_task.title;
  description  := found_task.description;
  status       := found_task.status;
  version      := found_task.version;
  created_at   := found_task.created_at;
  updated_at   := found_task.updated_at;
  completed_at := found_task.completed_at;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Deliberately not SECURITY DEFINER. With RLS off and the API connecting on a
-- role that already owns `tasks`, the qualifier would change no behaviour --
-- it would be a phrase with nothing behind it (PLAN.md §14).
COMMENT ON FUNCTION mark_task_done IS
  'Marks a Task DONE, atomically and idempotently. Returns one row whose outcome is: completed (the Task was IN_PROGRESS and is now DONE), replayed (it was already DONE; completed_at is untouched), wrong_status (it exists but cannot be marked Done from where it is), or not_found (no such Task, or it belongs to someone else -- the two are not distinguished). Every outcome but not_found carries the Task as it now stands.';

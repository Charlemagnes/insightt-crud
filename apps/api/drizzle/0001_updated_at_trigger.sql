-- Hand-written: `drizzle-kit` diffs tables, not triggers, so this one will
-- never appear in a generated migration and must not be folded into one.
--
-- Without it `updated_at` reads as the creation time forever, because nothing
-- in the application ever assigns it — and nothing should. Every later write
-- path (PATCH, the guarded transition updates, `mark_task_done()`) maintains
-- the column by doing nothing at all.

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
COMMENT ON FUNCTION set_updated_at IS
  'Trigger function: stamps updated_at on every UPDATE, so no application code has to remember to.';
--> statement-breakpoint
CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

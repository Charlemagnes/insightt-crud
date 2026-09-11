import type { FormInstance } from "antd";
import type { ZodError } from "zod";

/**
 * One rejected value: where it was, and what was wrong with it. Both Zod's
 * `ZodIssue` and the `details` the API puts in a `422` envelope are this shape,
 * which is what lets the same mapping serve a parse in the browser and a parse
 * on the server.
 */
export interface FieldIssue {
  path: PropertyKey[];
  message: string;
}

/**
 * The single adapter between a schema's issues and Ant Design's `Form`
 * (PLAN.md §11).
 *
 * `Form` does not speak Zod, and the alternative to this function is a
 * `validator` on every `Form.Item` — the same rules written a second time, in a
 * second place, for the browser only. Instead the form submits, the shared
 * schema parses, and whatever it rejects is attached here.
 *
 * It returns the issues it could not attach: a rule about the object as a
 * whole, or about a key the form has no input for, such as `strictObject`
 * refusing a stray field. Those have to be reported some other way, or a
 * rejected submit looks to the person like a submit that did nothing at all.
 *
 * Two details that are easy to get wrong, and both silent when they are:
 *
 * - Every field named in `fields` is cleared first. `setFields` touches only
 *   what it is given, so an error from the previous submit would otherwise
 *   outlive the mistake that caused it.
 * - Issues are grouped per field. A schema reports every failure and
 *   `setFields` takes one entry per field, so two issues on one input would see
 *   the second replace the first.
 */
export function attachIssues(
  form: FormInstance,
  issues: readonly FieldIssue[],
  fields: readonly string[],
): string[] {
  const byField = new Map<string, string[]>(
    fields.map((name) => [name, [] as string[]]),
  );
  const unattached: string[] = [];

  for (const issue of issues) {
    const [first] = issue.path;
    const errors = typeof first === "string" ? byField.get(first) : undefined;

    if (errors) {
      errors.push(issue.message);
    } else {
      unattached.push(issue.message);
    }
  }

  form.setFields([...byField].map(([name, errors]) => ({ name, errors })));

  return unattached;
}

/** `attachIssues` for a failed parse in the browser. */
export function attachZodErrors(
  form: FormInstance,
  error: ZodError,
  fields: readonly string[],
): string[] {
  return attachIssues(form, error.issues, fields);
}

/**
 * The issues inside a `422`'s `details`, when it carries any.
 *
 * The API validates independently of the browser, so the two can disagree —
 * on a rule only the server has, or on a schema that has drifted between the
 * workspaces. Without this the person would get a toast naming a field and no
 * mark on the field itself.
 *
 * `details` is `unknown` by contract, so it is narrowed rather than trusted.
 */
export function issuesIn(details: unknown): FieldIssue[] {
  if (!Array.isArray(details)) return [];

  return details.filter(
    (issue): issue is FieldIssue =>
      typeof issue === "object" &&
      issue !== null &&
      "message" in issue &&
      typeof issue.message === "string" &&
      "path" in issue &&
      Array.isArray(issue.path),
  );
}

/**
 * Blanks the errors on the named fields. Used as the person types: the schema
 * runs on submit, so nothing revalidates on a keystroke, and a corrected field
 * would otherwise keep showing the error that made them correct it.
 */
export function clearFieldErrors(
  form: FormInstance,
  fields: readonly string[],
): void {
  form.setFields(fields.map((name) => ({ name, errors: [] })));
}

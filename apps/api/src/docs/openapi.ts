import {
  CreateTaskInput,
  ErrorResponseSchema,
  TaskIdParam,
  TaskListQuery,
  TaskPageSchema,
  TaskSchema,
  UpdateTaskInput,
} from "@insightt/shared";
import { z } from "zod";

/**
 * The API described as OpenAPI 3.1, built from the very schemas that validate
 * requests (PLAN.md §16). Nothing here restates a field, a length cap or an
 * enum member: those are read off `@insightt/shared` through
 * `z.toJSONSchema()`, so a change to a schema reaches the document without
 * anyone remembering to make it.
 *
 * What Zod cannot know is written out below — which routes exist, which headers
 * they require, which of the frozen error codes each can answer with.
 * `openapi.test.ts` holds that half against the real Express router.
 */

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  security: Array<Record<string, string[]>>;
  paths: Record<string, Record<string, Operation>>;
  components: {
    securitySchemes: Record<string, Record<string, string>>;
    schemas: Record<string, JsonSchema>;
  };
}

export interface Operation {
  summary: string;
  description?: string;
  operationId: string;
  parameters?: Parameter[];
  requestBody?: {
    required: true;
    content: Record<string, { schema: JsonSchema }>;
  };
  responses: Record<string, ResponseObject>;
}

export interface Parameter {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

export interface ResponseObject {
  description: string;
  headers?: Record<string, { description: string; schema: JsonSchema }>;
  content?: Record<string, { schema: JsonSchema }>;
}

/** A JSON Schema fragment, as `z.toJSONSchema()` hands it back. */
export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  enum?: readonly unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  [keyword: string]: unknown;
}

/**
 * Response schemas, generated in `output` mode — the shape a client *receives*,
 * in which every key a parse produced is present and no other one is.
 */
const responseSchemas = z.registry<{ id: string }>();
responseSchemas.add(TaskSchema, { id: "Task" });
responseSchemas.add(TaskPageSchema, { id: "TaskPage" });
responseSchemas.add(ErrorResponseSchema, { id: "ErrorResponse" });

/**
 * Request-body schemas, generated in `input` mode: the shape a client may
 * *send*, before the trim and the blank-to-`null` transform have run. The
 * output shape would document values no client ever writes — and
 * `z.toJSONSchema()` refuses to render a transform at all.
 *
 * A registry rather than a schema at a time because one registry is what turns
 * a nested schema into a `$ref` instead of a second inlined copy: `TaskPage`
 * points at `Task` only because both are in the same one.
 */
const requestSchemas = z.registry<{ id: string }>();
requestSchemas.add(CreateTaskInput, { id: "CreateTaskInput" });
requestSchemas.add(UpdateTaskInput, { id: "UpdateTaskInput" });

const SCHEMA_REF_PREFIX = "#/components/schemas/";

function componentsFrom(
  registry: z.core.$ZodRegistry<{ id: string }>,
  io: "input" | "output",
): Record<string, JsonSchema> {
  const { schemas } = z.toJSONSchema(registry, {
    target: "draft-2020-12",
    uri: (id) => `${SCHEMA_REF_PREFIX}${id}`,
    io,
  });

  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => [id, asComponent(schema)]),
  );
}

/**
 * Drops the two keywords a standalone JSON Schema document carries and a
 * component inside an OpenAPI document should not: `$schema`, which the
 * document declares once for all of them, and the `$id` the `uri` option
 * writes — that string is the *reference* to this component, and repeating it
 * as the component's own identifier makes a resolver point every `$ref` at
 * whatever document it happens to be reading.
 */
function asComponent(schema: unknown): JsonSchema {
  const { $schema: _schema, $id: _id, ...rest } = schema as JsonSchema;
  return rest;
}

/** One property of a schema, for a parameter that should mirror it exactly. */
function propertyOf(schema: z.ZodType, property: string): JsonSchema {
  const generated = asComponent(
    z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }),
  );

  const value = generated.properties?.[property];

  if (!value) {
    throw new Error(`${property} is not a property of the schema`);
  }

  return value;
}

/** The list's query string as parameters, straight off `TaskListQuery`. */
function listQueryParameters(): Parameter[] {
  const generated = asComponent(
    z.toJSONSchema(TaskListQuery, { target: "draft-2020-12", io: "input" }),
  );
  const required = new Set(generated.required ?? []);

  return Object.entries(generated.properties ?? {}).map(([name, schema]) => ({
    name,
    in: "query" as const,
    required: required.has(name),
    schema,
  }));
}

const idParameter: Parameter = {
  name: "id",
  in: "path",
  required: true,
  description: "The Task's id.",
  schema: propertyOf(TaskIdParam, "id"),
};

const ifMatchParameter: Parameter = {
  name: "If-Match",
  in: "header",
  required: true,
  description:
    "The version the edit is written against, quoted, exactly as the last " +
    "ETag spelled it. Absent is 428; stale is 412.",
  schema: { type: "string", examples: ['"3"'] },
};

const etagHeader = {
  ETag: {
    description:
      "The Task's version, quoted. Hand it back as If-Match on the next edit.",
    schema: { type: "string" } as JsonSchema,
  },
};

function jsonOf(component: string): Record<string, { schema: JsonSchema }> {
  return {
    "application/json": { schema: { $ref: SCHEMA_REF_PREFIX + component } },
  };
}

/** A Task, and the ETag every response carrying one sets. */
function taskResponse(description: string): ResponseObject {
  return { description, headers: etagHeader, content: jsonOf("Task") };
}

/** A failure — always the same envelope, named by the code it carries. */
function failure(code: string, description: string): ResponseObject {
  return {
    description: `\`${code}\` — ${description}`,
    content: jsonOf("ErrorResponse"),
  };
}

/**
 * The two failures every route shares. Authentication is checked before any
 * handler runs, and anything unhandled is reported as `500 INTERNAL` with
 * nothing of its insides in the body.
 */
const commonFailures: Record<string, ResponseObject> = {
  "401": failure("UNAUTHENTICATED", "missing, invalid or expired token."),
  "500": failure("INTERNAL", "an unhandled failure."),
};

/**
 * A Task the Actor does not own is reported exactly as one that does not
 * exist, so neither answer leaks the other.
 */
const notFound = failure(
  "NOT_FOUND",
  "no such Task, or it belongs to someone else.",
);

const invalidId = failure("VALIDATION_FAILED", "`id` is not a UUID.");

/**
 * One of the three Transition endpoints. They differ only in which move they
 * make, so they are written once: the same absent body, the same failures, and
 * the same reason a refusal is `409` and not `422`.
 */
function transition(operation: {
  summary: string;
  description?: string;
  operationId: string;
  from: string;
  to: string;
}): Record<string, Operation> {
  return {
    post: {
      summary: operation.summary,
      description:
        (operation.description ? `${operation.description} ` : "") +
        `Legal only from \`${operation.from}\`. No request body: the target ` +
        "Status is in the path, so there is nothing a client can contradict.",
      operationId: operation.operationId,
      parameters: [idParameter],
      responses: {
        "200": taskResponse(`The Task, now \`${operation.to}\`.`),
        ...transitionFailures(operation.to),
      },
    },
  };
}

function transitionFailures(to: string): Record<string, ResponseObject> {
  return {
    "404": notFound,
    "409": failure(
      "INVALID_TRANSITION",
      `the Task is not somewhere \`${to}\` is a legal move from.`,
    ),
    "422": invalidId,
    ...commonFailures,
  };
}

export function buildOpenApiDocument(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: {
      title: "@insightt/api",
      version: "0.1.0",
      description:
        "Task CRUD behind Auth0. Generated from the Zod schemas in " +
        "`@insightt/shared` that validate every request, so it cannot drift " +
        "from what the API accepts. Regenerate with `npm run docs:api`.",
    },
    servers: [
      { url: "http://localhost:4000", description: "Local development" },
    ],
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/tasks": {
        get: {
          summary: "List the Actor's Tasks",
          description:
            "Owner-scoped, newest first. `status` has no default: an " +
            "unfiltered list shows every Status, Archived included.",
          operationId: "listTasks",
          parameters: listQueryParameters(),
          responses: {
            "200": {
              description: "A page of Tasks.",
              content: jsonOf("TaskPage"),
            },
            "422": failure(
              "VALIDATION_FAILED",
              "a query parameter is out of range or is not a number.",
            ),
            ...commonFailures,
          },
        },
        post: {
          summary: "Create a Task",
          description:
            "Always `PENDING`. The body may not name a Status — the " +
            "transition endpoints are the only way a Task moves — and an " +
            "unknown key is a 422 rather than a field silently dropped.",
          operationId: "createTask",
          requestBody: { required: true, content: jsonOf("CreateTaskInput") },
          responses: {
            "201": taskResponse(
              "The Task, carrying the id and the version the next edit needs.",
            ),
            "422": failure("VALIDATION_FAILED", "the body fails the schema."),
            ...commonFailures,
          },
        },
      },
      "/api/tasks/{id}": {
        get: {
          summary: "Read one Task",
          operationId: "getTask",
          parameters: [idParameter],
          responses: {
            "200": taskResponse("The Task."),
            "404": notFound,
            "422": invalidId,
            ...commonFailures,
          },
        },
        patch: {
          summary: "Edit a Task's title or description",
          description:
            "Requires `If-Match`. Which fields are editable depends on the " +
            "Task's Status, and an edit that would change nothing is refused " +
            "rather than raising the version for a write that never happened.",
          operationId: "updateTask",
          parameters: [idParameter, ifMatchParameter],
          requestBody: { required: true, content: jsonOf("UpdateTaskInput") },
          responses: {
            "200": taskResponse("The Task, at its new version."),
            "404": notFound,
            "412": failure(
              "VERSION_CONFLICT",
              "`If-Match` names a version the Task has moved past. Re-read it.",
            ),
            "422": failure(
              "VALIDATION_FAILED",
              "the body fails the schema, names nothing, or would change " +
                "nothing — or `FIELD_NOT_EDITABLE`, when the Task's Status " +
                "has closed a field the edit names.",
            ),
            "428": failure(
              "PRECONDITION_REQUIRED",
              "no `If-Match` header. Send the version rather than clobber.",
            ),
            ...commonFailures,
          },
        },
        delete: {
          summary: "Delete a Task",
          description:
            "Allowed from any Status, and takes no `If-Match`: a version " +
            "protects an edit from overwriting words someone else wrote, and " +
            "a delete overwrites nothing.",
          operationId: "deleteTask",
          parameters: [idParameter],
          responses: {
            "204": { description: "Gone. No body, and no ETag to carry." },
            "404": notFound,
            "422": invalidId,
            ...commonFailures,
          },
        },
      },
      "/api/tasks/{id}/start": transition({
        summary: "Start a Task",
        operationId: "startTask",
        from: "PENDING",
        to: "IN_PROGRESS",
      }),
      "/api/tasks/{id}/done": {
        post: {
          ...transition({
            summary: "Mark a Task as Done",
            operationId: "markTaskDone",
            from: "IN_PROGRESS",
            to: "DONE",
          }).post,
          description:
            "Idempotent, and the only entrance to DONE: one call to the " +
            "`mark_task_done()` function in Postgres, which decides and " +
            "writes in the same statement. A second call on an already-DONE " +
            "Task is a success that changes nothing — same version, same " +
            "`completedAt` — and says so with `X-Idempotent-Replay`. Legal " +
            "only from `IN_PROGRESS`.",
          responses: {
            "200": {
              description: "The Task, now `DONE`.",
              headers: {
                ...etagHeader,
                "X-Idempotent-Replay": {
                  description:
                    "`true` when the Task was already DONE and this call " +
                    "changed nothing.",
                  schema: { type: "string", enum: ["true"] } as JsonSchema,
                },
              },
              content: jsonOf("Task"),
            },
            ...transitionFailures("DONE"),
          },
        },
      },
      "/api/tasks/{id}/archive": transition({
        summary: "Archive a Task",
        description:
          "200 with the Task, not 204: Archiving is a Transition, not a " +
          "delete, and the Task goes on appearing in the list.",
        operationId: "archiveTask",
        from: "DONE",
        to: "ARCHIVED",
      }),
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "An Auth0 access token naming this API as its audience. Every " +
            "route sits behind it, and the `sub` claim is the Owner.",
        },
      },
      schemas: {
        ...componentsFrom(responseSchemas, "output"),
        ...componentsFrom(requestSchemas, "input"),
      },
    },
  };
}

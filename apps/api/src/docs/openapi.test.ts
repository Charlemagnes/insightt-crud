import { ErrorCode, TaskStatus, TASK_PAGE } from "@insightt/shared";

import {
  buildOpenApiDocument,
  type Operation,
  type OpenApiDocument,
  type Parameter,
} from "@/docs/openapi";
import { createFakeTaskRepository } from "@/tasks/repository.fake";
import { createTaskRoutes } from "@/tasks/routes";

/**
 * The document is generated, so the schemas in it cannot drift from the ones
 * that validate requests. What *can* still drift is everything Zod does not
 * know about: which routes exist, which headers they require, which failures
 * they name. These tests hold that half together.
 */
describe("buildOpenApiDocument", () => {
  const document = buildOpenApiDocument();

  /**
   * The one assertion that catches a route added without a line of
   * documentation. It reads the operations off the real router rather than a
   * second hand-written list, so there is nothing here to keep in step.
   */
  it("documents every route the Task router serves, and no others", () => {
    const mounted = mountedOperations();

    // So the comparison below cannot pass on two empty lists, which is what a
    // broken reading of the router stack would give it.
    expect(mounted.length).toBe(8);
    expect(documentedOperations(document)).toEqual(mounted);
  });

  it("names the bearer token every route sits behind", () => {
    expect(document.security).toEqual([{ bearerAuth: [] }]);
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  describe("schemas", () => {
    it("carries the Status machine's own spelling of the enum", () => {
      expect(document.components.schemas.Task.properties?.status).toMatchObject({
        enum: TaskStatus.options,
      });
    });

    it("carries the frozen error vocabulary", () => {
      expect(
        document.components.schemas.ErrorResponse.properties?.error,
      ).toMatchObject({
        properties: { code: { enum: ErrorCode.options } },
      });
    });

    /**
     * The rule from CLAUDE.md, asserted where a reader of the document would
     * look for it: a create names no Status, because the transition endpoints
     * are the only way a Task moves.
     */
    it("offers no way to name a Status on create or edit", () => {
      expect(
        document.components.schemas.CreateTaskInput.properties,
      ).not.toHaveProperty("status");
      expect(
        document.components.schemas.UpdateTaskInput.properties,
      ).not.toHaveProperty("status");
    });

    it("resolves every $ref it uses", () => {
      for (const ref of refsIn(document)) {
        const name = ref.replace("#/components/schemas/", "");
        expect(Object.keys(document.components.schemas)).toContain(name);
      }
    });
  });

  describe("the list operation", () => {
    const list = document.paths["/api/tasks"].get;

    it("takes the pagination and filter parameters, in the query", () => {
      expect(parameterNames(list, "query")).toEqual([
        "page",
        "pageSize",
        "status",
      ]);
    });

    it("takes the page size cap from the schema that enforces it", () => {
      const pageSize = parameterNamed(list, "pageSize");
      expect(pageSize.schema).toMatchObject({
        maximum: TASK_PAGE.maxSize,
        default: TASK_PAGE.defaultSize,
      });
    });

    it("returns the paginated envelope", () => {
      expect(jsonSchemaOf(list.responses["200"])).toEqual({
        $ref: "#/components/schemas/TaskPage",
      });
    });
  });

  describe("the edit operation", () => {
    const edit = document.paths["/api/tasks/{id}"].patch;

    it("requires the If-Match header that carries the version", () => {
      expect(parameterNamed(edit, "If-Match")).toMatchObject({
        in: "header",
        required: true,
      });
    });

    /**
     * `412` and `428` are different mistakes with different fixes, and the
     * frontend branches on them. A document that named only one would be
     * telling a client to treat them the same.
     */
    it("names both precondition failures", () => {
      expect(Object.keys(edit.responses)).toEqual(
        expect.arrayContaining(["412", "428"]),
      );
    });
  });

  describe("the transition operations", () => {
    it("takes no request body, because the target Status is in the path", () => {
      for (const path of [
        "/api/tasks/{id}/start",
        "/api/tasks/{id}/done",
        "/api/tasks/{id}/archive",
      ]) {
        expect(document.paths[path].post).not.toHaveProperty("requestBody");
      }
    });

    it("names 409 on each, for a move that is not legal from here", () => {
      for (const path of [
        "/api/tasks/{id}/start",
        "/api/tasks/{id}/done",
        "/api/tasks/{id}/archive",
      ]) {
        expect(document.paths[path].post.responses).toHaveProperty("409");
      }
    });

    it("documents the Replay marker on Mark Done, and only there", () => {
      expect(
        document.paths["/api/tasks/{id}/done"].post.responses["200"].headers,
      ).toHaveProperty("X-Idempotent-Replay");
      expect(
        document.paths["/api/tasks/{id}/start"].post.responses["200"].headers,
      ).not.toHaveProperty("X-Idempotent-Replay");
    });
  });

  it("gives the delete a 204 with no body", () => {
    const remove = document.paths["/api/tasks/{id}"].delete;
    expect(Object.keys(remove.responses)).toContain("204");
    expect(remove.responses["204"]).not.toHaveProperty("content");
  });
});

/** The JSON body a response declares. */
function jsonSchemaOf(response: { content?: Record<string, { schema: unknown }> }) {
  return response.content?.["application/json"].schema;
}

/** Every `METHOD /path` the document describes, sorted. */
function documentedOperations(document: OpenApiDocument): string[] {
  return Object.entries(document.paths)
    .flatMap(([path, operations]) =>
      Object.keys(operations).map(
        (method) => `${method.toUpperCase()} ${path}`,
      ),
    )
    .sort();
}

/**
 * Every `METHOD /path` the Express router actually serves, spelled the way
 * OpenAPI spells a path parameter and prefixed with the mount point `app.ts`
 * gives the router.
 */
function mountedOperations(): string[] {
  const router = createTaskRoutes(createFakeTaskRepository());
  const layers = (router as unknown as { stack: RouterLayer[] }).stack;

  return layers
    .flatMap((layer) =>
      Object.keys(layer.route?.methods ?? {}).map(
        (method) =>
          `${method.toUpperCase()} /api/tasks${openApiPath(layer.route!.path)}`,
      ),
    )
    .sort();
}

interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

/** `/:id/done` is `/{id}/done` in OpenAPI, and `/` is the collection itself. */
function openApiPath(expressPath: string): string {
  return expressPath === "/"
    ? ""
    : expressPath.replace(/:([^/]+)/g, "{$1}");
}

function parameterNames(operation: Operation, location: string): string[] {
  return (operation.parameters ?? [])
    .filter((parameter) => parameter.in === location)
    .map((parameter) => parameter.name);
}

function parameterNamed(operation: Operation, name: string): Parameter {
  const parameter = (operation.parameters ?? []).find(
    (candidate) => candidate.name === name,
  );

  if (!parameter) {
    throw new Error(`No parameter named ${name}`);
  }

  return parameter;
}

/** Every `$ref` anywhere in the document, however deeply nested. */
function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(refsIn);
  }

  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) =>
      key === "$ref" && typeof nested === "string" ? [nested] : refsIn(nested),
    );
  }

  return [];
}

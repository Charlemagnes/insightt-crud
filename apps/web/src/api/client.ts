import { ErrorResponseSchema, type ErrorCode } from "@insightt/shared";
import type { z } from "zod";

import { config } from "@/config";
import { useSessionStore } from "@/stores/session";

/**
 * A failure the API named. `code` is the frozen vocabulary from
 * `@insightt/shared`, so callers branch on it rather than on a message —
 * `VERSION_CONFLICT` and `INVALID_TRANSITION` are different problems with
 * different recoveries.
 *
 * `apps/api/src/middleware/errors.ts` declares a twin of this class. The two
 * are deliberately not shared: `@insightt/shared` holds wire contracts, and a
 * runtime class that throws is not one. What crosses the wire is the envelope
 * they both agree on, `ErrorResponseSchema`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * A request that carries a JSON body. It exists so that no call site spells the
 * `Content-Type` out: `express.json` ignores a body that does not claim to be
 * JSON, leaving the handler an empty one, and the mistake then surfaces as a
 * validation error about a field that is missing rather than the header that is.
 */
export function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * The one place a request reaches the API. It attaches the bearer token, parses
 * the response against the shared schema, and turns the error envelope into an
 * `ApiError`.
 *
 * Parsing here rather than in the component is the point: a backend shape
 * change surfaces at the boundary that owns the contract, instead of as an
 * `undefined` three components deep.
 */
export async function apiFetch<Output>(
  path: string,
  schema: z.ZodType<Output>,
  init: RequestInit = {},
): Promise<Output> {
  const { body } = await apiFetchWithHeaders(path, schema, init);

  return body;
}

/**
 * The same request, with the response headers kept.
 *
 * Only Mark Done needs them: `X-Idempotent-Replay` is how the API says a Task
 * was already finished, and that is a different thing to tell a person than a
 * completion they just caused. Every other call throws its headers away, which
 * is why this is the exception rather than what `apiFetch` returns.
 */
export async function apiFetchWithHeaders<Output>(
  path: string,
  schema: z.ZodType<Output>,
  init: RequestInit = {},
): Promise<{ body: Output; headers: Headers }> {
  const response = await apiSend(path, init);

  return {
    body: schema.parse(await response.json()),
    headers: response.headers,
  };
}

/**
 * The request itself, up to and including the failure mapping, with the
 * response handed back unread.
 *
 * Delete is the one call that uses it directly: the API answers `204`, and
 * `response.json()` on an empty body throws — so a success would arrive as a
 * parse error about a Task that was removed exactly as asked. Everything else
 * goes through the two wrappers above, which read and validate the body.
 */
export async function apiSend(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { getAccessToken, login } = useSessionStore.getState();
  const token = await getAccessToken();

  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const failure = await describeFailure(response);

    // An expired or revoked token is not an error the person can act on; send
    // them back through Universal Login. No retry loop, no interceptor state.
    if (response.status === 401) {
      void login();
    }

    throw failure;
  }

  return response;
}

async function describeFailure(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = ErrorResponseSchema.safeParse(body);

  if (!parsed.success) {
    return new ApiError(
      response.status,
      "INTERNAL",
      `The API returned ${response.status} without an error envelope`,
    );
  }

  const { code, message, details } = parsed.data.error;
  return new ApiError(response.status, code, message, details);
}

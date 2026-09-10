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

  return schema.parse(await response.json());
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

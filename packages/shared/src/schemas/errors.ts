import { z } from "zod";

/**
 * The frozen error vocabulary (PLAN.md §6). Every failure the API reports is
 * one of these, so the frontend can branch on `code` instead of string-matching
 * a message. The pairs that matter most: `412 VERSION_CONFLICT` means someone
 * else changed the Task, `409 INVALID_TRANSITION` means the move itself is not
 * allowed — different failures with different recoveries.
 */
export const ErrorCode = z.enum([
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "FIELD_NOT_EDITABLE",
  "INVALID_TRANSITION",
  "VERSION_CONFLICT",
  "PRECONDITION_REQUIRED",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** The envelope every error response carries: `{ error: { code, message } }`. */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { buildOpenApiDocument } from "@/docs/openapi";

/**
 * The checked-in copy of the document, at the repo root. The running API serves
 * the same thing at `/api/docs/openapi.json`; this file is the convenience for
 * anyone reading the repo without starting it, not a second source of truth.
 */
export const OPENAPI_JSON_PATH = resolve(
  __dirname,
  "../../../../docs/openapi.json",
);

/**
 * Writes it. `npm run docs:api` after changing a schema or a route — and
 * `openapi.test.ts` fails if you forget, since a stale file is the one way the
 * generated document can still be wrong.
 */
export function writeOpenApiDocument(): void {
  mkdirSync(dirname(OPENAPI_JSON_PATH), { recursive: true });
  writeFileSync(
    OPENAPI_JSON_PATH,
    `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`,
  );
}

// Only when run as the script, so the test can import the path without the
// import writing a file as a side effect.
if (require.main === module) {
  writeOpenApiDocument();
  console.log(`wrote ${OPENAPI_JSON_PATH}`);
}

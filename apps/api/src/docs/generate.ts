import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { buildOpenApiDocument } from "@/docs/openapi";

/**
 * Writes `docs/openapi.json` at the repo root. Run it with `npm run docs:api`
 * after changing a schema or a route; the running API serves the same document
 * at `/api/docs/openapi.json`, so the checked-in file is a convenience for
 * anyone reading the repo without starting it, not a second source of truth.
 */
const OUTPUT = resolve(__dirname, "../../../../docs/openapi.json");

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);

console.log(`wrote ${OUTPUT}`);

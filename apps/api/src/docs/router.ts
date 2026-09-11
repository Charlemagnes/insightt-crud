import { Router } from "express";
import swaggerUi from "swagger-ui-express";

import { buildOpenApiDocument } from "@/docs/openapi";

/**
 * The generated API description, and Swagger UI over it. Mounted at
 * `/api/docs` outside the auth stack, and only when `serveDocs` is set — which
 * `index.ts` reads off `NODE_ENV`, so production never serves it.
 *
 * Outside the auth stack because it has to be: Swagger UI is a page a browser
 * loads directly, with no Authorization header to put on the request. That is
 * the whole reason it is development-only rather than simply always on.
 */
export function createDocsRoutes(): Router {
  const router = Router();
  const document = buildOpenApiDocument();

  // Served as well as rendered, so a client generator can be pointed at a
  // running API rather than at a checked-in file that may be a commit behind.
  router.get("/openapi.json", (_req, res) => {
    res.json(document);
  });

  router.use("/", swaggerUi.serve, swaggerUi.setup(document));

  return router;
}

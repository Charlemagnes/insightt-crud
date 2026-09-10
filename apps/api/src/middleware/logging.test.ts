import express from "express";
import request from "supertest";

import { createRequestLogging, type LogRecord } from "@/middleware/logging";

/**
 * Exercises the logger against a parameterised route, which the API does not
 * have yet — the Task routes that take an `:id` arrive in later tickets, and by
 * then this behaviour needs to already be true.
 *
 * It is also what pins the design down: the lines are written when the response
 * closes precisely so that `params` and `body`, neither of which exists when a
 * request arrives, are real values rather than empty placeholders.
 */
function harness() {
  const records: LogRecord[] = [];
  const app = express();

  app.use(createRequestLogging((record) => records.push(record)));
  app.use(express.json());
  app.post("/things/:thingId/parts/:partId", (_req, res) => {
    res.status(201).json({ ok: true });
  });

  return { app, records };
}

describe("createRequestLogging", () => {
  it("logs the matched route and its parameters", async () => {
    const { app, records } = harness();

    await request(app).post("/things/t-1/parts/p-2").send({ note: "hello" });

    const [inbound] = records.filter((r) => r.direction === "inbound");
    expect(inbound.route).toBe("/things/:thingId/parts/:partId");
    expect(inbound.params).toEqual({ thingId: "t-1", partId: "p-2" });
  });

  it("logs the parsed body, which no earlier mount point could see", async () => {
    const { app, records } = harness();

    await request(app).post("/things/t-1/parts/p-2").send({ note: "hello" });

    const [inbound] = records.filter((r) => r.direction === "inbound");
    expect(inbound.body).toEqual({ note: "hello" });
  });

  it("timestamps the inbound line when the request arrived, not when it was written", async () => {
    const { app, records } = harness();

    await request(app).post("/things/t-1/parts/p-2").send({ note: "hello" });

    const [inbound] = records.filter((r) => r.direction === "inbound");
    const [outbound] = records.filter((r) => r.direction === "outbound");
    expect(Date.parse(inbound.ts)).toBeLessThanOrEqual(Date.parse(outbound.ts));
  });
});

import { loadEnv } from "@/env";

const COMPLETE = {
  DATABASE_URL: "postgresql://postgres:secret@pooler.example:5432/postgres",
  AUTH0_DOMAIN: "example.eu.auth0.com",
  AUTH0_AUDIENCE: "https://tasks.example/api",
  PORT: "4000",
  WEB_ORIGIN: "http://localhost:3000",
};

describe("loadEnv", () => {
  it("coerces PORT to a number", () => {
    expect(loadEnv(COMPLETE).port).toBe(4000);
  });

  it("falls back to the local development defaults", () => {
    const { PORT, WEB_ORIGIN, ...rest } = COMPLETE;

    expect(loadEnv(rest)).toMatchObject({
      port: 4000,
      webOrigin: "http://localhost:3000",
    });
  });

  it("names every missing variable in one throw", () => {
    expect(() => loadEnv({})).toThrow(
      /DATABASE_URL[\s\S]*AUTH0_DOMAIN[\s\S]*AUTH0_AUDIENCE/,
    );
  });

  it("rejects the transaction-mode pooler by its port", () => {
    // It fails late otherwise: the pool connects, early queries work, and a
    // prepared statement then errors somewhere that looks like a Drizzle bug.
    expect(() =>
      loadEnv({
        ...COMPLETE,
        DATABASE_URL:
          "postgresql://postgres.ref:secret@pooler.example:6543/postgres",
      }),
    ).toThrow(/session pooler/);
  });

  it("leaves the CA certificate path unset when none was given", () => {
    // Absent means encrypted but unverified, which `db/client.ts` decides —
    // `loadEnv` only reports what the environment said.
    expect(loadEnv(COMPLETE).databaseCaCertPath).toBeUndefined();
  });

  it("rejects a WEB_ORIGIN that is not a URL", () => {
    expect(() => loadEnv({ ...COMPLETE, WEB_ORIGIN: "localhost:3000" })).toThrow(
      /WEB_ORIGIN/,
    );
  });

  it("serves the generated API description everywhere but production", () => {
    expect(loadEnv(COMPLETE).serveDocs).toBe(true);
    expect(loadEnv({ ...COMPLETE, NODE_ENV: "production" }).serveDocs).toBe(
      false,
    );
  });

  it("builds the issuer base URL the tenant JWKS is fetched from", () => {
    expect(loadEnv(COMPLETE).auth0IssuerBaseUrl).toBe(
      "https://example.eu.auth0.com/",
    );
  });
});

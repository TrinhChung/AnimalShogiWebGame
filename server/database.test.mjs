import assert from "node:assert/strict";
import test from "node:test";

import { databaseConfigFromEnvironment } from "./database.mjs";

test("database configuration is optional when it is not required", () => {
  assert.equal(databaseConfigFromEnvironment({}), null);
});

test("database configuration rejects partial values", () => {
  assert.throws(
    () => databaseConfigFromEnvironment({ QAS_DB_HOST: "127.0.0.1" }),
    /configuration is incomplete/,
  );
});

test("database configuration parses a complete MySQL connection", () => {
  assert.deepEqual(
    databaseConfigFromEnvironment({
      QAS_DB_HOST: "127.0.0.1",
      QAS_DB_PORT: "3307",
      QAS_DB_USER: "qas_app",
      QAS_DB_PASSWORD: "secret",
      QAS_DB_NAME: "quantum_animal_shogi",
    }),
    {
      host: "127.0.0.1",
      port: 3307,
      user: "qas_app",
      password: "secret",
      database: "quantum_animal_shogi",
    },
  );
});

test("required database configuration fails when values are absent", () => {
  assert.throws(
    () => databaseConfigFromEnvironment({ QAS_DB_REQUIRED: "true" }),
    /MySQL is required/,
  );
});

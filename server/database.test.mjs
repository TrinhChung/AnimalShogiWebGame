import assert from "node:assert/strict";
import test from "node:test";

import {
  databaseConfigFromEnvironment,
  recoverMaterializedTrainingMigration,
} from "./database.mjs";

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

test("a fully materialized interrupted training migration is recorded", async () => {
  const writes = [];
  const pool = {
    async query() {
      return [
        [
          {
            exportTableCount: 1,
            qualityColumnCount: 1,
            checksumColumnCount: 1,
          },
        ],
      ];
    },
    async execute(statement, parameters) {
      writes.push([statement, parameters]);
    },
  };
  assert.equal(
    await recoverMaterializedTrainingMigration(
      pool,
      "004_training_data_integrity.sql",
      "a".repeat(64),
    ),
    true,
  );
  assert.deepEqual(writes[0][1], [
    "004_training_data_integrity.sql",
    "a".repeat(64),
  ]);
});

test("an incomplete training migration is not marked applied", async () => {
  const pool = {
    async query() {
      return [
        [
          {
            exportTableCount: 1,
            qualityColumnCount: 1,
            checksumColumnCount: 0,
          },
        ],
      ];
    },
    async execute() {
      throw new Error("must not write");
    },
  };
  assert.equal(
    await recoverMaterializedTrainingMigration(
      pool,
      "004_training_data_integrity.sql",
      "b".repeat(64),
    ),
    false,
  );
});

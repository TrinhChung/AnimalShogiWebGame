import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

const migrationDirectory = new URL("./migrations/", import.meta.url);
const environmentFile = fileURLToPath(new URL("../.env", import.meta.url));

try {
  loadEnvFile(environmentFile);
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

const isEnabled = (value) =>
  ["1", "true", "yes"].includes(String(value ?? "").toLowerCase());

export const recoverMaterializedTrainingMigration = async (
  pool,
  fileName,
  checksum,
) => {
  if (fileName !== "004_training_data_integrity.sql") {
    return false;
  }
  const [rows] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = 'dataset_export_items') AS exportTableCount,
      (SELECT COUNT(*) FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'matches'
         AND column_name = 'quality_status') AS qualityColumnCount,
      (SELECT COUNT(*) FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'match_moves'
         AND column_name = 'transition_checksum') AS checksumColumnCount
  `);
  const materialized = rows[0];
  if (
    Number(materialized?.exportTableCount) !== 1 ||
    Number(materialized?.qualityColumnCount) !== 1 ||
    Number(materialized?.checksumColumnCount) !== 1
  ) {
    return false;
  }
  await pool.execute(
    "INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)",
    [fileName, checksum],
  );
  return true;
};

export const databaseConfigFromEnvironment = (environment = process.env) => {
  const values = {
    host: environment.QAS_DB_HOST?.trim(),
    port: Number(environment.QAS_DB_PORT ?? 3306),
    user: environment.QAS_DB_USER?.trim(),
    password: environment.QAS_DB_PASSWORD,
    database: environment.QAS_DB_NAME?.trim(),
  };
  const configured =
    values.host || values.user || values.password || values.database;

  if (!configured) {
    if (isEnabled(environment.QAS_DB_REQUIRED)) {
      throw new Error(
        "MySQL is required but QAS_DB_HOST, QAS_DB_USER, QAS_DB_PASSWORD, and QAS_DB_NAME are missing",
      );
    }
    return null;
  }
  if (
    !values.host ||
    !values.user ||
    values.password === undefined ||
    !values.database
  ) {
    throw new Error("MySQL configuration is incomplete");
  }
  if (
    !Number.isInteger(values.port) ||
    values.port < 1 ||
    values.port > 65_535
  ) {
    throw new Error("QAS_DB_PORT is invalid");
  }
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(values.database)) {
    throw new Error("QAS_DB_NAME is invalid");
  }

  return values;
};

const applyMigrations = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) NOT NULL,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (version)
    ) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  `);

  const migrationFiles = (await readdir(migrationDirectory))
    .filter((fileName) => /^\d+_[a-z0-9_]+\.sql$/.test(fileName))
    .sort();

  for (const fileName of migrationFiles) {
    const sql = await readFile(new URL(fileName, migrationDirectory), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const [rows] = await pool.execute(
      "SELECT checksum FROM schema_migrations WHERE version = ?",
      [fileName],
    );
    if (rows.length > 0) {
      if (rows[0].checksum !== checksum) {
        throw new Error(`Applied migration was modified: ${fileName}`);
      }
      continue;
    }

    if (await recoverMaterializedTrainingMigration(pool, fileName, checksum)) {
      continue;
    }

    await pool.query(sql);
    await pool.execute(
      "INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)",
      [fileName, checksum],
    );
  }
};

export const createDatabase = async (configuration) => {
  const pool = mysql.createPool({
    ...configuration,
    connectionLimit: 8,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    multipleStatements: true,
    timezone: "Z",
    waitForConnections: true,
  });

  try {
    await pool.query("SET time_zone = '+00:00'");
    await applyMigrations(pool);
    await pool.query("SELECT 1");
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
};

export const createDatabaseFromEnvironment = async (
  environment = process.env,
) => {
  const configuration = databaseConfigFromEnvironment(environment);
  return configuration ? createDatabase(configuration) : null;
};

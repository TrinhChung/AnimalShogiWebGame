import { randomUUID } from "node:crypto";

import { validateStoredTrajectory } from "./trajectory_integrity.mjs";

const identifier = (value, field, maximumLength = 120) => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    !/^[a-zA-Z0-9._:-]+$/.test(value)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return value;
};

const withTransaction = async (pool, operation) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export class TrainingDataRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async summary() {
    const [qualityRows] = await this.pool.query(`
      SELECT quality_status AS qualityStatus, COUNT(*) AS matchCount,
             COALESCE(SUM(move_count), 0) AS transitionCount
      FROM matches
      GROUP BY quality_status
      ORDER BY quality_status
    `);
    const [sourceRows] = await this.pool.query(`
      SELECT data_source AS dataSource, quality_status AS qualityStatus,
             COUNT(*) AS matchCount
      FROM matches
      GROUP BY data_source, quality_status
      ORDER BY data_source, quality_status
    `);
    const [exportRows] = await this.pool.query(`
      SELECT COUNT(*) AS exportCount,
             COALESCE(SUM(match_count), 0) AS exportedMatchCount,
             COALESCE(SUM(sample_count), 0) AS exportedSampleCount
      FROM dataset_exports WHERE status = 'completed'
    `);
    return {
      quality: qualityRows.map((row) => ({
        quality_status: row.qualityStatus,
        match_count: Number(row.matchCount),
        transition_count: Number(row.transitionCount),
      })),
      sources: sourceRows.map((row) => ({
        data_source: row.dataSource,
        quality_status: row.qualityStatus,
        match_count: Number(row.matchCount),
      })),
      exports: {
        export_count: Number(exportRows[0].exportCount),
        match_count: Number(exportRows[0].exportedMatchCount),
        sample_count: Number(exportRows[0].exportedSampleCount),
      },
    };
  }

  async validatePending(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1_000));
    const [rows] = await this.pool.query(
      `SELECT id FROM matches
       WHERE quality_status = 'raw' AND status = 'completed'
       ORDER BY finished_at, id
       LIMIT ?`,
      [safeLimit],
    );
    const result = { validated: 0, passed: 0, failed: 0 };
    for (const row of rows) {
      const validation = await withTransaction(this.pool, (connection) =>
        validateStoredTrajectory(connection, row.id),
      );
      result.validated += 1;
      result[validation.passed ? "passed" : "failed"] += 1;
    }
    return result;
  }

  async addLabel(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("training label is invalid");
    }
    const hasMatch = Boolean(value.matchId);
    const hasMove = Boolean(value.moveId);
    if (hasMatch === hasMove) {
      throw new Error("training label requires exactly one target");
    }
    const namespaceKey = identifier(value.namespace, "label namespace");
    const labelKey = identifier(value.key, "label key");
    const producerKey = identifier(value.producer, "label producer", 160);
    if (
      !Number.isInteger(value.version) ||
      value.version < 1 ||
      value.version > 1_000_000
    ) {
      throw new Error("label version is invalid");
    }
    if (
      value.confidence !== null &&
      value.confidence !== undefined &&
      (!Number.isFinite(value.confidence) ||
        value.confidence < 0 ||
        value.confidence > 1)
    ) {
      throw new Error("label confidence is invalid");
    }
    return withTransaction(this.pool, async (connection) => {
      let matchDatabaseId = null;
      let moveDatabaseId = null;
      if (hasMatch) {
        const [rows] = await connection.execute(
          "SELECT id FROM matches WHERE public_id = ?",
          [identifier(value.matchId, "label match id")],
        );
        matchDatabaseId = rows[0]?.id ?? null;
      } else {
        const [rows] = await connection.execute(
          "SELECT id FROM match_moves WHERE public_id = ?",
          [identifier(value.moveId, "label move id")],
        );
        moveDatabaseId = rows[0]?.id ?? null;
      }
      if (!matchDatabaseId && !moveDatabaseId) {
        throw new Error("training label target was not found");
      }
      const publicId = randomUUID();
      await connection.execute(
        `INSERT INTO training_labels
          (public_id, match_id, match_move_id, namespace_key, label_key,
           label_version, value_json, producer_key, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicId,
          matchDatabaseId,
          moveDatabaseId,
          namespaceKey,
          labelKey,
          value.version,
          JSON.stringify(value.value ?? null),
          producerKey,
          value.confidence ?? null,
        ],
      );
      return { id: publicId };
    });
  }
}

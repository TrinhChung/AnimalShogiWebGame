-- Adds an explicit, versioned trajectory contract. Existing rows stay quarantined.
ALTER TABLE bot_versions
  ADD COLUMN artifact_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER version_label,
  ADD COLUMN policy_key VARCHAR(120) NOT NULL DEFAULT 'legacy-unknown' AFTER artifact_digest,
  ADD CONSTRAINT ck_bot_versions_artifact_digest
    CHECK (artifact_digest IS NULL OR artifact_digest REGEXP '^[0-9a-f]{64}$');

ALTER TABLE matches
  ADD COLUMN trajectory_schema_version SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER ruleset_version,
  ADD COLUMN data_source VARCHAR(80) NOT NULL DEFAULT 'legacy-unverified' AFTER trajectory_schema_version,
  ADD COLUMN quality_status VARCHAR(40) NOT NULL DEFAULT 'quarantined' AFTER data_source,
  ADD COLUMN recorder_version VARCHAR(120) NOT NULL DEFAULT 'legacy-v1' AFTER quality_status,
  ADD COLUMN recorder_build_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER recorder_version,
  ADD COLUMN observation_encoding VARCHAR(120) NULL AFTER recorder_build_digest,
  ADD COLUMN action_encoding VARCHAR(120) NULL AFTER observation_encoding,
  ADD COLUMN state_encoding VARCHAR(120) NULL AFTER action_encoding,
  ADD COLUMN reward_encoding VARCHAR(120) NULL AFTER state_encoding,
  ADD COLUMN ruleset_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER reward_encoding,
  ADD COLUMN rng_seed BIGINT UNSIGNED NULL AFTER ruleset_digest,
  ADD COLUMN initial_state_json JSON NULL AFTER rng_seed,
  ADD COLUMN initial_state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER initial_state_json,
  ADD COLUMN trajectory_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER initial_state_hash,
  ADD COLUMN validated_at TIMESTAMP(3) NULL AFTER trajectory_checksum,
  ADD COLUMN validation_error TEXT NULL AFTER validated_at,
  ADD KEY ix_matches_quality_source (quality_status, data_source, started_at),
  ADD KEY ix_matches_trajectory_schema (trajectory_schema_version, quality_status),
  ADD CONSTRAINT ck_matches_quality_status
    CHECK (quality_status IN ('quarantined', 'raw', 'train-eligible', 'rejected')),
  ADD CONSTRAINT ck_matches_recorder_build_digest
    CHECK (recorder_build_digest IS NULL OR recorder_build_digest REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_matches_ruleset_digest
    CHECK (ruleset_digest IS NULL OR ruleset_digest REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_matches_initial_state_hash
    CHECK (initial_state_hash IS NULL OR initial_state_hash REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_matches_trajectory_checksum
    CHECK (trajectory_checksum IS NULL OR trajectory_checksum REGEXP '^[0-9a-f]{64}$');

ALTER TABLE match_moves
  ADD COLUMN public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER id,
  ADD COLUMN observation_turn INT UNSIGNED NULL AFTER action_mask_json,
  ADD COLUMN state_before_json JSON NULL AFTER observation_turn,
  ADD COLUMN state_before_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER state_before_json,
  ADD COLUMN state_after_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER state_after_json,
  ADD COLUMN transition_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER state_after_hash,
  ADD COLUMN reward_perspective VARCHAR(40) NULL AFTER reward_after,
  ADD COLUMN outcome_after VARCHAR(50) NULL AFTER reward_perspective,
  ADD COLUMN terminal_reason_key VARCHAR(80) NULL AFTER outcome_after,
  ADD COLUMN actor_kind VARCHAR(50) NULL AFTER terminal_reason_key,
  ADD COLUMN policy_metadata_json JSON NULL AFTER actor_kind,
  ADD COLUMN quality_flags_json JSON NULL AFTER policy_metadata_json,
  ADD KEY ix_match_moves_transition_hash (transition_checksum),
  ADD UNIQUE KEY uq_match_moves_public_id (public_id),
  ADD KEY ix_match_moves_terminal_reason (terminal_reason_key, outcome_after),
  ADD CONSTRAINT ck_match_moves_state_before_hash
    CHECK (state_before_hash IS NULL OR state_before_hash REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_match_moves_state_after_hash
    CHECK (state_after_hash IS NULL OR state_after_hash REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_match_moves_transition_checksum
    CHECK (transition_checksum IS NULL OR transition_checksum REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_match_moves_reward_after
    CHECK (reward_after IS NULL OR reward_after BETWEEN -1.0000 AND 1.0000),
  ADD CONSTRAINT ck_match_moves_reward_perspective
    CHECK (reward_perspective IS NULL OR reward_perspective IN ('actor')),
  ADD CONSTRAINT ck_match_moves_outcome_after
    CHECK (outcome_after IS NULL OR outcome_after IN ('player-one-win', 'player-two-win', 'draw')),
  ADD CONSTRAINT ck_match_moves_terminal_reason
    CHECK (terminal_reason_key IS NULL OR terminal_reason_key IN ('try', 'catch', 'max-turn-draw'));

CREATE TABLE trajectory_validations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  match_id BIGINT UNSIGNED NOT NULL,
  validator_version VARCHAR(120) NOT NULL,
  status VARCHAR(30) NOT NULL,
  trajectory_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  checks_json JSON NOT NULL,
  errors_json JSON NOT NULL,
  validated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_trajectory_validations_public_id (public_id),
  KEY ix_trajectory_validations_match_time (match_id, validated_at),
  KEY ix_trajectory_validations_status_time (status, validated_at),
  CONSTRAINT ck_trajectory_validations_status
    CHECK (status IN ('passed', 'failed')),
  CONSTRAINT ck_trajectory_validations_checksum
    CHECK (trajectory_checksum IS NULL OR trajectory_checksum REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT fk_trajectory_validations_match
    FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE training_labels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  match_id BIGINT UNSIGNED NULL,
  match_move_id BIGINT UNSIGNED NULL,
  namespace_key VARCHAR(120) NOT NULL,
  label_key VARCHAR(120) NOT NULL,
  label_version INT UNSIGNED NOT NULL,
  value_json JSON NOT NULL,
  producer_key VARCHAR(160) NOT NULL,
  confidence DECIMAL(7, 6) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_training_labels_public_id (public_id),
  UNIQUE KEY uq_training_labels_match_version
    (match_id, namespace_key, label_key, label_version, producer_key),
  UNIQUE KEY uq_training_labels_move_version
    (match_move_id, namespace_key, label_key, label_version, producer_key),
  KEY ix_training_labels_match_namespace (match_id, namespace_key, label_key),
  KEY ix_training_labels_move_namespace (match_move_id, namespace_key, label_key),
  CONSTRAINT ck_training_labels_target
    CHECK ((match_id IS NULL) <> (match_move_id IS NULL)),
  CONSTRAINT ck_training_labels_confidence
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT ck_training_labels_namespace
    CHECK (namespace_key REGEXP '^[a-zA-Z0-9._:-]{1,120}$'),
  CONSTRAINT ck_training_labels_key
    CHECK (label_key REGEXP '^[a-zA-Z0-9._:-]{1,120}$'),
  CONSTRAINT fk_training_labels_match
    FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
  CONSTRAINT fk_training_labels_move
    FOREIGN KEY (match_move_id) REFERENCES match_moves (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE dataset_exports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(255) NOT NULL,
  dataset_schema_version INT UNSIGNED NOT NULL,
  status VARCHAR(30) NOT NULL,
  split_seed BIGINT UNSIGNED NOT NULL,
  split_strategy VARCHAR(120) NOT NULL,
  filter_json JSON NOT NULL,
  manifest_json JSON NULL,
  manifest_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  sample_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  match_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finalized_at TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dataset_exports_public_id (public_id),
  KEY ix_dataset_exports_status_time (status, created_at),
  CONSTRAINT ck_dataset_exports_status
    CHECK (status IN ('building', 'completed', 'failed')),
  CONSTRAINT ck_dataset_exports_manifest_sha
    CHECK (manifest_sha256 IS NULL OR manifest_sha256 REGEXP '^[0-9a-f]{64}$')
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE dataset_export_items (
  export_id BIGINT UNSIGNED NOT NULL,
  match_id BIGINT UNSIGNED NOT NULL,
  split_key VARCHAR(20) NOT NULL,
  sample_count INT UNSIGNED NOT NULL,
  trajectory_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (export_id, match_id),
  KEY ix_dataset_export_items_split (export_id, split_key, match_id),
  CONSTRAINT ck_dataset_export_items_split
    CHECK (split_key IN ('train', 'validation', 'test')),
  CONSTRAINT ck_dataset_export_items_checksum
    CHECK (trajectory_checksum REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT fk_dataset_export_items_export
    FOREIGN KEY (export_id) REFERENCES dataset_exports (id) ON DELETE CASCADE,
  CONSTRAINT fk_dataset_export_items_match
    FOREIGN KEY (match_id) REFERENCES matches (id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Ratings are derived data. Reset them once so quarantined legacy matches cannot
-- influence version comparisons after this migration.
DELETE FROM rating_events;
UPDATE bot_ratings
SET rating = 1500.0000, games = 0, wins = 0, draws = 0, losses = 0;

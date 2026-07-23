-- Stores reproducible engine profiles, benchmark measurements, and actionable findings.
CREATE TABLE bot_version_algorithm_profiles (
  bot_version_id BIGINT UNSIGNED NOT NULL,
  stage_label VARCHAR(100) NULL,
  search_family VARCHAR(100) NOT NULL,
  source_commit CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  features_json JSON NOT NULL,
  config_json JSON NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (bot_version_id),
  KEY ix_algorithm_profiles_family (search_family),
  CONSTRAINT fk_algorithm_profiles_version
    FOREIGN KEY (bot_version_id) REFERENCES bot_versions (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE benchmark_suites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  suite_key VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  schema_version INT UNSIGNED NOT NULL DEFAULT 1,
  metric_catalog_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_benchmark_suites_key (suite_key)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE benchmark_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bot_version_id BIGINT UNSIGNED NOT NULL,
  suite_id BIGINT UNSIGNED NOT NULL,
  run_key VARCHAR(255) NOT NULL,
  run_label VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL,
  source VARCHAR(50) NOT NULL,
  source_commit CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  environment_json JSON NOT NULL,
  settings_json JSON NOT NULL,
  notes TEXT NULL,
  started_at TIMESTAMP(3) NOT NULL,
  finished_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_benchmark_runs_public_id (public_id),
  UNIQUE KEY uq_benchmark_runs_version_suite_key (bot_version_id, suite_id, run_key),
  KEY ix_benchmark_runs_version_finished (bot_version_id, finished_at),
  KEY ix_benchmark_runs_suite_finished (suite_id, finished_at),
  KEY ix_benchmark_runs_status (status),
  CONSTRAINT fk_benchmark_runs_version
    FOREIGN KEY (bot_version_id) REFERENCES bot_versions (id),
  CONSTRAINT fk_benchmark_runs_suite
    FOREIGN KEY (suite_id) REFERENCES benchmark_suites (id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE benchmark_cases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id BIGINT UNSIGNED NOT NULL,
  position_key VARCHAR(160) NOT NULL,
  workload_class VARCHAR(80) NOT NULL,
  depth INT UNSIGNED NOT NULL DEFAULT 0,
  time_limit_ms INT UNSIGNED NOT NULL DEFAULT 0,
  repeat_index INT UNSIGNED NOT NULL DEFAULT 1,
  completed BOOLEAN NOT NULL,
  legal_result BOOLEAN NOT NULL,
  best_move VARCHAR(100) NULL,
  score INT NULL,
  nodes BIGINT UNSIGNED NULL,
  elapsed_ms DECIMAL(20, 4) NULL,
  nps DECIMAL(20, 4) NULL,
  tt_hit_rate DECIMAL(8, 6) NULL,
  average_branching DECIMAL(12, 6) NULL,
  reduced_branching DECIMAL(12, 6) NULL,
  eval_ms DECIMAL(20, 4) NULL,
  movegen_ms DECIMAL(20, 4) NULL,
  ordering_ms DECIMAL(20, 4) NULL,
  propagation_ms DECIMAL(20, 4) NULL,
  leq_ms DECIMAL(20, 4) NULL,
  peak_rss_mb DECIMAL(14, 4) NULL,
  metrics_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_benchmark_cases_run_position_repeat
    (run_id, position_key, repeat_index, depth, time_limit_ms),
  KEY ix_benchmark_cases_workload (workload_class, position_key),
  KEY ix_benchmark_cases_completed_depth (completed, depth),
  CONSTRAINT ck_benchmark_cases_tt_hit_rate
    CHECK (tt_hit_rate IS NULL OR (tt_hit_rate >= 0 AND tt_hit_rate <= 1)),
  CONSTRAINT fk_benchmark_cases_run
    FOREIGN KEY (run_id) REFERENCES benchmark_runs (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE benchmark_findings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id BIGINT UNSIGNED NOT NULL,
  category VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  title VARCHAR(255) NOT NULL,
  evidence_json JSON NOT NULL,
  recommendation TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_benchmark_findings_run_severity (run_id, severity),
  KEY ix_benchmark_findings_category_status (category, status),
  CONSTRAINT fk_benchmark_findings_run
    FOREIGN KEY (run_id) REFERENCES benchmark_runs (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

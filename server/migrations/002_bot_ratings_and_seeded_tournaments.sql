CREATE TABLE bot_ratings (
  bot_version_id BIGINT UNSIGNED NOT NULL,
  rating DECIMAL(10, 4) NOT NULL DEFAULT 1500.0000,
  games INT UNSIGNED NOT NULL DEFAULT 0,
  wins INT UNSIGNED NOT NULL DEFAULT 0,
  draws INT UNSIGNED NOT NULL DEFAULT 0,
  losses INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (bot_version_id),
  KEY ix_bot_ratings_rating (rating DESC, bot_version_id),
  CONSTRAINT ck_bot_ratings_rating CHECK (rating >= 0),
  CONSTRAINT fk_bot_ratings_version FOREIGN KEY (bot_version_id) REFERENCES bot_versions (id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE rating_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  match_id BIGINT UNSIGNED NOT NULL,
  player_one_version_id BIGINT UNSIGNED NOT NULL,
  player_two_version_id BIGINT UNSIGNED NOT NULL,
  player_one_score DECIMAL(5, 4) NOT NULL,
  player_one_rating_before DECIMAL(10, 4) NOT NULL,
  player_two_rating_before DECIMAL(10, 4) NOT NULL,
  player_one_rating_after DECIMAL(10, 4) NOT NULL,
  player_two_rating_after DECIMAL(10, 4) NOT NULL,
  k_factor DECIMAL(6, 2) NOT NULL,
  formula_version VARCHAR(50) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rating_events_match (match_id),
  KEY ix_rating_events_player_one (player_one_version_id, id),
  KEY ix_rating_events_player_two (player_two_version_id, id),
  CONSTRAINT ck_rating_events_score CHECK (player_one_score IN (0.0000, 0.5000, 1.0000)),
  CONSTRAINT fk_rating_events_match FOREIGN KEY (match_id) REFERENCES matches (id),
  CONSTRAINT fk_rating_events_player_one FOREIGN KEY (player_one_version_id) REFERENCES bot_versions (id),
  CONSTRAINT fk_rating_events_player_two FOREIGN KEY (player_two_version_id) REFERENCES bot_versions (id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE tournaments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(255) NOT NULL,
  format_key VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL,
  participant_count INT UNSIGNED NOT NULL,
  games_per_pairing INT UNSIGNED NOT NULL,
  current_round INT UNSIGNED NOT NULL DEFAULT 0,
  champion_entry_id BIGINT UNSIGNED NULL,
  settings_json JSON NOT NULL,
  started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournaments_public_id (public_id),
  KEY ix_tournaments_status_started (status, started_at),
  CONSTRAINT ck_tournaments_participant_count CHECK (participant_count >= 2),
  CONSTRAINT ck_tournaments_games_per_pairing CHECK (games_per_pairing BETWEEN 1 AND 20)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE tournament_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tournament_id BIGINT UNSIGNED NOT NULL,
  bot_version_id BIGINT UNSIGNED NOT NULL,
  seed_number INT UNSIGNED NOT NULL,
  seed_group INT UNSIGNED NOT NULL,
  seed_rating DECIMAL(10, 4) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  eliminated_round INT UNSIGNED NULL,
  final_place INT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_entries_public_id (public_id),
  UNIQUE KEY uq_tournament_entries_version (tournament_id, bot_version_id),
  UNIQUE KEY uq_tournament_entries_seed (tournament_id, seed_number),
  KEY ix_tournament_entries_status_seed (tournament_id, status, seed_number),
  CONSTRAINT ck_tournament_entries_seed_group CHECK (seed_group BETWEEN 1 AND 4),
  CONSTRAINT fk_tournament_entries_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments (id),
  CONSTRAINT fk_tournament_entries_version FOREIGN KEY (bot_version_id) REFERENCES bot_versions (id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE tournament_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tournament_id BIGINT UNSIGNED NOT NULL,
  round_number INT UNSIGNED NOT NULL,
  status VARCHAR(30) NOT NULL,
  started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_rounds_public_id (public_id),
  UNIQUE KEY uq_tournament_rounds_number (tournament_id, round_number),
  CONSTRAINT fk_tournament_rounds_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments (id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE tournament_pairings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  round_id BIGINT UNSIGNED NOT NULL,
  pairing_index INT UNSIGNED NOT NULL,
  entry_one_id BIGINT UNSIGNED NOT NULL,
  entry_two_id BIGINT UNSIGNED NULL,
  winner_entry_id BIGINT UNSIGNED NULL,
  entry_one_score DECIMAL(6, 2) NOT NULL DEFAULT 0,
  entry_two_score DECIMAL(6, 2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL,
  advance_reason VARCHAR(50) NULL,
  started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_pairings_public_id (public_id),
  UNIQUE KEY uq_tournament_pairings_index (round_id, pairing_index),
  KEY ix_tournament_pairings_entries (entry_one_id, entry_two_id),
  CONSTRAINT fk_tournament_pairings_round FOREIGN KEY (round_id) REFERENCES tournament_rounds (id),
  CONSTRAINT fk_tournament_pairings_entry_one FOREIGN KEY (entry_one_id) REFERENCES tournament_entries (id),
  CONSTRAINT fk_tournament_pairings_entry_two FOREIGN KEY (entry_two_id) REFERENCES tournament_entries (id),
  CONSTRAINT fk_tournament_pairings_winner FOREIGN KEY (winner_entry_id) REFERENCES tournament_entries (id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

ALTER TABLE tournaments
  ADD CONSTRAINT fk_tournaments_champion_entry
  FOREIGN KEY (champion_entry_id) REFERENCES tournament_entries (id);

ALTER TABLE match_series
  ADD COLUMN tournament_pairing_id BIGINT UNSIGNED NULL AFTER bot_two_version_id,
  ADD COLUMN tournament_game_index INT UNSIGNED NULL AFTER tournament_pairing_id,
  ADD UNIQUE KEY uq_match_series_tournament_game (tournament_pairing_id, tournament_game_index),
  ADD CONSTRAINT fk_match_series_tournament_pairing
    FOREIGN KEY (tournament_pairing_id) REFERENCES tournament_pairings (id);

-- =============================================================================
-- Aurai Forecast — consolidated MySQL/MariaDB schema
-- =============================================================================
-- This is the live schema the PHP API in /api runs against. Apply it once:
--
--   C:\xampp\mysql\bin\mysql.exe -u root < database/schema.sql
--
-- The same statements are split into ordered, individually-runnable files
-- under database/migrations/ — use whichever suits your workflow. See
-- /docs/DATA-MODEL.md for the entity reference and /docs/PHP-MIGRATION.md for
-- why the schema is shaped the way it is (it was translated from an earlier
-- Supabase/Postgres version of this app).
--
-- Requirements:
--   - MySQL 8.0.13+ or MariaDB 10.2.1+ (needed for JSON columns and
--     expression-based DEFAULT values, e.g. `DEFAULT (JSON_OBJECT())`).
--     If you're on an older server, drop the DEFAULT clause on JSON columns
--     and always supply an explicit value ('{}' / '[]') from the application.
--   - InnoDB (for foreign keys) — this is the default engine on any XAMPP
--     install, so no action needed unless it's been changed.
--
-- Primary keys are CHAR(36) UUIDs (v4). MySQL cannot portably generate UUIDs
-- as a column DEFAULT, so the application generates one *before* every INSERT
-- (see uuid4() in api/lib/helpers.php).
--
-- Authorization note: there is no row-level security in MySQL, so every query
-- the PHP API runs against these tables MUST filter by the authenticated
-- user's id explicitly. See /docs/AUTHENTICATION.md.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `aurai_forecast`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `aurai_forecast`;

-- -----------------------------------------------------------------------------
-- users — login credentials. Passwords are hashed with PHP's password_hash().
-- -----------------------------------------------------------------------------
CREATE TABLE `users` (
  `id` CHAR(36) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `email_verified_at` DATETIME NULL,
  `remember_token` VARCHAR(100) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- password_reset_tokens — backs the /forgot-password -> /reset-password flow.
-- Stores a hash of the token, never the token itself. Looked up by email,
-- single-use, and expires after an hour.
-- -----------------------------------------------------------------------------
CREATE TABLE `password_reset_tokens` (
  `email` VARCHAR(255) NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- login_attempts — rate-limits password guessing. One row per email + client
-- IP, so an attacker cannot lock a victim out of their own account from a
-- different address. Keyed by a hash, so no email or IP is stored in the clear.
-- -----------------------------------------------------------------------------
CREATE TABLE `login_attempts` (
  `id` CHAR(64) NOT NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `last_attempt_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `login_attempts_last_attempt_idx` (`last_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- sessions — server-side bearer-token store. One row per active login,
-- holding a SHA-256 hash of the token. Rows are rejected once expires_at
-- passes, but nothing prunes them yet — see /api/README.md.
-- -----------------------------------------------------------------------------
CREATE TABLE `sessions` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(500) NULL,
  `last_used_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sessions_token_hash_unique` (`token_hash`),
  KEY `sessions_user_id_idx` (`user_id`),
  CONSTRAINT `sessions_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- profiles — display data, separate from login credentials.
-- One row per user, auto-created by the trigger at the end of this file.
-- -----------------------------------------------------------------------------
CREATE TABLE `profiles` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NULL,
  `email` VARCHAR(255) NULL,
  `avatar_url` VARCHAR(500) NULL,
  `plan` VARCHAR(50) NOT NULL DEFAULT 'free',
  `preferences` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `profiles_id_fk` FOREIGN KEY (`id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- user_settings — per-user preferences, written by the /settings page via the
-- /settings endpoint. Drives the sidebar name, the glass blur and the
-- Predictions wizard's defaults.
-- -----------------------------------------------------------------------------
CREATE TABLE `user_settings` (
  `user_id` CHAR(36) NOT NULL,
  `prefs` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_settings_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- datasets — `rows` holds the parsed dataset inline as JSON, so a dataset is
-- a single row here. `storage_path` is reserved for a real file-upload flow
-- and is not populated today.
-- -----------------------------------------------------------------------------
CREATE TABLE `datasets` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `rows` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `meta` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `storage_path` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `datasets_user_created_idx` (`user_id`, `created_at` DESC),
  CONSTRAINT `datasets_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- predictions — `forecast` comes from the Prophet service in backend/Python,
-- via the /forecast endpoint; `model_name` points at the saved .pkl model.
-- `regressors` holds JSON configuration of exogenous variables used in the model.
-- -----------------------------------------------------------------------------
CREATE TABLE `predictions` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `dataset_id` CHAR(36) NULL,
  `name` VARCHAR(255) NOT NULL,
  `target` VARCHAR(255) NULL,
  `horizon` INT NULL,
  `period` VARCHAR(50) NULL,
  `algorithm` VARCHAR(100) NULL,
  -- Identifies the trained Prophet model in backend/Python/models that
  -- produced this forecast; NULL for forecasts not from a trained model.
  `model_name` VARCHAR(255) NULL,
  `accuracy` DECIMAL(5,2) NULL,
  `forecast` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  -- JSON array of regressor configurations used in this forecast:
  -- [{"name": "marketing_spend", "column": "marketing", "description": "...", "include_future": true}, ...]
  `regressors` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `predictions_user_created_idx` (`user_id`, `created_at` DESC),
  KEY `predictions_dataset_id_idx` (`dataset_id`),
  CONSTRAINT `predictions_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `predictions_dataset_id_fk` FOREIGN KEY (`dataset_id`) REFERENCES `datasets` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- reports — `body` is HTML produced by the contentEditable report editor and
-- rendered back into it, so treat it as untrusted when displaying elsewhere.
-- -----------------------------------------------------------------------------
CREATE TABLE `reports` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `title` VARCHAR(255) NOT NULL DEFAULT 'Untitled report',
  `body` LONGTEXT NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `reports_user_updated_idx` (`user_id`, `updated_at` DESC),
  CONSTRAINT `reports_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- conversations — Aurai chat threads, one per conversation in the sidebar.
-- -----------------------------------------------------------------------------
CREATE TABLE `conversations` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `title` VARCHAR(255) NOT NULL DEFAULT 'New chat',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `conversations_user_updated_idx` (`user_id`, `updated_at` DESC),
  CONSTRAINT `conversations_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- messages — chat turns. Assistant replies come from the /assistant endpoint,
-- which answers from SQL over the user's own rows rather than an LLM.
-- -----------------------------------------------------------------------------
-- `seq` gives messages a monotonic insertion order. `created_at` is only
-- second-precision, so a user message and an instant assistant reply share a
-- timestamp and cannot be ordered by it reliably.
CREATE TABLE `messages` (
  `id` CHAR(36) NOT NULL,
  `seq` BIGINT NOT NULL AUTO_INCREMENT,
  `conversation_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `role` VARCHAR(20) NOT NULL,
  `content` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `messages_seq_unique` (`seq`),
  KEY `messages_conversation_seq_idx` (`conversation_id`, `seq`),
  CONSTRAINT `messages_conversation_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `messages_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `messages_role_check` CHECK (`role` IN ('user', 'assistant', 'system'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- insights — the written business advice for a forecast, kept so the Business
-- Insights page reads it back instead of generating it again. A forecast is
-- immutable once saved, so its advice stays correct until the user asks for a
-- fresh one. See migrations/0013 for why this is worth storing.
-- -----------------------------------------------------------------------------
CREATE TABLE `insights` (
  `prediction_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `advice` MEDIUMTEXT NOT NULL,
  `reasoned` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`prediction_id`),
  KEY `insights_user_id_idx` (`user_id`),
  CONSTRAINT `insights_prediction_id_fk` FOREIGN KEY (`prediction_id`) REFERENCES `predictions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `insights_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- anomalies — flagged deviations when actual data strays beyond forecast bounds.
-- Tracks when actual values fall outside the forecast confidence interval.
CREATE TABLE `anomalies` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `prediction_id` CHAR(36) NOT NULL,
  `date` DATE NOT NULL,
  `actual_value` DECIMAL(15,2) NOT NULL,
  `forecasted_value` DECIMAL(15,2) NOT NULL,
  `lower_bound` DECIMAL(15,2) NOT NULL,
  `upper_bound` DECIMAL(15,2) NOT NULL,
  `deviation_sigma` DECIMAL(5,2) NOT NULL,
  `anomaly_type` ENUM('above_upper', 'below_lower', 'within_bounds') NOT NULL,
  `note` TEXT NULL,
  `acknowledged` BOOLEAN DEFAULT FALSE,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `anomalies_user_created_idx` (`user_id`, `created_at` DESC),
  KEY `anomalies_prediction_date_idx` (`prediction_id`, `date`),
  CONSTRAINT `anomalies_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `anomalies_prediction_id_fk` FOREIGN KEY (`prediction_id`) REFERENCES `predictions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- scenarios — what-if analysis with adjusted forecast points.
-- Allows users to explore alternative futures by modifying forecast values.
CREATE TABLE `scenarios` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `prediction_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Scenario',
  `description` TEXT NULL,
  `adjustments` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `results` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `is_baseline` BOOLEAN DEFAULT FALSE,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `scenarios_user_created_idx` (`user_id`, `created_at` DESC),
  KEY `scenarios_prediction_id_idx` (`prediction_id`),
  CONSTRAINT `scenarios_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `scenarios_prediction_id_fk` FOREIGN KEY (`prediction_id`) REFERENCES `predictions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- scenario_comparisons — compare multiple scenarios side by side.
CREATE TABLE `scenario_comparisons` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Comparison',
  `scenario_ids` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `scenario_comparisons_user_created_idx` (`user_id`, `created_at` DESC),
  CONSTRAINT `scenario_comparisons_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- workspaces — collaborative spaces for teams with RBAC
CREATE TABLE `workspaces` (
  `id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT 'My Workspace',
  `description` TEXT NULL,
  `settings` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `workspaces_owner_id_idx` (`owner_id`),
  CONSTRAINT `workspaces_owner_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- workspace_members — team members with role-based access
CREATE TABLE `workspace_members` (
  `id` CHAR(36) NOT NULL,
  `workspace_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `role` ENUM('owner', 'editor', 'viewer', 'commenter') NOT NULL DEFAULT 'viewer',
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `invited_by` CHAR(36) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `workspace_members_workspace_user_unique` (`workspace_id`, `user_id`),
  KEY `workspace_members_user_id_idx` (`user_id`),
  KEY `workspace_members_role_idx` (`role`),
  CONSTRAINT `workspace_members_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `workspace_members_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `workspace_members_invited_by_fk` FOREIGN KEY (`invited_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- workspace_audit_log — track all workspace activity
CREATE TABLE `workspace_audit_log` (
  `id` CHAR(36) NOT NULL,
  `workspace_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `action` VARCHAR(100) NOT NULL,
  `details` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `workspace_audit_log_workspace_created_idx` (`workspace_id`, `created_at` DESC),
  KEY `workspace_audit_log_user_id_idx` (`user_id`),
  CONSTRAINT `workspace_audit_log_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `workspace_audit_log_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- workspace_invites — invite tokens for joining workspaces
CREATE TABLE `workspace_invites` (
  `id` CHAR(36) NOT NULL,
  `workspace_id` CHAR(36) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `role` ENUM('owner', 'editor', 'viewer', 'commenter') NOT NULL DEFAULT 'viewer',
  `token_hash` VARCHAR(255) NOT NULL,
  `invited_by` CHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `accepted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `workspace_invites_token_hash_unique` (`token_hash`),
  KEY `workspace_invites_workspace_email_idx` (`workspace_id`, `email`),
  KEY `workspace_invites_expires_at_idx` (`expires_at`),
  CONSTRAINT `workspace_invites_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `workspace_invites_invited_by_fk` FOREIGN KEY (`invited_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Update existing tables to include workspace_id for resource sharing
ALTER TABLE `datasets` ADD COLUMN `workspace_id` CHAR(36) NULL;
ALTER TABLE `datasets` ADD KEY `datasets_workspace_id_idx` (`workspace_id`);
ALTER TABLE `datasets` ADD CONSTRAINT `datasets_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE;

ALTER TABLE `predictions` ADD COLUMN `workspace_id` CHAR(36) NULL;
ALTER TABLE `predictions` ADD KEY `predictions_workspace_id_idx` (`workspace_id`);
ALTER TABLE `predictions` ADD CONSTRAINT `predictions_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE;

ALTER TABLE `reports` ADD COLUMN `workspace_id` CHAR(36) NULL;
ALTER TABLE `reports` ADD KEY `reports_workspace_id_idx` (`workspace_id`);
ALTER TABLE `reports` ADD CONSTRAINT `reports_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE;

ALTER TABLE `conversations` ADD COLUMN `workspace_id` CHAR(36) NULL;
ALTER TABLE `conversations` ADD KEY `conversations_workspace_id_idx` (`workspace_id`);
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- Auto-provisioning trigger — creates the matching profiles, user_settings,
-- and default workspace rows whenever a user registers.
-- -----------------------------------------------------------------------------
DELIMITER $$

CREATE TRIGGER `users_after_insert`
AFTER INSERT ON `users`
FOR EACH ROW
BEGIN
  DECLARE workspace_id CHAR(36);
  SET workspace_id = UUID();

  INSERT INTO `profiles` (`id`, `email`) VALUES (NEW.`id`, NEW.`email`);
  INSERT INTO `user_settings` (`user_id`) VALUES (NEW.`id`);
  INSERT INTO `workspaces` (`id`, `owner_id`, `name`, `description`)
    VALUES (workspace_id, NEW.`id`, 'Personal', 'Your personal workspace');
  INSERT INTO `workspace_members` (`id`, `workspace_id`, `user_id`, `role`, `invited_by`)
    VALUES (UUID(), workspace_id, NEW.`id`, 'owner', NULL);
END$$

DELIMITER ;

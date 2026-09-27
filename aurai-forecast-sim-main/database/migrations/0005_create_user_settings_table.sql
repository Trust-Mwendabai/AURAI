-- Per-user preferences, read and written by the /settings page through the
-- /settings endpoint. Drives the sidebar name, the glass blur and the
-- Predictions wizard's defaults.

CREATE TABLE `user_settings` (
  `user_id` CHAR(36) NOT NULL,
  `prefs` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_settings_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

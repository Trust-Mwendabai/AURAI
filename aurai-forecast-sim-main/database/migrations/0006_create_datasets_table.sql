-- `rows` holds the parsed dataset inline
-- as JSON (current app behavior); `storage_path` is reserved for a future
-- real file-upload flow and is not populated by the app today.

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

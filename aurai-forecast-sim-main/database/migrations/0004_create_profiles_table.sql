-- Display data, separate from
-- login credentials. One row per user, auto-created by the trigger in
-- migration 0011.

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

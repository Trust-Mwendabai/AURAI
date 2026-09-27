-- Rate-limits password guessing. One row per email + client IP, so an attacker
-- cannot lock a victim out of their own account from a different address.
-- Rows are keyed by a hash, so no email or IP is stored in the clear.

CREATE TABLE `login_attempts` (
  `id` CHAR(64) NOT NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `last_attempt_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `login_attempts_last_attempt_idx` (`last_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

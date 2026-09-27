-- Stores the written business advice for a forecast so opening the Business
-- Insights page reads it back rather than generating it again.
--
-- Regenerating is expensive in the one way that matters: the Gemini free tier
-- allows 20 requests per model per day, so a page that re-asked on every visit
-- would exhaust the quota within an afternoon and spend the rest of it serving
-- the fallback. A forecast is immutable once saved — its points and accuracy
-- never change — so advice about it stays correct indefinitely, and the only
-- reason to regenerate is that the user asked.
--
-- One row per forecast. `reasoned` records which writer produced it, so the
-- page can say so without inferring it from the prose.

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

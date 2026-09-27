-- `forecast` comes from the Prophet service in backend/Python via the
-- /forecast endpoint; `model_name` points at the saved .pkl that produced it.

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
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `predictions_user_created_idx` (`user_id`, `created_at` DESC),
  KEY `predictions_dataset_id_idx` (`dataset_id`),
  CONSTRAINT `predictions_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `predictions_dataset_id_fk` FOREIGN KEY (`dataset_id`) REFERENCES `datasets` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Chat turns. Assistant replies come from the /assistant endpoint, which
-- answers from SQL over the user's own rows rather than an LLM.

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

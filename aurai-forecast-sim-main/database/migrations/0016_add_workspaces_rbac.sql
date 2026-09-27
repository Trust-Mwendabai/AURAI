-- =============================================================================
-- Migration: Add workspaces and RBAC (role-based access control)
-- =============================================================================
-- Enables multi-user collaboration with role-based permissions.
-- Users can create workspaces, invite team members with specific roles,
-- and control access to datasets, forecasts, and reports.
-- =============================================================================

-- Workspaces — collaborative spaces for teams
CREATE TABLE `workspaces` (
  `id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT 'My Workspace',
  `description` TEXT NULL,
  -- JSON object with workspace settings: { "theme": "dark", "defaultRole": "viewer", ... }
  `settings` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `workspaces_owner_id_idx` (`owner_id`),
  CONSTRAINT `workspaces_owner_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workspace members with role-based access
CREATE TABLE `workspace_members` (
  `id` CHAR(36) NOT NULL,
  `workspace_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  -- Role: owner (full control), editor (create/edit), viewer (read-only), commenter (view + comment)
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

-- Audit log for workspace activity
CREATE TABLE `workspace_audit_log` (
  `id` CHAR(36) NOT NULL,
  `workspace_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `action` VARCHAR(100) NOT NULL,
  -- JSON object with action details: { "resourceType": "dataset", "resourceId": "...", "changes": {...} }
  `details` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `workspace_audit_log_workspace_created_idx` (`workspace_id`, `created_at` DESC),
  KEY `workspace_audit_log_user_id_idx` (`user_id`),
  CONSTRAINT `workspace_audit_log_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `workspace_audit_log_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add workspace reference to existing tables
-- (These columns are added to datasets, predictions, reports, conversations tables)
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

-- Invite tokens for joining workspaces by email
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

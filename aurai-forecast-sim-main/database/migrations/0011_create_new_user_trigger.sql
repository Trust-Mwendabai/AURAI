-- Auto-provisioning trigger.
-- Creates a matching profiles + user_settings row whenever a user registers.
-- Alternative: skip this trigger and instead insert all three rows inside a
-- single PHP-side transaction on registration — either approach is fine, but
-- pick one so a user can never end up without a profiles/user_settings row.

DELIMITER $$

CREATE TRIGGER `users_after_insert`
AFTER INSERT ON `users`
FOR EACH ROW
BEGIN
  INSERT INTO `profiles` (`id`, `email`) VALUES (NEW.`id`, NEW.`email`);
  INSERT INTO `user_settings` (`user_id`) VALUES (NEW.`id`);
END$$

DELIMITER ;

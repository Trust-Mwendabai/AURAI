<?php
require_once __DIR__ . '/lib/helpers.php';

function auth_register(): void {
    $b = json_input();
    $email = trim((string)($b['email'] ?? ''));
    $password = (string)($b['password'] ?? '');
    $name = trim((string)($b['name'] ?? ''));
    if (!$email || !$password) fail('Email and password are required');
    if (strlen($password) < 6) fail('Password must be at least 6 characters');

    $stmt = db()->prepare('SELECT id FROM users WHERE email = :e');
    $stmt->execute([':e' => $email]);
    if ($stmt->fetch()) fail('An account with this email already exists', 409);

    $id = uuid4();
    db()->prepare('INSERT INTO users (id, email, password_hash) VALUES (:id, :email, :hash)')
        ->execute([':id' => $id, ':email' => $email, ':hash' => password_hash($password, PASSWORD_DEFAULT)]);

    if ($name !== '') {
        db()->prepare('UPDATE profiles SET name = :name WHERE id = :id')->execute([':name' => $name, ':id' => $id]);
    }

    $token = create_session($id);
    respond(['token' => $token, 'user' => public_user($id)], 201);
}

function auth_login(): void {
    $b = json_input();
    $email = trim((string)($b['email'] ?? ''));
    $password = (string)($b['password'] ?? '');
    if (!$email || !$password) fail('Email and password are required');

    throttle_check($email);

    $stmt = db()->prepare('SELECT id, password_hash FROM users WHERE email = :e');
    $stmt->execute([':e' => $email]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($password, $row['password_hash'])) {
        throttle_record_failure($email);
        fail('Invalid email or password', 401);
    }

    throttle_clear($email);
    prune_expired_sessions();
    $token = create_session($row['id']);
    respond(['token' => $token, 'user' => public_user($row['id'])]);
}

function auth_logout(): void {
    $token = bearer_token();
    if ($token) {
        db()->prepare('DELETE FROM sessions WHERE token_hash = :h')->execute([':h' => hash('sha256', $token)]);
    }
    respond(['ok' => true]);
}

function auth_me(): void {
    $userId = require_auth();
    respond(['user' => public_user($userId)]);
}

function auth_update_profile(): void {
    $userId = require_auth();
    $b = json_input();

    $fields = [];
    $params = [':id' => $userId];
    if (isset($b['name'])) { $fields[] = 'name = :name'; $params[':name'] = $b['name']; }
    if (isset($b['avatar_url'])) { $fields[] = 'avatar_url = :avatar_url'; $params[':avatar_url'] = $b['avatar_url']; }
    if (isset($b['plan'])) { $fields[] = 'plan = :plan'; $params[':plan'] = $b['plan']; }
    if (isset($b['preferences'])) { $fields[] = 'preferences = :preferences'; $params[':preferences'] = json_encode($b['preferences']); }
    if ($fields) {
        db()->prepare('UPDATE profiles SET ' . implode(', ', $fields) . ' WHERE id = :id')->execute($params);
    }

    if (!empty($b['email'])) {
        $stmt = db()->prepare('SELECT id FROM users WHERE email = :e AND id != :id');
        $stmt->execute([':e' => $b['email'], ':id' => $userId]);
        if ($stmt->fetch()) fail('Email already in use', 409);
        db()->prepare('UPDATE users SET email = :e WHERE id = :id')->execute([':e' => $b['email'], ':id' => $userId]);
        db()->prepare('UPDATE profiles SET email = :e WHERE id = :id')->execute([':e' => $b['email'], ':id' => $userId]);
    }
    if (!empty($b['password'])) {
        if (strlen($b['password']) < 6) fail('Password must be at least 6 characters');
        db()->prepare('UPDATE users SET password_hash = :h WHERE id = :id')
            ->execute([':h' => password_hash($b['password'], PASSWORD_DEFAULT), ':id' => $userId]);
    }

    respond(['user' => public_user($userId)]);
}

function auth_forgot_password(): void {
    $b = json_input();
    $email = trim((string)($b['email'] ?? ''));
    if (!$email) fail('Email is required');

    $stmt = db()->prepare('SELECT id FROM users WHERE email = :e');
    $stmt->execute([':e' => $email]);
    if ($stmt->fetch()) {
        $token = bin2hex(random_bytes(32));
        db()->prepare(
            'REPLACE INTO password_reset_tokens (email, token_hash, expires_at) VALUES (:e, :h, :exp)'
        )->execute([
            ':e' => $email,
            ':h' => hash('sha256', $token),
            ':exp' => date('Y-m-d H:i:s', time() + 3600),
        ]);
        // In production this token would be emailed to the user rather than returned.
    }
    // Always respond ok, regardless of whether the email exists, to avoid leaking account existence.
    respond(['ok' => true]);
}

function auth_reset_password(): void {
    $b = json_input();
    $email = trim((string)($b['email'] ?? ''));
    $token = (string)($b['token'] ?? '');
    $password = (string)($b['password'] ?? '');
    if (!$email || !$token || !$password) fail('Email, token and password are required');
    if (strlen($password) < 6) fail('Password must be at least 6 characters');

    $stmt = db()->prepare('SELECT token_hash, expires_at FROM password_reset_tokens WHERE email = :e');
    $stmt->execute([':e' => $email]);
    $row = $stmt->fetch();
    if (!$row || !hash_equals($row['token_hash'], hash('sha256', $token))) fail('Invalid or expired token', 401);
    if (strtotime($row['expires_at']) < time()) fail('Invalid or expired token', 401);

    db()->prepare('UPDATE users SET password_hash = :h WHERE email = :e')
        ->execute([':h' => password_hash($password, PASSWORD_DEFAULT), ':e' => $email]);
    db()->prepare('DELETE FROM password_reset_tokens WHERE email = :e')->execute([':e' => $email]);
    respond(['ok' => true]);
}

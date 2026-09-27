<?php
require_once __DIR__ . '/../config.php';

function uuid4(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function json_input(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function respond($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function fail(string $message, int $status = 400): void {
    respond(['error' => $message], $status);
}

function bearer_token(): ?string {
    // Apache may expose the header under REDIRECT_ (after the .htaccess
    // rewrite) or only via apache_request_headers(), so check all three.
    $header = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';
    if (!$header && function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) { $header = $value; break; }
        }
    }
    if (preg_match('/Bearer\s+(\S+)/i', $header, $m)) return $m[1];
    return null;
}

// Validates the bearer token and returns the authenticated user id, or fails with 401.
function require_auth(): string {
    $token = bearer_token();
    if (!$token) fail('Not authenticated', 401);
    $tokenHash = hash('sha256', $token);
    $stmt = db()->prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = :h');
    $stmt->execute([':h' => $tokenHash]);
    $row = $stmt->fetch();
    if (!$row) fail('Invalid session', 401);
    if (strtotime($row['expires_at']) < time()) fail('Session expired', 401);
    db()->prepare('UPDATE sessions SET last_used_at = NOW() WHERE token_hash = :h')->execute([':h' => $tokenHash]);
    return $row['user_id'];
}

// --- Login throttling -------------------------------------------------------
// Slows down password guessing. Attempts are counted per email + IP, so one
// attacker cannot lock a victim out of their own account from elsewhere.

const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_LOCKOUT_SECONDS = 900;

function throttle_key(string $email): string {
    return hash('sha256', strtolower($email) . '|' . ($_SERVER['REMOTE_ADDR'] ?? ''));
}

function throttle_check(string $email): void {
    $stmt = db()->prepare('SELECT attempts, last_attempt_at FROM login_attempts WHERE id = :k');
    $stmt->execute([':k' => throttle_key($email)]);
    $row = $stmt->fetch();
    if (!$row) return;

    $elapsed = time() - strtotime($row['last_attempt_at']);
    if ($elapsed >= LOGIN_LOCKOUT_SECONDS) return;
    if ((int)$row['attempts'] < LOGIN_MAX_ATTEMPTS) return;

    $wait = (int)ceil((LOGIN_LOCKOUT_SECONDS - $elapsed) / 60);
    fail("Too many failed sign-in attempts. Try again in about {$wait} minute" . ($wait === 1 ? '' : 's') . '.', 429);
}

function throttle_record_failure(string $email): void {
    db()->prepare(
        'INSERT INTO login_attempts (id, attempts, last_attempt_at) VALUES (:k, 1, NOW())
         ON DUPLICATE KEY UPDATE
           attempts = IF(last_attempt_at < (NOW() - INTERVAL ' . LOGIN_LOCKOUT_SECONDS . ' SECOND), 1, attempts + 1),
           last_attempt_at = NOW()'
    )->execute([':k' => throttle_key($email)]);
}

function throttle_clear(string $email): void {
    db()->prepare('DELETE FROM login_attempts WHERE id = :k')->execute([':k' => throttle_key($email)]);
}

// Expired sessions are rejected at auth time; this stops them accumulating.
// Called on login, which is rare enough to be a sensible moment for it.
function prune_expired_sessions(): void {
    db()->exec('DELETE FROM sessions WHERE expires_at < NOW()');
    db()->exec('DELETE FROM password_reset_tokens WHERE expires_at < NOW()');
}

function create_session(string $userId): string {
    $token = bin2hex(random_bytes(32));
    $stmt = db()->prepare(
        'INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at)
         VALUES (:id, :uid, :hash, :ip, :ua, :exp)'
    );
    $stmt->execute([
        ':id' => uuid4(),
        ':uid' => $userId,
        ':hash' => hash('sha256', $token),
        ':ip' => $_SERVER['REMOTE_ADDR'] ?? null,
        ':ua' => $_SERVER['HTTP_USER_AGENT'] ?? null,
        ':exp' => date('Y-m-d H:i:s', time() + SESSION_TTL_DAYS * 86400),
    ]);
    return $token;
}

function public_user(string $userId): array {
    $stmt = db()->prepare(
        'SELECT u.id, u.email, p.name, p.avatar_url, p.plan, p.preferences
         FROM users u LEFT JOIN profiles p ON p.id = u.id WHERE u.id = :id'
    );
    $stmt->execute([':id' => $userId]);
    $row = $stmt->fetch();
    if (!$row) fail('User not found', 404);
    // Decoded as an object (not assoc) so an empty JSON object stays `{}` in the response.
    $row['preferences'] = $row['preferences'] ? json_decode($row['preferences']) : new stdClass();
    return $row;
}

// Picks the column whose values most consistently parse as dates.
function guess_date_column(array $rows, array $headers, string $target): ?string {
    $sample = array_slice($rows, 0, 20);
    $best = null;
    $bestScore = 0;
    foreach ($headers as $h) {
        if ($h === $target) continue;
        $hits = 0;
        foreach ($sample as $row) {
            $v = trim((string)($row[$h] ?? ''));
            if ($v === '') continue;
            // A bare 4-digit year counts; Prophet's cleaner handles it too.
            if (preg_match('/^\d{4}$/', $v) || strtotime($v) !== false) $hits++;
        }
        $score = count($sample) ? $hits / count($sample) : 0;
        if ($score > $bestScore) { $bestScore = $score; $best = $h; }
    }
    return $bestScore >= 0.6 ? $best : null;
}

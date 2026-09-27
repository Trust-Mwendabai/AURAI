<?php
require_once __DIR__ . '/lib/helpers.php';
require_once __DIR__ . '/lib/cache.php';

function row_dataset(array $r): array {
    $r['rows'] = json_decode($r['rows'] ?? '[]', true);
    $r['meta'] = json_decode($r['meta'] ?? '{}', true);
    return $r;
}

// ============ DATASETS ============
function datasets_list(string $userId): void {
    // Deliberately excludes `rows`: a dataset's parsed contents can be
    // megabytes, and listing them only needs the metadata. Fetch one dataset
    // by id to get its rows.
    $stmt = db()->prepare(
        'SELECT id, user_id, name, meta, storage_path, created_at, updated_at,
                JSON_LENGTH(`rows`) AS row_count
         FROM datasets WHERE user_id = :uid ORDER BY created_at DESC'
    );
    $stmt->execute([':uid' => $userId]);
    $out = [];
    foreach ($stmt->fetchAll() as $r) {
        $r['meta'] = json_decode($r['meta'] ?? '{}', true);
        $r['row_count'] = (int)$r['row_count'];
        $out[] = $r;
    }
    respond($out);
}

function datasets_get(string $userId, string $id): void {
    $stmt = db()->prepare('SELECT * FROM datasets WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $id, ':uid' => $userId]);
    $row = $stmt->fetch();
    respond($row ? row_dataset($row) : null);
}

function datasets_create(string $userId): void {
    $b = json_input();
    $id = uuid4();
    db()->prepare(
        // `rows` is a reserved word in MariaDB 10.4+, so it must stay backticked.
        'INSERT INTO datasets (id, user_id, name, `rows`, meta, storage_path) VALUES (:id, :uid, :name, :rows, :meta, :sp)'
    )->execute([
        ':id' => $id,
        ':uid' => $userId,
        ':name' => $b['name'] ?? 'Untitled',
        ':rows' => json_encode($b['rows'] ?? []),
        ':meta' => json_encode($b['meta'] ?? []),
        ':sp' => $b['storage_path'] ?? null,
    ]);
    respond(['id' => $id], 201);
}

function datasets_update(string $userId, string $id): void {
    $b = json_input();
    $fields = [];
    $params = [':id' => $id, ':uid' => $userId];
    if (isset($b['name'])) { $fields[] = 'name = :name'; $params[':name'] = $b['name']; }
    if (isset($b['rows'])) { $fields[] = '`rows` = :rows'; $params[':rows'] = json_encode($b['rows']); }
    if (isset($b['meta'])) { $fields[] = 'meta = :meta'; $params[':meta'] = json_encode($b['meta']); }
    if ($fields) {
        db()->prepare('UPDATE datasets SET ' . implode(', ', $fields) . ' WHERE id = :id AND user_id = :uid')->execute($params);
        // The rows changed (a clean-up, an append), so any cached forecast
        // for this dataset now describes data that no longer exists —
        // without this, a stale result could keep being served for up to
        // FORECAST_CACHE_TTL_HOURS after the edit.
        if (isset($b['rows'])) invalidate_dataset_cache($id);
    }
    respond(['ok' => true]);
}

function datasets_delete(string $userId, string $id): void {
    db()->prepare('DELETE FROM datasets WHERE id = :id AND user_id = :uid')->execute([':id' => $id, ':uid' => $userId]);
    respond(['ok' => true]);
}

// ============ PREDICTIONS ============
function row_prediction(array $r): array {
    $r['forecast'] = json_decode($r['forecast'] ?? '[]', true);
    return $r;
}

// The recorded series a prediction's forecast continues from. Not stored on
// the prediction row itself — re-derived from the dataset's current rows
// (like insights_history_points() in assistant.php) so callers that render a
// chart (Dashboard, What-If) can draw the "history ends here" segment instead
// of a forecast that looks like it's floating with no past to anchor it.
// $datasetRowsById lets a caller with several predictions decode each
// dataset's `rows` JSON once rather than per-prediction.
function attach_history(array $predictions, string $userId, array $datasetRowsById = []): array {
    $missingIds = [];
    foreach ($predictions as $p) {
        if ($p['dataset_id'] && !array_key_exists($p['dataset_id'], $datasetRowsById)) {
            $missingIds[$p['dataset_id']] = true;
        }
    }
    if ($missingIds) {
        $ids = array_keys($missingIds);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = db()->prepare("SELECT id, `rows` FROM datasets WHERE user_id = ? AND id IN ($placeholders)");
        $stmt->execute(array_merge([$userId], $ids));
        foreach ($stmt->fetchAll() as $d) $datasetRowsById[$d['id']] = json_decode($d['rows'], true) ?: [];
    }

    foreach ($predictions as &$p) {
        $rows = $datasetRowsById[$p['dataset_id']] ?? [];
        $p['history'] = [];
        if ($rows && $p['target']) {
            $headers = array_keys($rows[0]);
            $dateColumn = guess_date_column($rows, $headers, $p['target']);
            if ($dateColumn) $p['history'] = history_points($rows, $dateColumn, $p['target']);
        }
    }
    return $predictions;
}

function predictions_list(string $userId): void {
    $stmt = db()->prepare('SELECT * FROM predictions WHERE user_id = :uid ORDER BY created_at DESC');
    $stmt->execute([':uid' => $userId]);
    respond(attach_history(array_map('row_prediction', $stmt->fetchAll()), $userId));
}

function predictions_create(string $userId): void {
    $b = json_input();
    $id = uuid4();
    db()->prepare(
        'INSERT INTO predictions (id, user_id, dataset_id, name, target, horizon, period, algorithm, model_name, accuracy, forecast)
         VALUES (:id, :uid, :dsid, :name, :target, :horizon, :period, :algo, :model, :accuracy, :forecast)'
    )->execute([
        ':id' => $id,
        ':uid' => $userId,
        ':dsid' => $b['datasetId'] ?? null,
        ':name' => $b['name'] ?? 'Untitled forecast',
        ':target' => $b['target'] ?? null,
        ':horizon' => $b['horizon'] ?? null,
        ':period' => $b['period'] ?? null,
        ':algo' => $b['algorithm'] ?? null,
        ':model' => $b['modelName'] ?? null,
        ':accuracy' => $b['accuracy'] ?? null,
        ':forecast' => json_encode($b['forecast'] ?? []),
    ]);
    respond(['id' => $id], 201);
}

function predictions_delete(string $userId, string $id): void {
    db()->prepare('DELETE FROM predictions WHERE id = :id AND user_id = :uid')->execute([':id' => $id, ':uid' => $userId]);
    respond(['ok' => true]);
}

// ============ SETTINGS ============
function settings_get(string $userId): void {
    $stmt = db()->prepare('SELECT prefs FROM user_settings WHERE user_id = :uid');
    $stmt->execute([':uid' => $userId]);
    $row = $stmt->fetch();
    respond($row && $row['prefs'] ? json_decode($row['prefs']) : new stdClass());
}

function settings_save(string $userId): void {
    $prefs = json_input();
    db()->prepare(
        'INSERT INTO user_settings (user_id, prefs) VALUES (:uid, :prefs)
         ON DUPLICATE KEY UPDATE prefs = VALUES(prefs)'
    )->execute([':uid' => $userId, ':prefs' => json_encode($prefs)]);
    respond(['ok' => true]);
}

// ============ DASHBOARD STATS ============
// Aggregated server-side so the dashboard doesn't have to download every
// dataset's full `rows` payload just to count things.
function stats_get(string $userId): void {
    // No cron in this deployment (see schedules.php's header comment) — a
    // dashboard load is the most reliable moment a signed-in user's due
    // schedules will actually get checked, so it doubles as the trigger.
    if (!defined('AURAI_LIB_ONLY')) define('AURAI_LIB_ONLY', true);
    require_once __DIR__ . '/schedules.php';
    run_due_schedules($userId);

    // Native prepares can't reuse one named placeholder, so each subquery
    // gets its own.
    $stmt = db()->prepare(
        'SELECT
           (SELECT COUNT(*) FROM datasets WHERE user_id = :u1) AS datasets,
           (SELECT COUNT(*) FROM predictions WHERE user_id = :u2) AS predictions,
           (SELECT COUNT(*) FROM saved_reports WHERE user_id = :u3) AS reports,
           (SELECT AVG(accuracy) FROM predictions WHERE user_id = :u4 AND accuracy IS NOT NULL) AS avg_accuracy'
    );
    $stmt->execute([':u1' => $userId, ':u2' => $userId, ':u3' => $userId, ':u4' => $userId]);
    $counts = $stmt->fetch();

    // Total rows across all datasets, read from meta so we never load `rows`.
    $stmt = db()->prepare('SELECT JSON_LENGTH(`rows`) AS n FROM datasets WHERE user_id = :uid');
    $stmt->execute([':uid' => $userId]);
    $totalRows = 0;
    foreach ($stmt->fetchAll() as $r) $totalRows += (int)$r['n'];

    // Predictions per month for the last 12 months.
    $stmt = db()->prepare(
        "SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS n
         FROM predictions
         WHERE user_id = :uid AND created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
         GROUP BY month ORDER BY month"
    );
    $stmt->execute([':uid' => $userId]);
    $byMonth = $stmt->fetchAll();

    // The most recent forecast, for the headline chart.
    $stmt = db()->prepare(
        'SELECT id, name, dataset_id, target, algorithm, accuracy, period, horizon, forecast, created_at
         FROM predictions WHERE user_id = :uid ORDER BY created_at DESC LIMIT 1'
    );
    $stmt->execute([':uid' => $userId]);
    $latest = $stmt->fetch();
    if ($latest) {
        $latest['forecast'] = json_decode($latest['forecast'], true) ?: [];
        $latest = attach_history([$latest], $userId)[0];
    }

    $stmt = db()->prepare(
        'SELECT id, name, algorithm, accuracy, created_at FROM predictions
         WHERE user_id = :uid ORDER BY created_at DESC LIMIT 5'
    );
    $stmt->execute([':uid' => $userId]);

    respond([
        'datasets' => (int)$counts['datasets'],
        'predictions' => (int)$counts['predictions'],
        'reports' => (int)$counts['reports'],
        'avgAccuracy' => $counts['avg_accuracy'] !== null ? round((float)$counts['avg_accuracy'], 2) : null,
        'totalRows' => $totalRows,
        'byMonth' => $byMonth,
        'latest' => $latest ?: null,
        'recent' => $stmt->fetchAll(),
    ]);
}

// ============ REPORTS ============
function reports_list(string $userId): void {
    // Returns a plain-text excerpt rather than the stored HTML: the list only
    // needs a preview, and shipping the markup would invite the card to render
    // it. Fetch a report by id to edit its body.
    $stmt = db()->prepare(
        'SELECT id, user_id, title, created_at, updated_at, body
         FROM reports WHERE user_id = :uid ORDER BY updated_at DESC'
    );
    $stmt->execute([':uid' => $userId]);
    $out = [];
    foreach ($stmt->fetchAll() as $r) {
        $text = html_entity_decode(strip_tags((string)$r['body']), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = trim(preg_replace('/\s+/u', ' ', $text));
        $r['excerpt'] = mb_substr($text, 0, 200);
        unset($r['body']);
        $out[] = $r;
    }
    respond($out);
}

function reports_get(string $userId, string $id): void {
    $stmt = db()->prepare('SELECT * FROM reports WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $id, ':uid' => $userId]);
    respond($stmt->fetch() ?: null);
}

function reports_save(string $userId): void {
    $b = json_input();
    if (!empty($b['id'])) {
        db()->prepare('UPDATE reports SET title = :title, body = :body WHERE id = :id AND user_id = :uid')
            ->execute([
                ':title' => $b['title'] ?? 'Untitled report',
                ':body' => $b['body'] ?? '',
                ':id' => $b['id'],
                ':uid' => $userId,
            ]);
        respond(['id' => $b['id']]);
    }
    $id = uuid4();
    db()->prepare('INSERT INTO reports (id, user_id, title, body) VALUES (:id, :uid, :title, :body)')
        ->execute([
            ':id' => $id,
            ':uid' => $userId,
            ':title' => $b['title'] ?? 'Untitled report',
            ':body' => $b['body'] ?? '',
        ]);
    respond(['id' => $id], 201);
}

function reports_delete(string $userId, string $id): void {
    db()->prepare('DELETE FROM reports WHERE id = :id AND user_id = :uid')->execute([':id' => $id, ':uid' => $userId]);
    respond(['ok' => true]);
}

// ============ CONVERSATIONS / MESSAGES ============
function conversations_list(string $userId): void {
    $stmt = db()->prepare('SELECT * FROM conversations WHERE user_id = :uid ORDER BY updated_at DESC');
    $stmt->execute([':uid' => $userId]);
    respond($stmt->fetchAll());
}

function conversations_create(string $userId): void {
    $b = json_input();
    $id = uuid4();
    db()->prepare('INSERT INTO conversations (id, user_id, title) VALUES (:id, :uid, :title)')
        ->execute([':id' => $id, ':uid' => $userId, ':title' => $b['title'] ?? 'New chat']);
    respond(['id' => $id], 201);
}

function conversations_rename(string $userId, string $id): void {
    $b = json_input();
    db()->prepare('UPDATE conversations SET title = :title WHERE id = :id AND user_id = :uid')
        ->execute([':title' => $b['title'] ?? '', ':id' => $id, ':uid' => $userId]);
    respond(['ok' => true]);
}

function conversations_delete(string $userId, string $id): void {
    db()->prepare('DELETE FROM conversations WHERE id = :id AND user_id = :uid')->execute([':id' => $id, ':uid' => $userId]);
    respond(['ok' => true]);
}

function messages_list(string $userId, string $conversationId): void {
    $stmt = db()->prepare(
        'SELECT m.* FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id = :cid AND c.user_id = :uid
         ORDER BY m.seq ASC'
    );
    $stmt->execute([':cid' => $conversationId, ':uid' => $userId]);
    respond($stmt->fetchAll());
}

function messages_create(string $userId): void {
    $b = json_input();
    $conversationId = $b['conversationId'] ?? null;
    if (!$conversationId) fail('conversationId is required');

    $stmt = db()->prepare('SELECT id FROM conversations WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $conversationId, ':uid' => $userId]);
    if (!$stmt->fetch()) fail('Conversation not found', 404);

    $id = uuid4();
    db()->prepare('INSERT INTO messages (id, conversation_id, user_id, role, content) VALUES (:id, :cid, :uid, :role, :content)')
        ->execute([
            ':id' => $id,
            ':cid' => $conversationId,
            ':uid' => $userId,
            ':role' => $b['role'] ?? 'user',
            ':content' => $b['content'] ?? '',
        ]);
    db()->prepare('UPDATE conversations SET updated_at = NOW() WHERE id = :id')->execute([':id' => $conversationId]);
    respond(['id' => $id], 201);
}

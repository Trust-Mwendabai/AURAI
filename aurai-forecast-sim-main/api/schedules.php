<?php
/**
 * Scheduled forecast refreshes
 *
 * Endpoints:
 * - GET /schedules — list this user's schedules
 * - POST /schedules — create one
 * - PATCH /schedules/:id — update (rename, change cadence, enable/disable)
 * - DELETE /schedules/:id — delete
 * - POST /schedules/:id/run — run it right now, regardless of next_run_at
 *
 * There is no cron daemon in this XAMPP deployment, so due schedules are not
 * run by a background process — run_due_schedules() below is instead called
 * opportunistically from stats_get() (api/resources.php) whenever an
 * authenticated user's dashboard loads. A schedule only actually executes the
 * next time someone using the app is active; see the migration's own comment
 * (database/migrations/0020_add_scheduled_refreshes.sql) for why.
 */

require_once __DIR__ . '/lib/helpers.php';

const SCHEDULE_FREQUENCY_INTERVAL = [
    'daily' => 'P1D',
    'weekly' => 'P7D',
    'monthly' => 'P1M',
];

function schedule_next_run(string $frequency, ?DateTime $from = null): string {
    $dt = $from ? clone $from : new DateTime('now');
    $dt->add(new DateInterval(SCHEDULE_FREQUENCY_INTERVAL[$frequency] ?? 'P7D'));
    return $dt->format('Y-m-d H:i:s');
}

function row_schedule(array $r): array {
    $r['enabled'] = (bool)$r['enabled'];
    return $r;
}

function schedules_list(string $userId): void {
    $stmt = db()->prepare(
        'SELECT s.*, d.name AS dataset_name
         FROM scheduled_refreshes s
         LEFT JOIN datasets d ON d.id = s.dataset_id
         WHERE s.user_id = :uid
         ORDER BY s.created_at DESC'
    );
    $stmt->execute([':uid' => $userId]);
    respond(array_map('row_schedule', $stmt->fetchAll()));
}

function schedules_create(string $userId): void {
    $b = json_input();
    $datasetId = $b['datasetId'] ?? null;
    $target = $b['target'] ?? null;
    $name = trim((string)($b['name'] ?? ''));
    $frequency = in_array($b['frequency'] ?? '', ['daily', 'weekly', 'monthly'], true) ? $b['frequency'] : 'weekly';
    if (!$datasetId || !$target) fail('datasetId and target are required');

    $stmt = db()->prepare('SELECT id FROM datasets WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $datasetId, ':uid' => $userId]);
    if (!$stmt->fetch()) fail('Dataset not found', 404);

    $id = uuid4();
    db()->prepare(
        'INSERT INTO scheduled_refreshes
           (id, user_id, dataset_id, target, date_column, horizon, period, algorithm, name, frequency, enabled, next_run_at)
         VALUES (:id, :uid, :dsid, :target, :date_col, :horizon, :period, :algo, :name, :freq, 1, :next_run)'
    )->execute([
        ':id' => $id,
        ':uid' => $userId,
        ':dsid' => $datasetId,
        ':target' => $target,
        ':date_col' => $b['dateColumn'] ?? null,
        ':horizon' => max(1, min(365, (int)($b['horizon'] ?? 12))),
        ':period' => $b['period'] ?? 'Monthly',
        ':algo' => strtolower((string)($b['algorithm'] ?? 'prophet')),
        ':name' => $name !== '' ? $name : "$target refresh",
        ':freq' => $frequency,
        // Due immediately — the first run happens on whichever page load
        // notices it, giving the schedule a result right away rather than
        // making the user wait a full cycle to see it work at all.
        ':next_run' => (new DateTime('-1 second'))->format('Y-m-d H:i:s'),
    ]);
    respond(['id' => $id]);
}

function schedules_update(string $userId, string $id): void {
    $b = json_input();
    $stmt = db()->prepare('SELECT * FROM scheduled_refreshes WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $id, ':uid' => $userId]);
    $existing = $stmt->fetch();
    if (!$existing) fail('Schedule not found', 404);

    $fields = [];
    $params = [':id' => $id, ':uid' => $userId];
    foreach ([
        'name' => ':name', 'horizon' => ':horizon', 'period' => ':period',
        'algorithm' => ':algo', 'dateColumn' => ':date_col',
    ] as $key => $ph) {
        if (array_key_exists($key, $b)) {
            $col = $key === 'algorithm' ? 'algorithm' : ($key === 'dateColumn' ? 'date_column' : $key);
            $fields[] = "`$col` = $ph";
            $params[$ph] = $key === 'horizon' ? max(1, min(365, (int)$b[$key])) : $b[$key];
        }
    }
    if (array_key_exists('frequency', $b) && in_array($b['frequency'], ['daily', 'weekly', 'monthly'], true)) {
        $fields[] = 'frequency = :freq';
        $params[':freq'] = $b['frequency'];
    }
    if (array_key_exists('enabled', $b)) {
        $enabled = (bool)$b['enabled'];
        $fields[] = 'enabled = :enabled';
        $params[':enabled'] = $enabled ? 1 : 0;
        // Re-enabling a paused schedule makes it due again immediately,
        // same as a fresh create — otherwise it could sit disabled past its
        // old next_run_at and then silently skip straight to the one after.
        if ($enabled && !$existing['enabled']) {
            $fields[] = 'next_run_at = :next_run';
            $params[':next_run'] = (new DateTime('-1 second'))->format('Y-m-d H:i:s');
        }
    }
    if (!$fields) fail('Nothing to update');

    db()->prepare('UPDATE scheduled_refreshes SET ' . implode(', ', $fields) . ' WHERE id = :id AND user_id = :uid')
        ->execute($params);
    respond(['ok' => true]);
}

function schedules_delete(string $userId, string $id): void {
    db()->prepare('DELETE FROM scheduled_refreshes WHERE id = :id AND user_id = :uid')->execute([':id' => $id, ':uid' => $userId]);
    respond(['ok' => true]);
}

// Runs one schedule now: forecasts, saves it as a real prediction (exactly
// as if the user had clicked Run Prediction), auto-generates its report, and
// updates the schedule's run bookkeeping. Never throws — a failure is
// recorded on the row via last_error rather than raised, since a caller like
// run_due_schedules() is working through several schedules on someone else's
// request and one bad dataset must not stop the rest or the page that
// triggered this.
function run_one_schedule(array $schedule): void {
    $userId = $schedule['user_id'];
    $predictionId = null;
    $error = null;

    try {
        $result = compute_forecast(
            $userId,
            $schedule['dataset_id'],
            $schedule['target'],
            $schedule['date_column'],
            (int)$schedule['horizon'],
            $schedule['period'],
            [],
            $schedule['algorithm'] ?: 'prophet',
            null
        );

        $predictionId = uuid4();
        db()->prepare(
            'INSERT INTO predictions (id, user_id, dataset_id, name, target, horizon, period, algorithm, model_name, accuracy, forecast)
             VALUES (:id, :uid, :dsid, :name, :target, :horizon, :period, :algo, :model, :accuracy, :forecast)'
        )->execute([
            ':id' => $predictionId,
            ':uid' => $userId,
            ':dsid' => $schedule['dataset_id'],
            ':name' => $schedule['name'] . ' (scheduled)',
            ':target' => $schedule['target'],
            ':horizon' => $schedule['horizon'],
            ':period' => $schedule['period'],
            ':algo' => $result['model_type'] === 'prophet_model' ? 'Prophet' : ($schedule['algorithm'] ?: 'prophet'),
            ':model' => $result['model_name'] ?? null,
            ':accuracy' => $result['accuracy'] ?? null,
            ':forecast' => json_encode($result['forecast']),
        ]);

        // Best-effort — a missing report shouldn't mark an otherwise-successful
        // run as failed; the Reports page's "Generate Reports" fallback can
        // always produce it later.
        if (!defined('AURAI_LIB_ONLY')) define('AURAI_LIB_ONLY', true);
        require_once __DIR__ . '/auto-reports.php';
        generateAutoReport($userId, $predictionId);
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }

    db()->prepare(
        'UPDATE scheduled_refreshes
         SET last_run_at = NOW(), next_run_at = :next_run, last_prediction_id = :pred, last_error = :err
         WHERE id = :id'
    )->execute([
        ':next_run' => schedule_next_run($schedule['frequency']),
        ':pred' => $predictionId,
        ':err' => $error,
        ':id' => $schedule['id'],
    ]);
}

function schedules_run_now(string $userId, string $id): void {
    $stmt = db()->prepare('SELECT * FROM scheduled_refreshes WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $id, ':uid' => $userId]);
    $schedule = $stmt->fetch();
    if (!$schedule) fail('Schedule not found', 404);

    run_one_schedule($schedule);

    $stmt = db()->prepare('SELECT * FROM scheduled_refreshes WHERE id = :id');
    $stmt->execute([':id' => $id]);
    respond(row_schedule($stmt->fetch()));
}

// Called from stats_get() on every /stats request (i.e. every dashboard
// load) — see the file header for why this substitutes for a real cron.
// Capped to a handful per call so one user with many overdue schedules never
// turns a dashboard load into a multi-minute wait; the rest catch up on the
// next load.
function run_due_schedules(string $userId, int $limit = 3): void {
    $stmt = db()->prepare(
        'SELECT * FROM scheduled_refreshes
         WHERE user_id = :uid AND enabled = 1 AND next_run_at <= NOW()
         ORDER BY next_run_at ASC LIMIT :lim'
    );
    $stmt->bindValue(':uid', $userId);
    $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
    $stmt->execute();
    foreach ($stmt->fetchAll() as $schedule) {
        run_one_schedule($schedule);
    }
}

// stats_get() (api/resources.php) require_once-s this file just to reach
// run_due_schedules(), the same way run_one_schedule() above pulls in
// auto-reports.php — AURAI_LIB_ONLY keeps this tail HTTP router from acting
// on whatever request is actually in flight (a GET /stats, not a schedules
// call) when that happens.
if (!defined('AURAI_LIB_ONLY')) {
    $method = $_SERVER['REQUEST_METHOD'];
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $segments = array_values(array_filter(explode('/', $path)));
    $scheduleIndex = array_search('schedules', $segments);
    $scheduleId = $scheduleIndex !== false && isset($segments[$scheduleIndex + 1]) ? $segments[$scheduleIndex + 1] : null;
    $isRun = $scheduleId && isset($segments[$scheduleIndex + 2]) && $segments[$scheduleIndex + 2] === 'run';

    header('Content-Type: application/json');
    $userId = require_auth();

    if ($method === 'GET' && !$scheduleId) schedules_list($userId);
    elseif ($method === 'POST' && !$scheduleId) schedules_create($userId);
    elseif ($method === 'POST' && $scheduleId && $isRun) schedules_run_now($userId, $scheduleId);
    elseif ($method === 'PATCH' && $scheduleId && !$isRun) schedules_update($userId, $scheduleId);
    elseif ($method === 'DELETE' && $scheduleId && !$isRun) schedules_delete($userId, $scheduleId);
    else fail('Not found', 404);
}

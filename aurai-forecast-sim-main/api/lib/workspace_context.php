<?php
/**
 * Builds a factual snapshot of one user's workspace for the language model.
 *
 * Everything here comes from that user's own rows. The model is told to use
 * only what it is given, so this file is the sole boundary between real data
 * and anything it says — nothing else about the business reaches it.
 */

/** A compact summary of the datasets, forecasts and reports a user holds. */
function workspace_context(string $userId): string {
    $q = function (string $sql) use ($userId) {
        $stmt = db()->prepare($sql);
        $stmt->execute([':uid' => $userId]);
        return $stmt->fetchAll();
    };

    $lines = [];

    $datasets = $q('SELECT name, JSON_LENGTH(`rows`) n, meta, created_at FROM datasets
                    WHERE user_id = :uid ORDER BY created_at DESC LIMIT 20');
    $lines[] = 'DATASETS (' . count($datasets) . '):';
    foreach ($datasets as $d) {
        $meta = json_decode($d['meta'] ?? '{}', true);
        $headers = implode(', ', array_slice($meta['headers'] ?? [], 0, 10));
        $lines[] = sprintf('- "%s": %s rows, columns [%s], added %s',
            $d['name'], number_format((int)$d['n']), $headers, date('j M Y', strtotime($d['created_at'])));
    }
    if (!$datasets) $lines[] = '- none';

    $predictions = $q('SELECT name, target, algorithm, accuracy, horizon, period, forecast, created_at
                       FROM predictions WHERE user_id = :uid ORDER BY created_at DESC LIMIT 10');
    $lines[] = "\nFORECASTS (" . count($predictions) . '):';
    foreach ($predictions as $p) {
        $points = json_decode($p['forecast'], true) ?: [];
        $first = $points[0]['value'] ?? null;
        $last = $points ? end($points)['value'] : null;
        $lines[] = sprintf('- "%s": target %s, %s over %d %s, accuracy %s, run %s%s',
            $p['name'], $p['target'] ?: 'n/a', $p['algorithm'] ?: 'Prophet',
            (int)$p['horizon'], strtolower($p['period'] ?: 'periods'),
            $p['accuracy'] !== null ? $p['accuracy'] . '%' : 'not scored',
            date('j M Y', strtotime($p['created_at'])),
            ($first !== null && $last !== null)
                ? sprintf('; projects %s to %s across the window', round($first, 2), round($last, 2))
                : '');
    }
    if (!$predictions) $lines[] = '- none';

    $reports = $q('SELECT title, updated_at FROM reports WHERE user_id = :uid ORDER BY updated_at DESC LIMIT 10');
    $lines[] = "\nREPORTS (" . count($reports) . '):';
    foreach ($reports as $r) {
        $lines[] = sprintf('- "%s", updated %s', $r['title'], date('j M Y', strtotime($r['updated_at'])));
    }
    if (!$reports) $lines[] = '- none';

    return implode("\n", $lines);
}

/** The last few turns of a conversation, so follow-ups have a referent. */
function conversation_context(string $userId, string $conversationId, int $turns = 6): string {
    $stmt = db()->prepare(
        'SELECT m.role, m.content FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id = :cid AND c.user_id = :uid
         ORDER BY m.seq DESC LIMIT ' . max(1, min(20, $turns))
    );
    $stmt->execute([':cid' => $conversationId, ':uid' => $userId]);
    $rows = array_reverse($stmt->fetchAll());

    $out = [];
    foreach ($rows as $r) {
        // Truncated: older turns only need to establish the topic.
        $out[] = ($r['role'] === 'user' ? 'User: ' : 'Aurai: ') . mb_substr((string)$r['content'], 0, 400);
    }
    return implode("\n", $out);
}

/**
 * Everything known about one forecast, including the history behind it — the
 * detail a written analysis needs.
 */
function forecast_context(string $userId, ?string $predictionId = null): ?array {
    if ($predictionId) {
        $stmt = db()->prepare('SELECT * FROM predictions WHERE id = :id AND user_id = :uid');
        $stmt->execute([':id' => $predictionId, ':uid' => $userId]);
    } else {
        $stmt = db()->prepare('SELECT * FROM predictions WHERE user_id = :uid ORDER BY created_at DESC LIMIT 1');
        $stmt->execute([':uid' => $userId]);
    }
    $p = $stmt->fetch();
    if (!$p) return null;

    $p['forecast'] = json_decode($p['forecast'], true) ?: [];
    $p['history'] = [];
    $p['datasetName'] = null;

    if ($p['dataset_id']) {
        $stmt = db()->prepare('SELECT name, `rows` FROM datasets WHERE id = :id AND user_id = :uid');
        $stmt->execute([':id' => $p['dataset_id'], ':uid' => $userId]);
        if ($ds = $stmt->fetch()) {
            $p['datasetName'] = $ds['name'];
            $rows = json_decode($ds['rows'], true) ?: [];
            foreach ($rows as $row) {
                if (isset($row[$p['target']]) && is_numeric($row[$p['target']])) {
                    $p['history'][] = (float)$row[$p['target']];
                }
            }
            // Only the recent tail matters for judging where the forecast picks up.
            $p['history'] = array_slice($p['history'], -24);
        }
    }
    return $p;
}

/** Renders a forecast as plain text the model can reason over. */
function forecast_as_text(array $p): string {
    $points = $p['forecast'] ?? [];
    $history = $p['history'] ?? [];

    $lines = [];
    $lines[] = sprintf('Forecast "%s"%s', $p['name'], $p['datasetName'] ? ' from dataset "' . $p['datasetName'] . '"' : '');
    $lines[] = sprintf('Target column: %s', $p['target'] ?: 'unknown');
    $lines[] = sprintf('Model: %s, projecting %d %s ahead', $p['algorithm'] ?: 'Prophet', (int)$p['horizon'], strtolower((string)$p['period']));
    $lines[] = $p['accuracy'] !== null
        ? sprintf('Backtested accuracy: %s%% (measured by holding back the end of the history and scoring predictions against it)', $p['accuracy'])
        : 'Backtested accuracy: not scored — the series was too short to hold data back.';

    if ($history) {
        $avg = array_sum($history) / count($history);
        $lines[] = sprintf('Recent recorded history (%d points, oldest first): %s',
            count($history), implode(', ', array_map(fn($v) => round($v, 2), $history)));
        $lines[] = sprintf('Average of recorded history: %s', round($avg, 2));
    }

    if ($points) {
        $lines[] = 'Projected values (period: value, low-high):';
        foreach ($points as $f) {
            $lines[] = sprintf('  %s: %s (%s to %s)',
                $f['label'] ?? ('T+' . $f['i']), $f['value'], $f['low'] ?? '?', $f['high'] ?? '?');
        }
    }
    return implode("\n", $lines);
}

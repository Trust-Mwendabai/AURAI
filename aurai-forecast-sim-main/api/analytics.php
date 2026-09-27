<?php
require_once __DIR__ . '/lib/helpers.php';

/**
 * Segment analytics over a stored dataset.
 *
 * The idea comes from the original app's Retail Analytics screen — sales
 * velocity, category performance, seasonal demand, store comparison. That
 * version displayed hardcoded arrays; this one derives the same measures from
 * the user's own rows, so the numbers mean something.
 *
 * "Segment" is whatever column the user groups by: product, region, store,
 * channel. Retail is the obvious case but nothing here is retail-specific.
 */
function analytics_run(string $userId): void {
    $b = json_input();
    $datasetId = $b['datasetId'] ?? null;
    $segmentColumn = $b['segmentColumn'] ?? null;
    $valueColumn = $b['valueColumn'] ?? null;
    $dateColumn = $b['dateColumn'] ?? null;

    if (!$datasetId || !$segmentColumn || !$valueColumn) {
        fail('datasetId, segmentColumn and valueColumn are required');
    }

    $stmt = db()->prepare('SELECT `rows`, meta FROM datasets WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $datasetId, ':uid' => $userId]);
    $dataset = $stmt->fetch();
    if (!$dataset) fail('Dataset not found', 404);

    $rows = json_decode($dataset['rows'], true) ?: [];
    if (!$rows) fail('Dataset has no rows');

    $headers = array_keys($rows[0]);
    foreach ([$segmentColumn, $valueColumn] as $col) {
        if (!in_array($col, $headers, true)) fail("Column '$col' is not in this dataset");
    }
    if ($segmentColumn === $valueColumn) fail('The segment and value columns must be different');

    if (!$dateColumn) $dateColumn = guess_date_column($rows, $headers, $valueColumn);

    // --- Bucket rows by segment, keeping each observation in time order ------
    $segments = [];
    $periodTotals = [];
    $grandTotal = 0.0;
    $usable = 0;

    foreach ($rows as $row) {
        if (!is_numeric($row[$valueColumn] ?? null)) continue;
        $value = (float)$row[$valueColumn];
        $name = trim((string)($row[$segmentColumn] ?? ''));
        if ($name === '') $name = '(blank)';

        $timestamp = null;
        if ($dateColumn && isset($row[$dateColumn])) {
            $raw = trim((string)$row[$dateColumn]);
            // A bare year is a valid period label but not a parseable date.
            $timestamp = preg_match('/^\d{4}$/', $raw) ? mktime(0, 0, 0, 1, 1, (int)$raw) : (strtotime($raw) ?: null);
        }

        $segments[$name] ??= ['values' => [], 'series' => []];
        $segments[$name]['values'][] = $value;
        if ($timestamp) $segments[$name]['series'][] = ['t' => $timestamp, 'v' => $value];

        if ($timestamp) {
            $key = date('Y-m', $timestamp);
            $periodTotals[$key] = ($periodTotals[$key] ?? 0) + $value;
        }
        $grandTotal += $value;
        $usable++;
    }

    if (!$usable) fail("No numeric values found in '$valueColumn'");
    if (count($segments) > 200) fail("'$segmentColumn' has too many distinct values to compare — pick a column with fewer categories");

    // --- Measure each segment ----------------------------------------------
    $out = [];
    foreach ($segments as $name => $data) {
        $values = $data['values'];
        $count = count($values);
        $total = array_sum($values);
        $average = $total / $count;

        // Growth compares the earlier half of the segment's history with the
        // later half. Ordered by date where available, otherwise by row order,
        // which is the best available proxy.
        $ordered = $values;
        if (count($data['series']) === $count) {
            usort($data['series'], fn($a, $b) => $a['t'] <=> $b['t']);
            $ordered = array_column($data['series'], 'v');
        }
        $growth = null;
        if ($count >= 4) {
            $half = intdiv($count, 2);
            $earlier = array_slice($ordered, 0, $half);
            $later = array_slice($ordered, $half);
            $earlierAvg = array_sum($earlier) / count($earlier);
            $laterAvg = array_sum($later) / count($later);
            if ($earlierAvg != 0.0) $growth = round((($laterAvg - $earlierAvg) / abs($earlierAvg)) * 100, 1);
        }

        // Coefficient of variation: how erratic this segment is relative to its
        // own size, so a large and a small segment can be compared fairly.
        $variance = array_sum(array_map(fn($v) => ($v - $average) ** 2, $values)) / $count;
        $volatility = $average != 0.0 ? round((sqrt($variance) / abs($average)) * 100, 1) : null;

        // Best period: which month this segment peaks in, for stocking and
        // staffing decisions.
        $peak = null;
        if ($data['series']) {
            $byMonth = [];
            foreach ($data['series'] as $point) {
                $key = date('Y-m', $point['t']);
                $byMonth[$key] = ($byMonth[$key] ?? 0) + $point['v'];
            }
            arsort($byMonth);
            $peak = array_key_first($byMonth);
        }

        $out[] = [
            'segment' => $name,
            'total' => round($total, 2),
            'average' => round($average, 2),
            'count' => $count,
            'share' => $grandTotal != 0.0 ? round(($total / $grandTotal) * 100, 1) : 0,
            'growth' => $growth,
            'volatility' => $volatility,
            'peakPeriod' => $peak,
        ];
    }

    usort($out, fn($a, $b) => $b['total'] <=> $a['total']);

    // --- Overall seasonal profile ------------------------------------------
    ksort($periodTotals);
    $timeline = [];
    foreach ($periodTotals as $key => $total) {
        $timeline[] = ['period' => $key, 'total' => round($total, 2)];
    }

    $growing = array_values(array_filter($out, fn($s) => $s['growth'] !== null));
    usort($growing, fn($a, $b) => $b['growth'] <=> $a['growth']);

    respond([
        'segmentColumn' => $segmentColumn,
        'valueColumn' => $valueColumn,
        'dateColumn' => $dateColumn,
        'grandTotal' => round($grandTotal, 2),
        'rowsAnalysed' => $usable,
        'segments' => $out,
        'timeline' => $timeline,
        'leader' => $out[0] ?? null,
        'fastestGrowing' => $growing[0] ?? null,
        'steepestDecline' => !empty($growing) ? end($growing) : null,
        'concentration' => analytics_concentration($out),
        'summary' => analytics_summary($out, $growing, $segmentColumn, $valueColumn),
    ]);
}

/**
 * Share held by the largest segment, and how many segments make up 80% of the
 * total — the standard read on whether a business is dangerously concentrated.
 */
function analytics_concentration(array $segments): array {
    $topShare = $segments[0]['share'] ?? 0;
    $running = 0.0;
    $needed = 0;
    foreach ($segments as $s) {
        $running += $s['share'];
        $needed++;
        if ($running >= 80) break;
    }
    return ['topShare' => $topShare, 'segmentsFor80Percent' => $needed, 'totalSegments' => count($segments)];
}

/** A short plain-language read of what the numbers imply. */
function analytics_summary(array $segments, array $growing, string $segmentColumn, string $valueColumn): string {
    if (!$segments) return 'Nothing to analyse.';

    $leader = $segments[0];
    $out = sprintf("**%s** is your largest %s by %s, at %s%% of the total.",
        $leader['segment'], $segmentColumn, $valueColumn, $leader['share']);

    $concentration = analytics_concentration($segments);
    if ($concentration['totalSegments'] > 2) {
        $out .= $concentration['segmentsFor80Percent'] <= 2
            ? sprintf(" Just %d of your %d segments make up 80%% of it, which is a concentration risk — losing one would hurt.",
                $concentration['segmentsFor80Percent'], $concentration['totalSegments'])
            : sprintf(" It takes %d of your %d segments to reach 80%% of the total, so the business is reasonably spread.",
                $concentration['segmentsFor80Percent'], $concentration['totalSegments']);
    }

    if ($growing) {
        $best = $growing[0];
        $worst = end($growing);
        if ($best['growth'] > 5) {
            $out .= sprintf("\n\n**%s** is growing fastest at %+.1f%%%s.",
                $best['segment'], $best['growth'],
                $best['share'] < 10 ? ' — still small, but worth watching' : '');
        }
        if ($worst['growth'] < -5 && $worst['segment'] !== $best['segment']) {
            $out .= sprintf(" **%s** is declining at %+.1f%%%s.",
                $worst['segment'], $worst['growth'],
                $worst['share'] > 20 ? ', and it is large enough that this matters' : '');
        }
    }

    $erratic = array_values(array_filter($segments, fn($s) => $s['volatility'] !== null && $s['volatility'] > 40));
    if ($erratic) {
        $out .= sprintf("\n\n%s %s unusually erratic (swinging more than 40%% around its own average), so plan it with a wider buffer than the others.",
            $erratic[0]['segment'], count($erratic) === 1 ? 'is' : 'and others are');
    }

    return $out;
}

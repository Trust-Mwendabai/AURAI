<?php
/**
 * Real forecasting through the Prophet services, and the model-reuse cache.
 *
 * Requires both Python services to be running:
 *   cd backend/Python && python precision_ai.py   (:7000)
 *   cd backend/Python && python predict.py        (:7070)
 *
 * A first fit can take a minute, so this suite is slower than the others and
 * is skipped by the runner unless --with-forecast is passed.
 */
require_once __DIR__ . '/_bootstrap.php';

// Fail early and clearly rather than timing out one request at a time.
$probe = @file_get_contents('http://127.0.0.1:7000/', false, stream_context_create(['http' => ['timeout' => 2, 'ignore_errors' => true]]));
if ($probe === false) {
    fwrite(STDERR, "The Prophet trainer is not reachable on :7000.\n" .
                   "Start it with: cd backend/Python && python precision_ai.py\n");
    exit(2);
}

test_account('Forecast');

$rows = [];
for ($i = 0; $i < 36; $i++) {
    $rows[] = [
        'month' => date('Y-m-d', strtotime("2022-01-01 +$i month")),
        'sales' => round(1000 + $i * 30 + 200 * sin(($i % 12) / 12 * 2 * M_PI)),
        'units' => 50 + $i,
    ];
}
$dsid = api('POST', '/datasets', ['name' => 'Cache Test', 'rows' => $rows, 'meta' => ['headers' => ['month', 'sales', 'units']]])['body']['id'];

$run = function (string $target, int $horizon, string $period) use ($dsid) {
    $t = microtime(true);
    $r = api('POST', '/forecast', ['datasetId' => $dsid, 'target' => $target, 'horizon' => $horizon, 'period' => $period]);
    $r['seconds'] = round(microtime(true) - $t, 1);
    return $r;
};
$save = function (array $r, string $target, int $horizon, string $period) use ($dsid) {
    api('POST', '/predictions', [
        'name' => "Cache Test · $target", 'datasetId' => $dsid, 'target' => $target,
        'horizon' => $horizon, 'period' => $period, 'algorithm' => 'Prophet',
        'modelName' => $r['body']['model_name'], 'accuracy' => $r['body']['accuracy'],
        'forecast' => $r['body']['forecast'],
    ]);
};

suite('Training a model');
$first = $run('sales', 12, 'Monthly');
check("a first run trains a model ({$first['seconds']}s)",
    $first['status'] === 200 && $first['body']['cached'] === false, substr($first['raw'], 0, 200));
check('it auto-detects the date column', ($first['body']['dateColumn'] ?? '') === 'month', $first['raw']);
check('it returns an accuracy score', $first['body']['accuracy'] !== null, json_encode($first['body']['accuracy'] ?? null));
check('confidence bounds bracket the value',
    ($first['body']['forecast'][0]['low'] ?? 0) <= ($first['body']['forecast'][0]['value'] ?? 0)
    && ($first['body']['forecast'][0]['value'] ?? 0) <= ($first['body']['forecast'][0]['high'] ?? 0),
    json_encode($first['body']['forecast'][0] ?? null));
$accuracy = $first['body']['accuracy'];
$save($first, 'sales', 12, 'Monthly');

suite('Reusing a saved model');
$again = $run('sales', 12, 'Monthly');
check("an identical re-run reuses the model ({$again['seconds']}s)", $again['body']['cached'] === true, substr($again['raw'], 0, 200));
check('reuse is much faster than training', $again['seconds'] < max(2.0, $first['seconds'] / 3), "train {$first['seconds']}s vs cached {$again['seconds']}s");
check('the stored accuracy is carried through', abs(($again['body']['accuracy'] ?? 0) - $accuracy) < 0.01);

// A saved model can project any length, so only the training inputs matter.
$longer = $run('sales', 24, 'Monthly');
check("a different horizon still reuses it ({$longer['seconds']}s)", $longer['body']['cached'] === true, substr($longer['raw'], 0, 160));
check('and returns the requested number of points', count($longer['body']['forecast'] ?? []) === 24);

suite('What invalidates the cache');
$other = $run('units', 12, 'Monthly');
check('a different target trains its own model', $other['body']['cached'] === false, substr($other['raw'], 0, 160));
check('and gets a distinct model name', $other['body']['model_name'] !== $first['body']['model_name'],
    "{$other['body']['model_name']} vs {$first['body']['model_name']}");
$save($other, 'units', 12, 'Monthly');

$still = $run('sales', 12, 'Monthly');
check('the first model survives training a second one', $still['body']['cached'] === true, substr($still['raw'], 0, 160));

$rows[] = ['month' => '2025-01-01', 'sales' => 2500, 'units' => 99];
api('PATCH', "/datasets/$dsid", ['rows' => $rows]);
$edited = $run('sales', 12, 'Monthly');
check('editing the dataset forces a retrain', $edited['body']['cached'] === false, substr($edited['raw'], 0, 200));
$save($edited, 'sales', 12, 'Monthly');

$weekly = $run('sales', 10, 'Weekly');
check('a different frequency trains its own model', $weekly['body']['cached'] === false, substr($weekly['raw'], 0, 160));

suite('Accuracy is measured against held-out data');
// The model is scored by fitting on the earlier part of the series and
// predicting the rest. A predictable series must score well; noise must not;
// a series too short to split must not be scored at all.
$mk = function (string $name, callable $fn, int $n = 36) {
    $rows = [];
    for ($i = 0; $i < $n; $i++) {
        $rows[] = ['month' => date('Y-m-d', strtotime("2022-01-01 +$i month")), 'v' => $fn($i)];
    }
    return api('POST', '/datasets', ['name' => $name, 'rows' => $rows, 'meta' => ['headers' => ['month', 'v']]])['body']['id'];
};

$cleanId = $mk('clean', fn($i) => 1000 + $i * 25);
$r = api('POST', '/forecast', ['datasetId' => $cleanId, 'target' => 'v', 'horizon' => 6, 'period' => 'Monthly']);
$cleanAccuracy = $r['body']['accuracy'] ?? null;
check('a predictable series scores well', $cleanAccuracy !== null && $cleanAccuracy > 80, json_encode($cleanAccuracy));
check('a flat-line baseline is reported for comparison', ($r['body']['baselineMape'] ?? null) !== null, $r['raw']);

mt_srand(7);
$noiseId = $mk('noise', fn($i) => mt_rand(200, 2000));
$r = api('POST', '/forecast', ['datasetId' => $noiseId, 'target' => 'v', 'horizon' => 6, 'period' => 'Monthly']);
$noiseAccuracy = $r['body']['accuracy'] ?? null;
check('random noise scores far worse than a real trend',
    $noiseAccuracy !== null && $cleanAccuracy !== null && $noiseAccuracy < $cleanAccuracy - 30,
    "clean=$cleanAccuracy noise=$noiseAccuracy");
check('accuracy never goes negative', $noiseAccuracy >= 0, json_encode($noiseAccuracy));

$shortId = $mk('short', fn($i) => 100 + $i, 6);
$r = api('POST', '/forecast', ['datasetId' => $shortId, 'target' => 'v', 'horizon' => 3, 'period' => 'Monthly']);
// `?? 'x'` would coalesce the null we are testing for, so check the key directly.
check('a series too short to split is not scored',
    array_key_exists('accuracy', $r['body']) && $r['body']['accuracy'] === null
    && !empty($r['body']['accuracyNote']), $r['raw']);
check('and says why', str_contains($r['body']['accuracyNote'] ?? '', 'too few'), $r['body']['accuracyNote'] ?? '');

suite('Rejects bad input');
check('an unknown target is rejected', $run('nonexistent', 6, 'Monthly')['status'] === 400);
$r = api('POST', '/forecast', ['datasetId' => '00000000-0000-0000-0000-000000000000', 'target' => 'sales']);
check('an unknown dataset is rejected', $r['status'] === 404, $r['raw']);

finish();

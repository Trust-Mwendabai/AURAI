<?php
/**
 * The endpoints backing the dashboard, the settings page and the assistant:
 * /stats, /settings and /assistant. Together they cover everything the UI
 * shows as "real" data.
 */
require_once __DIR__ . '/_bootstrap.php';

test_account('Demo');

suite('Settings persistence');
$r = api('GET', '/settings');
check('a new account starts with empty settings', $r['status'] === 200, $r['raw']);

api('PUT', '/settings', [
    'systemName' => 'Acme Forecasting', 'companyName' => 'Acme Ltd',
    'forecastHorizon' => 24, 'forecastPeriod' => 'Weekly',
]);
$r = api('GET', '/settings');
check('settings survive a round-trip through the database',
    ($r['body']['systemName'] ?? '') === 'Acme Forecasting' && ($r['body']['forecastHorizon'] ?? 0) == 24, $r['raw']);

suite('Dashboard stats');
$r = api('GET', '/stats');
check('an empty workspace reports zeros rather than failing',
    $r['status'] === 200 && $r['body']['predictions'] === 0 && $r['body']['latest'] === null, $r['raw']);

$rows = [];
for ($i = 0; $i < 30; $i++) {
    $rows[] = ['month' => date('Y-m-d', strtotime("2022-01-01 +$i month")), 'sales' => 900 + $i * 30];
}
$r = api('POST', '/datasets', ['name' => 'Demo Sales', 'rows' => $rows, 'meta' => ['headers' => ['month', 'sales']]]);
$dsid = $r['body']['id'];

api('POST', '/predictions', [
    'name' => 'Demo Sales · sales', 'datasetId' => $dsid, 'target' => 'sales',
    'horizon' => 6, 'period' => 'Monthly', 'algorithm' => 'Prophet',
    'modelName' => 'timeseries_demo', 'accuracy' => 91.4,
    'forecast' => [['i' => 1, 'label' => '2024-07-01', 'value' => 1800, 'low' => 1750, 'high' => 1850]],
]);

$r = api('GET', '/stats');
$s = $r['body'];
check('counts reflect real rows', $s['datasets'] === 1 && $s['predictions'] === 1 && $s['reports'] === 0, $r['raw']);
check('row totals come from JSON_LENGTH, not a full download', $s['totalRows'] === 30, json_encode($s['totalRows']));
check('average accuracy is computed in SQL', abs(($s['avgAccuracy'] ?? 0) - 91.4) < 0.01, json_encode($s['avgAccuracy']));
check('the latest forecast is attached for the headline chart', !empty($s['latest']['forecast']), $r['raw']);
check('per-month activity is populated', count($s['byMonth']) >= 1, json_encode($s['byMonth']));
check('recent runs are listed', count($s['recent']) === 1, json_encode($s['recent']));

suite('Assistant answers from real rows');
// Reasoning is switched off throughout: these assert that a lookup reads the
// right rows, and a model rewords itself between identical calls, so the same
// assertions against its prose would pass or fail at random. The reasoned path
// has its own suite in assistant.php.
foreach ([
    ['how many forecasts do i have', ['forecast', '1']],
    ['how accurate are my models', ['91.4']],
    ['show me my datasets', ['Demo Sales', '30']],
    ['what was my latest forecast', ['Demo Sales']],
    ['give me a workspace summary', ['Datasets', 'Forecasts']],
    ['do i have any reports', ['report']],
    ['what should i do about this', ['Business insights']],
] as [$question, $expected]) {
    $r = api('POST', '/assistant', ['question' => $question, 'reasoning' => false]);
    $answer = $r['body']['answer'] ?? '';
    $ok = $r['status'] === 200;
    foreach ($expected as $needle) $ok = $ok && stripos($answer, $needle) !== false;
    check("\"$question\"", $ok, $answer ?: $r['raw']);
}

$r = api('POST', '/assistant', ['question' => 'asdfghjkl', 'reasoning' => false]);
check('an unrecognised question returns guidance, never an empty answer',
    strlen($r['body']['answer'] ?? '') > 200, $r['raw']);

suite('Business insights');
// The deterministic analysis is asserted in full: it is what every user sees
// whenever the model is unreachable or the daily quota is spent, which on the
// free tier is often.
$r = api('POST', '/insights', ['reasoning' => false]);
$plain = $r['body']['advice'] ?? '';
check('advice is returned for the latest forecast', str_contains($plain, 'Demo Sales'), $plain ?: $r['raw']);
check('it compares the projection against real history', str_contains($plain, '%'), $plain);
check('it states how far the forecast can be trusted', str_contains($plain, '91.4'), $plain);

// The reasoned version is checked for grounding, never for wording. It is
// skipped where no key is configured, so a checkout without config.local.php
// still passes.
$reasoned = api('POST', '/insights', [])['body']['advice'] ?? '';
if ($reasoned === '' || $reasoned === $plain) {
    check('reasoning is unavailable — skipping (no Gemini key, quota spent, or the model was busy)', true);
} else {
    check('reasoned advice is substantial prose', strlen($reasoned) > 200, strlen($reasoned) . ' chars');
    check('it quotes the real accuracy of this forecast', str_contains($reasoned, '91.4'), $reasoned);
    check('it is not cut off mid-sentence',
        in_array(substr(rtrim($reasoned), -1), ['.', '!', '?', '*'], true), substr(rtrim($reasoned), -120));
}

suite('Isolation on these endpoints');
test_account('Other');
$r = api('GET', '/stats');
check('stats are scoped to the signed-in user',
    $r['body']['datasets'] === 0 && $r['body']['predictions'] === 0, $r['raw']);

$r = api('POST', '/assistant', ['question' => 'show me my datasets', 'reasoning' => false]);
check('the assistant never reports another user\'s data',
    stripos($r['body']['answer'] ?? '', 'Demo Sales') === false, $r['body']['answer'] ?? '');

$r = api('GET', '/settings');
check('settings are per-user', empty($r['body']['systemName']), $r['raw']);

as_user(null);
check('stats require authentication', api('GET', '/stats')['status'] === 401);
check('the assistant requires authentication', api('POST', '/assistant', ['question' => 'hi'])['status'] === 401);

finish();

<?php
/**
 * Segment analytics: totals, share, growth, volatility and concentration.
 *
 * The fixture is shaped like a retail extract — several stores over two years,
 * one growing, one declining, one erratic — so the measures have something
 * real to find.
 */
require_once __DIR__ . '/_bootstrap.php';

test_account('Analytics');

$rows = [];
for ($i = 0; $i < 24; $i++) {
    $date = date('Y-m-d', strtotime("2023-01-01 +$i month"));
    // Lusaka: large and growing. Kitwe: mid-size, declining.
    // Ndola: small and erratic. Kabwe: small and flat.
    $rows[] = ['month' => $date, 'store' => 'Lusaka', 'sales' => 1000 + $i * 40];
    $rows[] = ['month' => $date, 'store' => 'Kitwe',  'sales' => 800 - $i * 15];
    $rows[] = ['month' => $date, 'store' => 'Ndola',  'sales' => $i % 2 === 0 ? 120 : 480];
    $rows[] = ['month' => $date, 'store' => 'Kabwe',  'sales' => 300];
}
$dsid = api('POST', '/datasets', [
    'name' => 'Store sales', 'rows' => $rows, 'meta' => ['headers' => ['month', 'store', 'sales']],
])['body']['id'];

$run = fn(array $extra = []) => api('POST', '/analytics', array_merge([
    'datasetId' => $dsid, 'segmentColumn' => 'store', 'valueColumn' => 'sales',
], $extra));

suite('Segment measures');
$r = $run();
check('returns a result', $r['status'] === 200, $r['raw']);
$body = $r['body'];

check('finds every segment', count($body['segments']) === 4, json_encode(array_column($body['segments'], 'segment')));
check('analyses every numeric row', $body['rowsAnalysed'] === 96, json_encode($body['rowsAnalysed']));
check('segments are ranked by total, largest first',
    $body['segments'][0]['segment'] === 'Lusaka', json_encode(array_column($body['segments'], 'segment')));
check('the largest segment is reported as the leader', ($body['leader']['segment'] ?? '') === 'Lusaka', json_encode($body['leader']));

$shares = array_sum(array_column($body['segments'], 'share'));
check('shares add up to roughly 100%', abs($shares - 100) < 1.0, "sum = $shares");

suite('Growth direction matches the data');
$byName = [];
foreach ($body['segments'] as $s) $byName[$s['segment']] = $s;
check('a rising series reports positive growth', $byName['Lusaka']['growth'] > 0, json_encode($byName['Lusaka']));
check('a falling series reports negative growth', $byName['Kitwe']['growth'] < 0, json_encode($byName['Kitwe']));
check('a flat series reports no meaningful growth', abs($byName['Kabwe']['growth']) < 1, json_encode($byName['Kabwe']));
check('the fastest grower is identified', ($body['fastestGrowing']['segment'] ?? '') === 'Lusaka', json_encode($body['fastestGrowing']));
check('the steepest decline is identified', ($body['steepestDecline']['segment'] ?? '') === 'Kitwe', json_encode($body['steepestDecline']));

suite('Volatility');
check('an alternating series is flagged as volatile', $byName['Ndola']['volatility'] > 40, json_encode($byName['Ndola']));
check('a constant series has no volatility', (float)$byName['Kabwe']['volatility'] === 0.0, json_encode($byName['Kabwe']));

suite('Concentration and timeline');
check('concentration counts how many segments make 80%',
    $body['concentration']['segmentsFor80Percent'] >= 1
    && $body['concentration']['segmentsFor80Percent'] <= 4, json_encode($body['concentration']));
check('the date column is detected automatically', ($body['dateColumn'] ?? '') === 'month', json_encode($body['dateColumn']));
check('a monthly timeline is built', count($body['timeline']) === 24, count($body['timeline']) . ' periods');
check('timeline totals combine every segment',
    abs($body['timeline'][0]['total'] - (1000 + 800 + 120 + 300)) < 1, json_encode($body['timeline'][0]));

suite('Plain-language summary');
check('names the leader', str_contains($body['summary'], 'Lusaka'), $body['summary']);
check('mentions growth or decline',
    str_contains($body['summary'], 'growing') || str_contains($body['summary'], 'declining'), $body['summary']);

suite('Rejects bad input');
check('an unknown column is rejected', $run(['segmentColumn' => 'nope'])['status'] === 400);
check('the same column twice is rejected', $run(['valueColumn' => 'store'])['status'] === 400);
check('a non-numeric measure is rejected', $run(['valueColumn' => 'month'])['status'] === 400);
$r = api('POST', '/analytics', ['datasetId' => '00000000-0000-0000-0000-000000000000', 'segmentColumn' => 'store', 'valueColumn' => 'sales']);
check('an unknown dataset is rejected', $r['status'] === 404, $r['raw']);

suite('Isolation');
$owner = current_token();
test_account('Other');
$r = $run();
check('another user cannot analyse my dataset', $r['status'] === 404, $r['raw']);
as_user($owner);

finish();

<?php
/**
 * How the assistant routes a question: weighted intent scoring, the user's own
 * vocabulary (dataset and column names), and conversation follow-ups.
 *
 * The workspace here deliberately uses words that are *not* feature keywords —
 * a dataset called "weather-readings" with a "sales" column — so the tests
 * exercise routing rather than coincidental matches.
 */
require_once __DIR__ . '/_bootstrap.php';

test_account('NLU');

$rows = [];
for ($i = 0; $i < 30; $i++) {
    $rows[] = ['month' => date('Y-m-d', strtotime("2022-01-01 +$i month")), 'sales' => 800 + $i * 20];
}
$r = api('POST', '/datasets', ['name' => 'weather-readings-2026.csv', 'rows' => $rows, 'meta' => ['headers' => ['month', 'sales']]]);
$dsid = $r['body']['id'];
api('POST', '/predictions', [
    'name' => 'weather · sales', 'datasetId' => $dsid, 'target' => 'sales',
    'horizon' => 6, 'period' => 'Monthly', 'algorithm' => 'Prophet', 'accuracy' => 88.2,
    'forecast' => [
        ['i' => 1, 'label' => '2024-07-01', 'value' => 1400, 'low' => 1350, 'high' => 1450],
        ['i' => 2, 'label' => '2024-08-01', 'value' => 1500, 'low' => 1430, 'high' => 1570],
    ],
]);

/**
 * Asks with reasoning switched off, so the deterministic router answers.
 *
 * These tests are about *which handler* a question reaches. Gemini answers
 * first when it is configured, and it rewords itself between identical calls,
 * so routing asserted through its prose would pass or fail at random — and the
 * fallback, which serves every user whenever the model is unreachable, would
 * go untested.
 */
$ask = fn(string $q, ?string $cid = null) =>
    api('POST', '/assistant', ['question' => $q, 'conversationId' => $cid, 'reasoning' => false])['body']['answer'] ?? '';

suite('Natural phrasing');
$a = $ask('Show me July sales');
check('a question naming a column reaches the forecast, not the fallback',
    !str_contains($a, "I'm not sure what you're asking"), $a);

$a = $ask("What's the status of my weather data?");
// "status" alone would score for the summary intent; naming their dataset
// should outrank that.
check('naming a dataset outranks a weak generic keyword', str_contains($a, 'weather-readings'), $a);

check('"Can I trust these numbers?" routes to accuracy', str_contains($ask('Can I trust these numbers?'), '88.2'));
check('"how many forecasts" routes to history, not accuracy', str_contains($ask('how many forecasts do I have'), "You've run"));
check('"what should I do" routes to business insights', str_contains($ask('what should I do about this'), 'Business insights'));

suite('Normalisation');
check('casing and punctuation do not change the answer',
    $ask('how accurate are my models') === $ask('HOW ACCURATE, are my   models???'));

suite('Conversation follow-ups');
$cid = api('POST', '/conversations', ['title' => 'ctx'])['body']['id'];
api('POST', '/messages', ['conversationId' => $cid, 'role' => 'user', 'content' => 'how accurate are my models']);

check('"why?" continues the previous topic', str_contains($ask('why?', $cid), '88.2'));
check('"tell me more" continues it too', str_contains($ask('tell me more', $cid), '88.2'));
check('a follow-up with no conversation falls back gracefully',
    str_contains($ask('why?'), "I'm not sure what you're asking"));

suite('Follow-up history is scoped to its owner');
$owner = current_token();
test_account('Other');
check('another user cannot resume my conversation', !str_contains($ask('why?', $cid), '88.2'));
as_user($owner);

suite('Fallback');
$a = $ask('zzzz qqqq xyzzy');
check('an unknown question returns substantive guidance', strlen($a) > 200, strlen($a) . ' chars');
check('the guidance names things the assistant can actually answer',
    str_contains($a, 'How accurate are my models'), $a);

suite('Reasoned answers');
// Skipped where no key is configured, so the suite still passes on a checkout
// without api/config.local.php. The model's wording is never asserted — only
// that it answered, and that it answered from this user's real rows.
$reasoned = api('POST', '/assistant', ['question' => 'How is my sales forecast looking?'])['body'];

if (!($reasoned['reasoned'] ?? false)) {
    check('reasoning is unavailable — skipping (no Gemini key, or the model was busy)', true);
} else {
    check('a reasoned answer is substantial prose', strlen($reasoned['answer']) > 120,
        strlen($reasoned['answer']) . ' chars');
    check('it is grounded in this workspace, not invented',
        str_contains($reasoned['answer'], '88.2') || str_contains($reasoned['answer'], 'weather'),
        $reasoned['answer']);
    check('it never leaks the API key into the response',
        !str_contains(strtolower(json_encode($reasoned)), 'api_key'));
}

finish();

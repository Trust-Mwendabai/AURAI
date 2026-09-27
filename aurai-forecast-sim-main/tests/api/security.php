<?php
/**
 * Login throttling, session pruning, and the payload shape of the dataset
 * list. The throttle checks matter because a regression there silently
 * reopens the account to brute force.
 */
require_once __DIR__ . '/_bootstrap.php';

$mysql = 'C:\\xampp\\mysql\\bin\\mysql.exe';
$sql = function (string $q) use ($mysql): string {
    exec('"' . $mysql . '" -u root aurai_forecast -N -e ' . escapeshellarg($q) . ' 2>&1', $out);
    return trim(implode("\n", $out));
};

$email = test_account('Sec');

suite('Dataset list payload');
$rows = [];
for ($i = 0; $i < 500; $i++) $rows[] = ['month' => "2024-01-$i", 'sales' => $i * 3, 'note' => str_repeat('x', 120)];
$r = api('POST', '/datasets', ['name' => 'Big', 'rows' => $rows, 'meta' => ['headers' => ['month', 'sales', 'note']]]);
$dsid = $r['body']['id'];

$list = api('GET', '/datasets');
$one = api('GET', "/datasets/$dsid");
check('the list omits row data', !isset($list['body'][0]['rows']), substr($list['raw'], 0, 160));
check('the list still reports a row count', ($list['body'][0]['row_count'] ?? 0) === 500, json_encode($list['body'][0]['row_count'] ?? null));
check('fetching one dataset still returns its rows', count($one['body']['rows'] ?? []) === 500);
$listBytes = strlen($list['raw']); $oneBytes = strlen($one['raw']);
check("the list is far smaller than a full fetch ({$listBytes}B vs {$oneBytes}B)", $listBytes < $oneBytes / 20);

suite('Expired sessions are pruned');
$uid = $one['body']['user_id'];
$sql("INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (UUID(),'$uid','stale-" . bin2hex(random_bytes(4)) . "', NOW() - INTERVAL 1 DAY);");
$before = (int)$sql('SELECT COUNT(*) FROM sessions WHERE expires_at < NOW();');
api('POST', '/auth/login', ['email' => $email, 'password' => 'secret123']);
$after = (int)$sql('SELECT COUNT(*) FROM sessions WHERE expires_at < NOW();');
check('logging in clears expired sessions', $before > 0 && $after === 0, "before=$before after=$after");

suite('Login throttling');
$victim = test_account('Victim');
$victimEmail = $victim;

$codes = [];
for ($i = 0; $i < 10; $i++) {
    $codes[] = api('POST', '/auth/login', ['email' => $victimEmail, 'password' => "wrong$i"])['status'];
}
check('the first wrong password is a plain 401', $codes[0] === 401, json_encode($codes));
check('repeated failures start returning 429', in_array(429, $codes, true), json_encode($codes));

$r = api('POST', '/auth/login', ['email' => $victimEmail, 'password' => 'secret123']);
check('even the correct password is refused while locked out', $r['status'] === 429, $r['raw']);

$r = api('POST', '/auth/login', ['email' => $email, 'password' => 'secret123']);
check('a different account is unaffected by the lockout', $r['status'] === 200, $r['raw']);

// Simulates the lockout window elapsing.
$sql('DELETE FROM login_attempts;');
$r = api('POST', '/auth/login', ['email' => $victimEmail, 'password' => 'secret123']);
check('login works again once the window passes', $r['status'] === 200, $r['raw']);

api('POST', '/auth/login', ['email' => $victimEmail, 'password' => 'nope']);
api('POST', '/auth/login', ['email' => $victimEmail, 'password' => 'secret123']);
check('a successful login clears the failure count', (int)$sql('SELECT COUNT(*) FROM login_attempts;') === 0);

suite('Password reset');
$r = api('POST', '/auth/forgot-password', ['email' => 'nobody-' . bin2hex(random_bytes(4)) . '@aurai.test']);
check('an unknown email still returns ok, so accounts cannot be probed', $r['status'] === 200, $r['raw']);

$r = api('POST', '/auth/reset-password', ['email' => $email, 'token' => 'bogus', 'password' => 'newpass123']);
check('a bogus reset token is rejected', $r['status'] === 401, $r['raw']);

finish();

<?php
/**
 * Shared harness for the API test suites.
 *
 * Every suite registers its own throwaway account and only ever touches that
 * account's rows, so running the tests never disturbs real data. Accounts are
 * named `t<random>@aurai.test` and removed by `cleanup_test_accounts()`.
 */

const TEST_BASE = 'http://localhost/Aurai/aurai-forecast-sim-main/api';
const TEST_EMAIL_DOMAIN = '@aurai.test';

$GLOBALS['t_token'] = null;
$GLOBALS['t_pass'] = 0;
$GLOBALS['t_fail'] = 0;
$GLOBALS['t_failures'] = [];

/** Issues a request against the API as the currently signed-in test user. */
function api(string $method, string $path, ?array $body = null, int $timeout = 400): array {
    $ch = curl_init(TEST_BASE . $path);
    $headers = ['Content-Type: application/json'];
    if ($GLOBALS['t_token']) $headers[] = 'Authorization: Bearer ' . $GLOBALS['t_token'];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => $timeout,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $raw = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_errno($ch) ? curl_error($ch) : null;
    curl_close($ch);
    if ($error !== null) {
        fwrite(STDERR, "\nCannot reach the API at " . TEST_BASE . " — is Apache running?\n$error\n");
        exit(2);
    }
    return ['status' => $status, 'body' => json_decode($raw, true), 'raw' => (string)$raw];
}

function check(string $label, bool $ok, string $detail = ''): bool {
    if ($ok) {
        $GLOBALS['t_pass']++;
        echo "  PASS  $label\n";
    } else {
        $GLOBALS['t_fail']++;
        $GLOBALS['t_failures'][] = $label;
        echo "  FAIL  $label\n";
        if ($detail !== '') echo "        " . substr(str_replace("\n", ' ', $detail), 0, 200) . "\n";
    }
    return $ok;
}

/** Registers a throwaway account and signs in as it. Returns its email. */
function test_account(string $name = 'Test User'): string {
    $email = 't' . bin2hex(random_bytes(6)) . TEST_EMAIL_DOMAIN;
    $res = api('POST', '/auth/register', ['name' => $name, 'email' => $email, 'password' => 'secret123']);
    if ($res['status'] !== 201) {
        fwrite(STDERR, "Could not create a test account: {$res['raw']}\n");
        exit(2);
    }
    $GLOBALS['t_token'] = $res['body']['token'];
    return $email;
}

function as_user(?string $token): void { $GLOBALS['t_token'] = $token; }
function current_token(): ?string { return $GLOBALS['t_token']; }

function suite(string $title): void {
    echo "\n$title\n" . str_repeat('-', max(4, strlen($title))) . "\n";
}

/** Prints the tally and exits non-zero if anything failed, for CI. */
function finish(): void {
    $p = $GLOBALS['t_pass']; $f = $GLOBALS['t_fail'];
    echo "\n" . ($f === 0 ? "All $p checks passed.\n" : "$p passed, $f failed:\n  - " . implode("\n  - ", $GLOBALS['t_failures']) . "\n");
    exit($f === 0 ? 0 : 1);
}

/**
 * Deletes every account created by the tests. Real accounts are untouched
 * because they never use the .test domain.
 */
function cleanup_test_accounts(): void {
    $mysql = 'C:\\xampp\\mysql\\bin\\mysql.exe';
    if (!file_exists($mysql)) return;
    $sql = "DELETE FROM users WHERE email LIKE '%" . TEST_EMAIL_DOMAIN . "'; DELETE FROM login_attempts;";
    exec('"' . $mysql . '" -u root aurai_forecast -e ' . escapeshellarg($sql) . ' 2>&1');
}

register_shutdown_function('cleanup_test_accounts');

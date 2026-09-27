<?php
/**
 * Core CRUD across every resource, plus the per-user isolation that replaces
 * Postgres row-level security. The isolation checks matter most: MySQL has no
 * database-level safety net, so a missing `user_id` filter would silently
 * expose other people's rows.
 */
require_once __DIR__ . '/_bootstrap.php';

suite('Authentication');
$email = test_account('Ada Lovelace');
check('register returns a session token', !empty(current_token()));

$r = api('POST', '/auth/login', ['email' => $email, 'password' => 'secret123']);
check('login succeeds with the right password', $r['status'] === 200 && !empty($r['body']['token']), $r['raw']);
as_user($r['body']['token']);

$r = api('POST', '/auth/login', ['email' => $email, 'password' => 'wrong']);
check('login rejects a bad password', $r['status'] === 401, $r['raw']);

suite('Datasets');
$r = api('POST', '/datasets', [
    'name' => 'Sales 2024',
    'rows' => [['month' => 'Jan', 'sales' => 100], ['month' => 'Feb', 'sales' => 120]],
    'meta' => ['headers' => ['month', 'sales']],
]);
check('create', $r['status'] === 201 && !empty($r['body']['id']), $r['raw']);
$dsid = $r['body']['id'];

$r = api('GET', "/datasets/$dsid");
check('fetching one returns its rows decoded', count($r['body']['rows'] ?? []) === 2, $r['raw']);

api('PATCH', "/datasets/$dsid", ['name' => 'Sales 2024 (cleaned)']);
$r = api('GET', "/datasets/$dsid");
check('update renames it', ($r['body']['name'] ?? '') === 'Sales 2024 (cleaned)', $r['raw']);

$r = api('GET', '/datasets');
check('list returns it', count($r['body']) === 1, $r['raw']);

suite('Predictions');
$r = api('POST', '/predictions', [
    'name' => 'Q1 forecast', 'datasetId' => $dsid, 'target' => 'sales',
    'horizon' => 6, 'period' => 'Monthly', 'algorithm' => 'Prophet',
    'forecast' => [['i' => 1, 'label' => '2024-03-01', 'value' => 130, 'low' => 120, 'high' => 140]],
]);
check('create', $r['status'] === 201 && !empty($r['body']['id']), $r['raw']);

$r = api('GET', '/predictions');
$p = $r['body'][0] ?? [];
check('every field round-trips',
    ($p['name'] ?? '') === 'Q1 forecast' && ($p['dataset_id'] ?? '') === $dsid
    && ($p['horizon'] ?? 0) == 6 && ($p['forecast'][0]['value'] ?? 0) == 130, $r['raw']);

suite('Reports');
$r = api('POST', '/reports', ['title' => 'Q1 Review', 'body' => '<p>Looks good</p>']);
check('create', $r['status'] === 201 && !empty($r['body']['id']), $r['raw']);
$rid = $r['body']['id'];

api('POST', '/reports', ['id' => $rid, 'title' => 'Q1 Review v2', 'body' => '<p>Updated</p>']);
$r = api('GET', "/reports/$rid");
check('posting with an id updates in place', ($r['body']['title'] ?? '') === 'Q1 Review v2', $r['raw']);

$r = api('GET', '/reports');
check('list returns a plain-text excerpt, not the stored HTML',
    !isset($r['body'][0]['body']) && str_contains($r['body'][0]['excerpt'] ?? '', 'Updated'), $r['raw']);

suite('Conversations and messages');
$r = api('POST', '/conversations', ['title' => 'Forecast chat']);
check('create a conversation', $r['status'] === 201, $r['raw']);
$cid = $r['body']['id'];

api('POST', '/messages', ['conversationId' => $cid, 'role' => 'user', 'content' => 'Hello']);
api('POST', '/messages', ['conversationId' => $cid, 'role' => 'assistant', 'content' => 'Hi there']);
$r = api('GET', "/conversations/$cid/messages");
// Ordered by `seq`: both rows share a second-precision timestamp, so sorting
// by created_at would return them in arbitrary order.
check('messages come back in insertion order',
    count($r['body']) === 2 && $r['body'][0]['role'] === 'user' && $r['body'][1]['role'] === 'assistant', $r['raw']);

api('PATCH', "/conversations/$cid", ['title' => 'Renamed chat']);
$r = api('GET', '/conversations');
check('rename', ($r['body'][0]['title'] ?? '') === 'Renamed chat', $r['raw']);

suite('Profile');
$r = api('PATCH', '/auth/profile', ['name' => 'Ada L.', 'plan' => 'pro']);
check('update name and plan',
    ($r['body']['user']['name'] ?? '') === 'Ada L.' && ($r['body']['user']['plan'] ?? '') === 'pro', $r['raw']);

suite('Per-user isolation (the RLS replacement)');
$owner = current_token();
test_account('Mallory');

$r = api('GET', '/datasets');
check('another user sees none of my datasets', count($r['body']) === 0, $r['raw']);

$r = api('GET', "/datasets/$dsid");
check('another user cannot read my dataset by id', $r['body'] === null, $r['raw']);

api('DELETE', "/datasets/$dsid");
as_user($owner);
$r = api('GET', "/datasets/$dsid");
check('another user cannot delete my dataset', !empty($r['body']['id']), $r['raw']);

$r = api('GET', "/reports/$rid");
check('my own report is still readable', !empty($r['body']['id']), $r['raw']);

as_user(null);
$r = api('GET', "/conversations/$cid/messages");
check('unauthenticated requests are rejected', $r['status'] === 401, $r['raw']);

suite('Logout');
as_user($owner);
api('POST', '/auth/logout');
$r = api('GET', '/auth/me');
check('the token stops working after logout', $r['status'] === 401, $r['raw']);

finish();

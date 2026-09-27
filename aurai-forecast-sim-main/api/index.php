<?php
// Front controller for the PHP+MySQL API that replaces Supabase.
// Routes: /api/index.php/<resource>[/<id>[/<sub>]]  (or /api/<resource>/... if
// mod_rewrite via .htaccess is active).

require_once __DIR__ . '/lib/helpers.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/resources.php';
require_once __DIR__ . '/forecast.php';
require_once __DIR__ . '/assistant.php';
require_once __DIR__ . '/analytics.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$path = $_SERVER['PATH_INFO'] ?? '';
if ($path === '') {
    // PHP's built-in server (and some Apache setups) don't populate PATH_INFO —
    // fall back to the request URI with the script's own directory stripped off.
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
    if ($base !== '' && str_starts_with($uri, $base)) $uri = substr($uri, strlen($base));
    $path = preg_replace('#^/index\.php#', '', $uri);
}
$segments = array_values(array_filter(explode('/', $path)));
$method = $_SERVER['REQUEST_METHOD'];

$resource = $segments[0] ?? '';
$id = $segments[1] ?? null;
$sub = $segments[2] ?? null;

try {
    switch ($resource) {
        case 'auth':
            switch ($id) {
                case 'register': $method === 'POST' && auth_register(); break;
                case 'login': $method === 'POST' && auth_login(); break;
                case 'logout': $method === 'POST' && auth_logout(); break;
                case 'me': $method === 'GET' && auth_me(); break;
                case 'profile': $method === 'PATCH' && auth_update_profile(); break;
                case 'forgot-password': $method === 'POST' && auth_forgot_password(); break;
                case 'reset-password': $method === 'POST' && auth_reset_password(); break;
                default: fail('Not found', 404);
            }
            break;

        case 'datasets':
            $userId = require_auth();
            if ($method === 'GET' && !$id) datasets_list($userId);
            elseif ($method === 'GET' && $id) datasets_get($userId, $id);
            elseif ($method === 'POST' && !$id) datasets_create($userId);
            elseif ($method === 'PATCH' && $id) datasets_update($userId, $id);
            elseif ($method === 'DELETE' && $id) datasets_delete($userId, $id);
            else fail('Not found', 404);
            break;

        case 'predictions':
            $userId = require_auth();
            if ($method === 'GET' && !$id) predictions_list($userId);
            elseif ($method === 'POST' && !$id) predictions_create($userId);
            elseif ($method === 'DELETE' && $id) predictions_delete($userId, $id);
            else fail('Not found', 404);
            break;

        case 'reports':
            $userId = require_auth();
            if ($method === 'GET' && !$id) reports_list($userId);
            elseif ($method === 'GET' && $id) reports_get($userId, $id);
            elseif ($method === 'POST' && !$id) reports_save($userId);
            elseif ($method === 'DELETE' && $id) reports_delete($userId, $id);
            else fail('Not found', 404);
            break;

        case 'conversations':
            $userId = require_auth();
            if ($method === 'GET' && !$id) conversations_list($userId);
            elseif ($method === 'POST' && !$id) conversations_create($userId);
            elseif ($method === 'PATCH' && $id) conversations_rename($userId, $id);
            elseif ($method === 'DELETE' && $id) conversations_delete($userId, $id);
            elseif ($method === 'GET' && $id && $sub === 'messages') messages_list($userId, $id);
            else fail('Not found', 404);
            break;

        case 'insights':
            $userId = require_auth();
            if ($method === 'POST') {
                $b = json_input();
                respond(insights_page(
                    $userId,
                    $b['predictionId'] ?? null,
                    ($b['reasoning'] ?? true) !== false,
                    ($b['refresh'] ?? false) === true,
                ));
            }
            else fail('Not found', 404);
            break;

        case 'analytics':
            $userId = require_auth();
            if ($method === 'POST') analytics_run($userId);
            else fail('Not found', 404);
            break;

        case 'assistant':
            $userId = require_auth();
            if ($method === 'POST') assistant_ask($userId);
            else fail('Not found', 404);
            break;

        case 'settings':
            $userId = require_auth();
            if ($method === 'GET') settings_get($userId);
            elseif ($method === 'PUT' || $method === 'POST') settings_save($userId);
            else fail('Not found', 404);
            break;

        case 'stats':
            $userId = require_auth();
            if ($method === 'GET') stats_get($userId);
            else fail('Not found', 404);
            break;

        case 'forecast':
            $userId = require_auth();
            if ($method === 'POST' && !$id) forecast_run($userId);
            elseif ($method === 'POST' && $id === 'tune') forecast_tune($userId);
            else fail('Not found', 404);
            break;

        case 'model-arena':
            $userId = require_auth();
            if ($method === 'POST' && !$id) model_arena_compare($userId);
            else fail('Not found', 404);
            break;

        case 'messages':
            $userId = require_auth();
            if ($method === 'POST' && !$id) messages_create($userId);
            else fail('Not found', 404);
            break;

        case 'workspaces':
        case 'anomalies':
        case 'scenarios':
        case 'saved-reports':
        case 'forecast-bookmarks':
        case 'auto-reports':
        case 'export':
        case 'schedules':
            // Route to standalone endpoint files
            require_once __DIR__ . "/{$resource}.php";
            exit;

        default:
            fail('Not found', 404);
    }
} catch (PDOException $e) {
    error_log($e->getMessage());
    fail('Database error', 500);
}

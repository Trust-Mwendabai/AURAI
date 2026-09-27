<?php
require_once __DIR__ . '/lib/helpers.php';
require_once __DIR__ . '/lib/cache.php';

// Produces a forecast for a stored dataset, via the Flask + Prophet services
// in backend/Python.
//
// Fitting a Prophet model takes about a minute, so a previously trained model
// is reused whenever it is still valid. A saved model can project any horizon,
// so only a change to the dataset, the target column or the frequency forces a
// retrain — changing just the horizon does not.
//
// Both service URLs default to the local ports the two Flask apps bind to under
// XAMPP. A deployment that runs Python elsewhere — a cPanel Python app on its
// own Passenger port, or a separate host — overrides them through
// api/config.local.php or the environment, so no code changes to deploy.
function prophet_train_url(): string {
    return prophet_url('prophet_train_url', 'PROPHET_TRAIN_URL', 'http://127.0.0.1:7000/api');
}

function prophet_predict_url(): string {
    return prophet_url('prophet_predict_url', 'PROPHET_PREDICT_URL', 'http://127.0.0.1:7070/predict');
}

function prophet_tune_url(): string {
    return prophet_url('prophet_tune_url', 'PROPHET_TUNE_URL', 'http://127.0.0.1:7000/tune');
}

function model_arena_url(): string {
    return prophet_url('model_arena_url', 'MODEL_ARENA_URL', 'http://127.0.0.1:7080/compare');
}

function model_arena_run_url(): string {
    return prophet_url('model_arena_run_url', 'MODEL_ARENA_RUN_URL', 'http://127.0.0.1:7080/run');
}

// Keys the Predictions page's algorithm picker can send, and the Flask
// service in backend/Python/model_arena.py that actually runs each one.
// Prophet keeps its own dedicated train/predict services (below) since it
// also supports regressors and cross-request model reuse that the arena
// models don't — everything else here is a single-shot fit per request.
const ARENA_MODEL_LABELS = [
    'arima' => 'ARIMA (auto)',
    'holt_winters' => 'Holt-Winters',
    'xgboost' => 'XGBoost',
    'lightgbm' => 'LightGBM',
];

function prophet_url(string $configKey, string $envKey, string $default): string {
    if ($fromEnv = getenv($envKey)) return $fromEnv;
    $file = __DIR__ . '/config.local.php';
    static $local = null;
    if ($local === null) $local = is_file($file) ? (require $file) : [];
    return $local[$configKey] ?? $default;
}

// Maps the UI's period choice onto a pandas frequency alias.
const PERIOD_FREQ = [
    'Hourly' => 'H',
    'Daily' => 'D',
    'Weekly' => 'W',
    'Monthly' => 'MS',
    'Quarterly' => 'QS',
    'Yearly' => 'YS',
];

function forecast_run(string $userId): void {
    // No cron in this deployment, so expired cache rows are swept out
    // opportunistically here instead — cheap enough (~1 in 20 requests)
    // to skip scheduling something separate.
    clear_expired_forecast_cache_occasionally();

    $b = json_input();
    $datasetId = $b['datasetId'] ?? null;
    $target = $b['target'] ?? null;
    $dateColumn = $b['dateColumn'] ?? null;
    $horizon = max(1, min(365, (int)($b['horizon'] ?? 12)));
    $period = $b['period'] ?? 'Monthly';
    $regressorColumns = $b['regressors'] ?? [];  // Array of column names to use as regressors
    $algo = strtolower((string)($b['algorithm'] ?? 'prophet'));
    if ($algo !== 'prophet' && !isset(ARENA_MODEL_LABELS[$algo])) $algo = 'prophet';

    // Set by the Predictions page after a /forecast/tune run — only
    // meaningful for Prophet, which is the only algorithm /tune searches.
    $tunedParams = ($algo === 'prophet' && is_array($b['tunedParams'] ?? null)) ? $b['tunedParams'] : null;

    if (!$datasetId || !$target) fail('datasetId and target are required');

    try {
        $result = compute_forecast($userId, $datasetId, $target, $dateColumn, $horizon, $period, $regressorColumns, $algo, $tunedParams);
    } catch (ForecastError $e) {
        fail($e->getMessage(), $e->getCode() ?: 400);
    }
    respond($result);
}

// A forecast error that a caller can catch and handle — unlike fail(), which
// exits the whole process, unsuitable for compute_forecast() being called
// from inside another request's handler (run_due_schedules() during a
// /stats request, see api/schedules.php) where one failed schedule must not
// take down the dashboard load that happened to trigger it.
class ForecastError extends RuntimeException {}

// The actual forecasting logic behind POST /forecast, factored out so
// run_due_schedules() can produce a forecast the same way a user's own
// "Run Prediction" click would, without going through HTTP or being able to
// exit() the caller's response.
function compute_forecast(string $userId, string $datasetId, string $target, ?string $dateColumn, int $horizon, string $period, array $regressorColumns, string $algo, ?array $tunedParams): array {
    $stmt = db()->prepare('SELECT * FROM datasets WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $datasetId, ':uid' => $userId]);
    $dataset = $stmt->fetch();
    if (!$dataset) throw new ForecastError('Dataset not found', 404);

    $rows = json_decode($dataset['rows'], true) ?: [];
    if (!$rows) throw new ForecastError('Dataset has no rows');

    $headers = array_keys($rows[0]);
    if (!in_array($target, $headers, true)) throw new ForecastError("Target column '$target' is not in this dataset");

    if (!$dateColumn) $dateColumn = guess_date_column($rows, $headers, $target);
    if (!$dateColumn) throw new ForecastError('Could not find a date column — pick one explicitly');

    // Validate regressor columns exist in dataset
    $validRegressors = [];
    foreach ($regressorColumns as $regColumn) {
        if (in_array($regColumn, $headers, true) && $regColumn !== $target && $regColumn !== $dateColumn) {
            $validRegressors[] = $regColumn;
        }
    }

    // The actual series behind the forecast, so the chart can show where
    // recorded history ends and projection begins.
    $history = history_points($rows, $dateColumn, $target);

    $freq = PERIOD_FREQ[$period] ?? 'MS';
    // One model per dataset + target + frequency, so forecasting a different
    // column of the same dataset doesn't overwrite an existing model. A
    // tuned run gets its own suffix so it neither reuses nor overwrites the
    // default-parameter model saved under the plain name.
    $modelName = 'timeseries_' . substr(hash('sha256', $datasetId . '|' . $target . '|' . $freq), 0, 24);
    if ($tunedParams) $modelName .= '_t' . substr(md5(json_encode($tunedParams)), 0, 8);

    // Non-Prophet algorithms take a separate, simpler path: no regressors,
    // no cross-request .pkl reuse (each is a fast single-shot fit), just
    // cache-or-run against the Model Arena service. Cached under its own
    // algorithm key so picking ARIMA never returns a Prophet result cached
    // for the same dataset/target/horizon, or vice versa.
    if ($algo !== 'prophet') {
        $cachedArena = get_cached_forecast($userId, $datasetId, $target, $dateColumn, $horizon, $period, [], $algo);
        if ($cachedArena) {
            return [
                'forecast' => $cachedArena['forecast'] ?? [],
                'accuracy' => $cachedArena['accuracy'] ?? null,
                'mape' => $cachedArena['mape'] ?? null,
                'model_name' => $cachedArena['model_name'] ?? "arena_$algo",
                'model_type' => $cachedArena['model_type'] ?? "{$algo}_model",
                'dateColumn' => $dateColumn,
                'history' => $history,
                'cached' => true,
            ];
        }

        $dateValues = [];
        $values = [];
        foreach ($rows as $row) {
            $dateValues[] = (string)($row[$dateColumn] ?? '');
            $values[] = $row[$target] ?? null;
        }

        [$body, $status, $curlError] = post_json(model_arena_run_url(), [
            'dataset' => $values,
            'date_values' => $dateValues,
            'freq' => $freq,
            'interval' => $horizon,
            'model' => $algo,
        ]);

        if ($curlError !== null) {
            throw new ForecastError('Could not reach the model comparison service. Start it with: python backend/Python/model_arena.py', 503);
        }
        $decoded = json_decode((string)$body, true);
        if ($status !== 200 || !isset($decoded['forecast'])) {
            throw new ForecastError('Model service error: ' . ($decoded['error'] ?? 'unknown'), 502);
        }

        $arenaResult = [
            'forecast' => $decoded['forecast'],
            'accuracy' => $decoded['accuracy'] ?? null,
            'mape' => $decoded['mape'] ?? null,
            'model_name' => $decoded['model_name'] ?? "arena_$algo",
            'model_type' => $decoded['model_type'] ?? "{$algo}_model",
        ];
        cache_forecast_result($userId, $datasetId, $target, $dateColumn, $horizon, $period, [], $arenaResult, $algo);

        return [
            'forecast' => $arenaResult['forecast'],
            'accuracy' => $arenaResult['accuracy'],
            'mape' => $arenaResult['mape'],
            'model_name' => $arenaResult['model_name'],
            'model_type' => $arenaResult['model_type'],
            'dateColumn' => $dateColumn,
            'history' => $history,
            'cached' => false,
        ];
    }

    // Check if forecast result is cached (much faster than recomputing).
    // Shape matches the cache-miss return below exactly — callers (like
    // predictions.tsx reading res.model_name to persist the prediction) read
    // these fields at the top level regardless of whether this was cached.
    //
    // Skipped entirely for a tuned run: the cache table's key has no
    // per-parameter dimension (only algorithm), so a tuned request sharing
    // this dataset/target/horizon/period with a default one would either
    // read back the wrong result or overwrite the default's cache entry.
    // The suffixed $modelName above already gives a tuned run its own
    // reusable .pkl, which is the speed benefit that matters on repeat runs.
    if (!$tunedParams) {
        $cachedForecast = get_cached_forecast($userId, $datasetId, $target, $dateColumn, $horizon, $period, $validRegressors);
        if ($cachedForecast) {
            return [
                'forecast' => $cachedForecast['forecast'] ?? [],
                'accuracy' => $cachedForecast['accuracy'] ?? null,
                'mape' => $cachedForecast['mape'] ?? null,
                'baselineMape' => $cachedForecast['baselineMape'] ?? null,
                'accuracyNote' => $cachedForecast['accuracyNote'] ?? null,
                'model_name' => $cachedForecast['model_name'] ?? $modelName,
                'model_type' => $cachedForecast['model_type'] ?? 'prophet_model',
                'dateColumn' => $dateColumn,
                'history' => $history,
                'cached' => true,
            ];
        }
    }

    // Reuse a still-valid model rather than paying for another fit.
    $cached = reusable_prediction($userId, $datasetId, $target, $period, $modelName, $dataset['updated_at']);
    if ($cached) {
        $predictPayload = [
            'model_name' => $modelName,
            'interval' => $horizon,
            'freq' => $freq,
        ];

        // Add regressors for prediction if any were selected
        if ($validRegressors) {
            $regressors = [];
            foreach ($validRegressors as $regCol) {
                // For cached predictions, use zero/default values for future periods
                // In a full implementation, these could come from the user
                $regressors[] = [
                    'name' => $regCol,
                    'future_values' => array_fill(0, $horizon, 0),
                ];
            }
            $predictPayload['regressors'] = $regressors;
        }

        [$body, $status, $curlError] = post_json(prophet_predict_url(), $predictPayload);
        $decoded = json_decode((string)$body, true);
        if ($curlError === null && $status === 200 && !empty($decoded['forecast'])) {
            return [
                'forecast' => forecast_points($decoded['forecast']),
                'accuracy' => $cached['accuracy'] !== null ? (float)$cached['accuracy'] : null,
                'mape' => $cached['accuracy'] !== null ? round(100 - (float)$cached['accuracy'], 2) : null,
                'model_name' => $modelName,
                'model_type' => 'prophet_model',
                'dateColumn' => $dateColumn,
                'history' => $history,
                'cached' => true,
            ];
        }
        // Anything else (model file deleted, service down) falls through to a
        // fresh fit below.
    }

    $dateValues = [];
    $values = [];
    $regressionData = array_fill_keys($validRegressors, []);

    foreach ($rows as $row) {
        $dateValues[] = (string)($row[$dateColumn] ?? '');
        $values[] = $row[$target] ?? null;

        // Collect regressor values
        foreach ($validRegressors as $regCol) {
            $regressionData[$regCol][] = $row[$regCol] ?? null;
        }
    }

    $payload = [
        'system' => 'aurai',
        'interval' => $horizon,
        'dataset' => $values,
        'date_values' => $dateValues,
        // precision_ai.py saves the model as timeseries_<project_id>.pkl.
        'project_id' => substr($modelName, strlen('timeseries_')),
        'freq' => $freq,
    ];
    if ($tunedParams) $payload['tuned_params'] = $tunedParams;

    // Add regressors to payload if any were selected
    if ($validRegressors) {
        $regressors = [];
        foreach ($validRegressors as $regCol) {
            $regressors[] = [
                'name' => $regCol,
                'values' => $regressionData[$regCol],
                // For now, future_values are not provided; could be extended
                'future_values' => array_fill(0, $horizon, 0),
            ];
        }
        $payload['regressors'] = $regressors;
    }

    [$body, $status, $curlError] = post_json(prophet_train_url(), $payload);

    if ($curlError !== null) {
        throw new ForecastError('Could not reach the forecasting service. Start it with: python backend/Python/precision_ai.py', 503);
    }
    $decoded = json_decode($body, true);
    if ($status !== 200 || !isset($decoded['message'])) {
        throw new ForecastError('Forecasting service error: ' . ($decoded['error'] ?? 'unknown'), 502);
    }

    $message = $decoded['message'];
    $points = forecast_points($message['forecasts'] ?? []);
    if (!$points) throw new ForecastError('Forecasting service returned no points', 502);

    // Cache the forecast result for next time
    $forecastResult = [
        'forecast' => $points,
        'accuracy' => $message['accuracy'] ?? null,
        'mape' => $message['mape'] ?? null,
        'baselineMape' => $message['baseline_mape'] ?? null,
        'accuracyNote' => $message['accuracy_note'] ?? null,
        'model_name' => $message['model_name'] ?? $modelName,
        'model_type' => $message['model_type'] ?? 'prophet_model'
    ];

    if (!$tunedParams) {
        cache_forecast_result($userId, $datasetId, $target, $dateColumn, $horizon, $period, $validRegressors, $forecastResult);
    }

    return [
        'forecast' => $points,
        'accuracy' => $message['accuracy'] ?? null,
        'mape' => $message['mape'] ?? null,
        // How a flat-line forecast scored on the same holdout, so the caller
        // can see whether the model beat doing nothing.
        'baselineMape' => $message['baseline_mape'] ?? null,
        'accuracyNote' => $message['accuracy_note'] ?? null,
        'model_name' => $message['model_name'] ?? $modelName,
        'model_type' => $message['model_type'] ?? 'prophet_model',
        'dateColumn' => $dateColumn,
        'history' => $history,
        'cached' => false,
    ];
}

// The newest prediction that this model still covers, or null if the dataset
// has changed since it was made (which invalidates the trained model).
function reusable_prediction(string $userId, string $datasetId, string $target, string $period, string $modelName, string $datasetUpdatedAt): ?array {
    $stmt = db()->prepare(
        'SELECT accuracy, created_at FROM predictions
         WHERE user_id = :uid AND dataset_id = :dsid AND target = :target
           AND period = :period AND model_name = :model
         ORDER BY created_at DESC LIMIT 1'
    );
    $stmt->execute([
        ':uid' => $userId, ':dsid' => $datasetId, ':target' => $target,
        ':period' => $period, ':model' => $modelName,
    ]);
    $row = $stmt->fetch();
    if (!$row) return null;
    // The model was fitted on data as it stood then; a later edit invalidates it.
    if (strtotime($datasetUpdatedAt) > strtotime($row['created_at'])) return null;
    return $row;
}

/**
 * The tail of the recorded series, in the same shape as the forecast points.
 *
 * Capped because the chart only needs enough context to show the trend the
 * forecast continues from — a decade of daily rows would squash the projection
 * into the right-hand edge.
 */
function history_points(array $rows, string $dateColumn, string $target, int $limit = 36): array {
    $points = [];
    foreach ($rows as $row) {
        if (!is_numeric($row[$target] ?? null)) continue;
        $raw = trim((string)($row[$dateColumn] ?? ''));
        $ts = preg_match('/^\d{4}$/', $raw) ? mktime(0, 0, 0, 1, 1, (int)$raw) : strtotime($raw);
        if (!$ts) continue;
        $points[] = ['ts' => $ts, 'label' => date('Y-m-d', $ts), 'value' => round((float)$row[$target], 2)];
    }
    usort($points, fn($a, $b) => $a['ts'] <=> $b['ts']);
    $points = array_slice($points, -$limit);
    return array_map(fn($p) => ['label' => $p['label'], 'value' => $p['value']], $points);
}

// Normalizes Prophet's output into the shape the chart and table expect.
function forecast_points(array $rows): array {
    $points = [];
    $i = 0;
    foreach ($rows as $f) {
        if (!isset($f['ds'], $f['yhat'])) continue;
        $i++;
        // Prophet's `ds` arrives as epoch milliseconds once Flask serializes it.
        $ts = is_numeric($f['ds']) ? (int)($f['ds'] / 1000) : strtotime((string)$f['ds']);
        $points[] = [
            'i' => $i,
            'label' => $ts ? date('Y-m-d', $ts) : "T+$i",
            'value' => round((float)$f['yhat'], 2),
            'low' => round((float)($f['yhat_lower'] ?? $f['yhat']), 2),
            'high' => round((float)($f['yhat_upper'] ?? $f['yhat']), 2),
        ];
    }
    return $points;
}

function post_json(string $url, array $payload): array {
    $json = json_encode($payload);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $json,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Content-Length: ' . strlen($json)],
        // Prophet's Stan backend can take a minute per fit on Windows.
        CURLOPT_TIMEOUT => 300,
    ]);
    $body = curl_exec($ch);
    $error = curl_errno($ch) ? curl_error($ch) : null;
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$body, $status, $error];
}

// Model Arena — trains Prophet, ARIMA, Holt-Winters and XGBoost on the same
// series and the same backtest split, via the standalone comparison service
// in backend/Python/model_arena.py. Slower than a single forecast (multiple
// fits per request), so it is triggered explicitly rather than on every run.
function model_arena_compare(string $userId): void {
    $b = json_input();
    $datasetId = $b['datasetId'] ?? null;
    $target = $b['target'] ?? null;
    $dateColumn = $b['dateColumn'] ?? null;
    $horizon = max(1, min(60, (int)($b['horizon'] ?? 6)));
    $period = $b['period'] ?? 'Monthly';
    $models = $b['models'] ?? ['prophet', 'arima', 'holt_winters', 'xgboost', 'lightgbm', 'ensemble'];

    if (!$datasetId || !$target) fail('datasetId and target are required');

    $stmt = db()->prepare('SELECT * FROM datasets WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $datasetId, ':uid' => $userId]);
    $dataset = $stmt->fetch();
    if (!$dataset) fail('Dataset not found', 404);

    $rows = json_decode($dataset['rows'], true) ?: [];
    if (!$rows) fail('Dataset has no rows');

    $headers = array_keys($rows[0]);
    if (!in_array($target, $headers, true)) fail("Target column '$target' is not in this dataset");

    if (!$dateColumn) $dateColumn = guess_date_column($rows, $headers, $target);
    if (!$dateColumn) fail('Could not find a date column — pick one explicitly');

    $dateValues = [];
    $values = [];
    foreach ($rows as $row) {
        $dateValues[] = (string)($row[$dateColumn] ?? '');
        $values[] = $row[$target] ?? null;
    }

    $freq = PERIOD_FREQ[$period] ?? 'MS';
    $payload = [
        'dataset' => $values,
        'date_values' => $dateValues,
        'freq' => $freq,
        'interval' => $horizon,
        'models' => $models,
    ];

    [$body, $status, $curlError] = post_json(model_arena_url(), $payload);

    if ($curlError !== null) {
        fail('Could not reach the model comparison service. Start it with: python backend/Python/model_arena.py', 503);
    }
    $decoded = json_decode($body, true);
    if ($status !== 200 || !isset($decoded['results'])) {
        fail('Model comparison service error: ' . ($decoded['error'] ?? 'unknown'), 502);
    }

    respond([
        'results' => $decoded['results'],
        'forecasts' => $decoded['forecasts'],
        'bestModel' => $decoded['best_model'] ?? null,
        'ranking' => $decoded['ranking'] ?? [],
        'holdoutSize' => $decoded['holdout_size'] ?? null,
        'dateColumn' => $dateColumn,
        'history' => history_points($rows, $dateColumn, $target),
    ]);
}

// Searches a small grid of Prophet's changepoint/seasonality settings for
// the combination that scores best on this dataset's own backtest, via
// precision_ai.py's /tune. An explicit, opt-in action rather than part of
// every forecast — the grid means several Prophet fits, not one.
function forecast_tune(string $userId): void {
    $b = json_input();
    $datasetId = $b['datasetId'] ?? null;
    $target = $b['target'] ?? null;
    $dateColumn = $b['dateColumn'] ?? null;
    $period = $b['period'] ?? 'Monthly';

    if (!$datasetId || !$target) fail('datasetId and target are required');

    $stmt = db()->prepare('SELECT * FROM datasets WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $datasetId, ':uid' => $userId]);
    $dataset = $stmt->fetch();
    if (!$dataset) fail('Dataset not found', 404);

    $rows = json_decode($dataset['rows'], true) ?: [];
    if (!$rows) fail('Dataset has no rows');

    $headers = array_keys($rows[0]);
    if (!in_array($target, $headers, true)) fail("Target column '$target' is not in this dataset");

    if (!$dateColumn) $dateColumn = guess_date_column($rows, $headers, $target);
    if (!$dateColumn) fail('Could not find a date column — pick one explicitly');

    $dateValues = [];
    $values = [];
    foreach ($rows as $row) {
        $dateValues[] = (string)($row[$dateColumn] ?? '');
        $values[] = $row[$target] ?? null;
    }

    $freq = PERIOD_FREQ[$period] ?? 'MS';

    [$body, $status, $curlError] = post_json(prophet_tune_url(), [
        'dataset' => $values,
        'date_values' => $dateValues,
        'freq' => $freq,
    ]);

    if ($curlError !== null) {
        fail('Could not reach the tuning service. Start it with: python backend/Python/precision_ai.py', 503);
    }
    $decoded = json_decode((string)$body, true);
    if ($status !== 200 || !isset($decoded['best_params'])) {
        fail('Tuning service error: ' . ($decoded['error'] ?? 'unknown'), 502);
    }

    respond([
        'bestParams' => $decoded['best_params'],
        'bestAccuracy' => $decoded['best_accuracy'],
        'bestMape' => $decoded['best_mape'],
        'defaultAccuracy' => $decoded['default_accuracy'],
        'defaultMape' => $decoded['default_mape'],
        'improved' => ($decoded['best_mape'] ?? null) !== null
            && ($decoded['default_mape'] ?? null) !== null
            && $decoded['best_mape'] < $decoded['default_mape'],
        'allResults' => $decoded['all_results'] ?? [],
    ]);
}

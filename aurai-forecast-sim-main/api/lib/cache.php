<?php
/**
 * Forecast result caching utility
 * Speeds up repeat forecasts by caching results for 24 hours
 */

const FORECAST_CACHE_TTL_HOURS = 24;

/**
 * Generate a cache key from forecast parameters
 */
function forecast_cache_key(
    string $userId,
    string $datasetId,
    string $targetColumn,
    ?string $dateColumn,
    int $horizon,
    string $period,
    array $regressors = []
): string {
    $key_parts = [
        $userId,
        $datasetId,
        $targetColumn,
        $dateColumn ?? 'auto',
        (string)$horizon,
        $period,
        json_encode(sort($regressors)) // Sort for consistency
    ];
    return implode('|', $key_parts);
}

/**
 * Get cached forecast result if available and fresh
 */
function get_cached_forecast(
    string $userId,
    string $datasetId,
    string $targetColumn,
    ?string $dateColumn,
    int $horizon,
    string $period,
    array $regressors = [],
    string $algorithm = 'prophet'
): ?array {
    $db = db();

    $query = "
        SELECT forecast_result FROM forecast_cache
        WHERE user_id = :user_id
        AND dataset_id = :dataset_id
        AND target_column = :target
        AND (date_column <=> :date_col)
        AND horizon = :horizon
        AND period = :period
        AND algorithm = :algorithm
        AND (regressors <=> :regressors)
        AND created_at > DATE_SUB(NOW(), INTERVAL " . FORECAST_CACHE_TTL_HOURS . " HOUR)
        LIMIT 1
    ";

    $stmt = $db->prepare($query);
    $regressors_json = empty($regressors) ? null : json_encode($regressors);

    $params = [
        ':user_id' => $userId,
        ':dataset_id' => $datasetId,
        ':target' => $targetColumn,
        ':date_col' => $dateColumn,
        ':horizon' => $horizon,
        ':period' => $period,
        ':algorithm' => $algorithm,
        ':regressors' => $regressors_json
    ];

    $stmt->execute($params);

    $row = $stmt->fetch();
    if (!$row) return null;

    // Update hit count
    $updateQuery = "
        UPDATE forecast_cache
        SET hit_count = hit_count + 1, accessed_at = NOW()
        WHERE user_id = :user_id
        AND dataset_id = :dataset_id
        AND target_column = :target
        AND (date_column <=> :date_col)
        AND horizon = :horizon
        AND period = :period
        AND algorithm = :algorithm
        AND (regressors <=> :regressors)
    ";

    $updateStmt = $db->prepare($updateQuery);
    $updateStmt->execute($params);

    return json_decode($row['forecast_result'], true);
}

/**
 * Store forecast result in cache
 */
function cache_forecast_result(
    string $userId,
    string $datasetId,
    string $targetColumn,
    ?string $dateColumn,
    int $horizon,
    string $period,
    array $regressors,
    array $forecastResult,
    string $algorithm = 'prophet'
): bool {
    $db = db();
    $id = uuid4();
    $regressors_json = empty($regressors) ? null : json_encode($regressors);

    $query = "
        INSERT INTO forecast_cache
        (id, user_id, dataset_id, target_column, date_column, horizon, period, algorithm, regressors, forecast_result)
        VALUES (:id, :user_id, :dataset_id, :target, :date_col, :horizon, :period, :algorithm, :regressors, :result)
        ON DUPLICATE KEY UPDATE
            forecast_result = VALUES(forecast_result),
            created_at = NOW(),
            accessed_at = NOW(),
            hit_count = 1
    ";

    $stmt = $db->prepare($query);

    $success = $stmt->execute([
        ':id' => $id,
        ':user_id' => $userId,
        ':dataset_id' => $datasetId,
        ':target' => $targetColumn,
        ':date_col' => $dateColumn,
        ':horizon' => $horizon,
        ':period' => $period,
        ':algorithm' => $algorithm,
        ':regressors' => $regressors_json,
        ':result' => json_encode($forecastResult)
    ]);

    return $success;
}

/**
 * Clear expired cache entries (older than TTL). No cron exists in this
 * deployment, so this is called opportunistically (low-probability, from
 * forecast_run) rather than on a schedule — see clear_expired_forecast_cache_occasionally().
 */
function clear_expired_forecast_cache(): int {
    $db = db();
    $query = "
        DELETE FROM forecast_cache
        WHERE created_at < DATE_SUB(NOW(), INTERVAL " . FORECAST_CACHE_TTL_HOURS . " HOUR)
    ";
    $stmt = $db->prepare($query);
    $stmt->execute();
    return $stmt->rowCount();
}

/**
 * Runs the cleanup above roughly 1 in 20 calls instead of every one — cheap
 * enough to skip a dedicated cron, without adding a DELETE scan to every
 * single forecast request.
 */
function clear_expired_forecast_cache_occasionally(): void {
    if (random_int(1, 20) === 1) {
        try { clear_expired_forecast_cache(); } catch (Exception $e) { error_log($e->getMessage()); }
    }
}

/**
 * Clear all cache for a specific dataset — called when its rows change, so
 * a forecast never serves a cached result computed from data that's since
 * been edited or appended to. Without this, a stale forecast could sit in
 * cache for up to FORECAST_CACHE_TTL_HOURS after the underlying data moved.
 */
function invalidate_dataset_cache(string $datasetId): int {
    $db = db();
    $query = "DELETE FROM forecast_cache WHERE dataset_id = :id";
    $stmt = $db->prepare($query);
    $stmt->execute([':id' => $datasetId]);
    return $stmt->rowCount();
}

/**
 * Get cache statistics for monitoring
 */
function get_cache_stats(string $userId): array {
    $db = db();
    $query = "
        SELECT
            COUNT(*) as total_entries,
            SUM(hit_count) as total_hits,
            AVG(hit_count) as avg_hits_per_entry,
            ROUND(SUM(CHAR_LENGTH(forecast_result))/1024/1024, 2) as size_mb
        FROM forecast_cache
        WHERE user_id = :user_id
    ";
    $stmt = $db->prepare($query);
    $stmt->execute([':user_id' => $userId]);
    return $stmt->fetch() ?: [];
}
?>

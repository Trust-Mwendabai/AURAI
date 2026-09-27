<?php
/**
 * Data export endpoints (CSV)
 *
 * Endpoints:
 * - GET /export/forecast/:id/csv — Export forecast (history + prediction) as CSV
 * - GET /export/dataset/:id/csv — Export a dataset's raw rows as CSV
 */

require_once __DIR__ . '/lib/helpers.php';
// history_points() / guess_date_column() live in forecast.php; requiring it
// only pulls in function definitions, it has no top-level side effects.
require_once __DIR__ . '/forecast.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = array_values(array_filter(explode('/', $path)));

$exportIndex = array_search('export', $segments);
$resourceType = isset($segments[$exportIndex + 1]) ? $segments[$exportIndex + 1] : null; // 'forecast' or 'dataset'
$resourceId = isset($segments[$exportIndex + 2]) ? $segments[$exportIndex + 2] : null;
$format = isset($segments[$exportIndex + 3]) ? $segments[$exportIndex + 3] : 'csv';

$userId = require_auth();
$db = db();

function slugify($text) {
  $text = preg_replace('~[^\pL\d]+~u', '-', $text);
  $text = iconv('utf-8', 'us-ascii//TRANSLIT', $text);
  $text = preg_replace('~[^-\w]+~', '', $text);
  $text = preg_replace('~-+~', '-', $text);
  return trim($text, '-') ?: 'export';
}

// Quotes a CSV field, doubling any embedded quotes per RFC 4180.
function csv_cell($v) {
  $s = $v === null ? '' : (string)$v;
  return (strpos($s, ',') !== false || strpos($s, '"') !== false || strpos($s, "\n") !== false)
    ? '"' . str_replace('"', '""', $s) . '"'
    : $s;
}

try {
  // GET /export/forecast/:id/csv — Export forecast with recorded history
  if ($method === 'GET' && $resourceType === 'forecast' && $resourceId && $format === 'csv') {
    $stmt = $db->prepare('SELECT * FROM predictions WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $resourceId, ':uid' => $userId]);
    $prediction = $stmt->fetch();

    if (!$prediction) fail('Forecast not found', 404);

    $forecast = json_decode($prediction['forecast'], true) ?: [];
    $datasetName = null;
    $history = [];

    if ($prediction['dataset_id']) {
      $dsStmt = $db->prepare('SELECT * FROM datasets WHERE id = :id AND user_id = :uid');
      $dsStmt->execute([':id' => $prediction['dataset_id'], ':uid' => $userId]);
      $dataset = $dsStmt->fetch();

      if ($dataset) {
        $datasetName = $dataset['name'];
        $rows = json_decode($dataset['rows'], true) ?: [];
        if ($rows && $prediction['target']) {
          $headers = array_keys($rows[0]);
          $dateColumn = guess_date_column($rows, $headers, $prediction['target']);
          if ($dateColumn) {
            $history = history_points($rows, $dateColumn, $prediction['target']);
          }
        }
      }
    }

    // Build CSV: provenance block, then a combined history + forecast table
    $lines = [];
    $lines[] = csv_cell('Forecast') . ',' . csv_cell($prediction['name']);
    if ($datasetName) $lines[] = csv_cell('Dataset') . ',' . csv_cell($datasetName);
    $lines[] = csv_cell('Target') . ',' . csv_cell($prediction['target']);
    $lines[] = csv_cell('Algorithm') . ',' . csv_cell($prediction['algorithm']);
    $lines[] = csv_cell('Horizon') . ',' . csv_cell(trim("{$prediction['horizon']} {$prediction['period']}"));
    $lines[] = csv_cell('Accuracy') . ',' . csv_cell($prediction['accuracy'] !== null ? "{$prediction['accuracy']}%" : 'not scored');
    $lines[] = csv_cell('Generated') . ',' . csv_cell(date('Y-m-d H:i:s', strtotime($prediction['created_at'])));
    $lines[] = '';
    $lines[] = 'Period,Recorded,Forecast Estimate,Lower Bound,Upper Bound';

    foreach ($history as $point) {
      $lines[] = implode(',', array_map('csv_cell', [$point['label'], $point['value'], '', '', '']));
    }
    foreach ($forecast as $point) {
      $low = $point['low'] ?? $point['value'];
      $high = $point['high'] ?? $point['value'];
      $lines[] = implode(',', array_map('csv_cell', [$point['label'] ?? '', '', $point['value'] ?? '', $low, $high]));
    }

    // BOM so Excel opens the file as UTF-8 instead of the local codepage.
    $csv = "\xEF\xBB\xBF" . implode("\r\n", $lines);

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="forecast_' . slugify($prediction['name']) . '_' . date('Y-m-d') . '.csv"');
    echo $csv;
    exit;
  }

  // GET /export/dataset/:id/csv — Export a dataset's raw rows
  if ($method === 'GET' && $resourceType === 'dataset' && $resourceId && $format === 'csv') {
    $stmt = $db->prepare('SELECT * FROM datasets WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $resourceId, ':uid' => $userId]);
    $dataset = $stmt->fetch();

    if (!$dataset) fail('Dataset not found', 404);

    $rows = json_decode($dataset['rows'], true) ?: [];
    $lines = [];

    if ($rows) {
      $headers = array_keys($rows[0]);
      $lines[] = implode(',', array_map('csv_cell', $headers));
      foreach ($rows as $row) {
        $lines[] = implode(',', array_map(fn($h) => csv_cell($row[$h] ?? ''), $headers));
      }
    }

    $csv = "\xEF\xBB\xBF" . implode("\r\n", $lines);

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="dataset_' . slugify($dataset['name']) . '_' . date('Y-m-d') . '.csv"');
    echo $csv;
    exit;
  }

  fail('Endpoint not found', 404);

} catch (PDOException $e) {
  error_log($e->getMessage());
  fail('Database error', 500);
}

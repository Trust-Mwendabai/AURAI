<?php
/**
 * Anomaly detection endpoints
 *
 * Endpoints:
 * - GET /anomalies — list anomalies for a prediction
 * - POST /anomalies — create anomaly
 * - POST /anomalies/detect — compare a forecast against actuals that have
 *   since arrived in its dataset, and record any that fell outside the
 *   forecasted range
 * - PATCH /anomalies/:id — update anomaly (add note, acknowledge)
 * - DELETE /anomalies/:id — delete anomaly
 */

require_once __DIR__ . '/lib/helpers.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = array_values(array_filter(explode('/', $path)));

$anomalyIndex = array_search('anomalies', $segments);
$anomalyId = $anomalyIndex !== false && isset($segments[$anomalyIndex + 1]) ? $segments[$anomalyIndex + 1] : null;

$userId = require_auth();
$db = db();

/**
 * A forecast is only ever "wrong" once time has passed and a real value
 * exists for a date it predicted. This finds those dates in the dataset's
 * current rows, compares them against the forecast's own low/high band,
 * and records anything outside it — skipping dates already recorded so
 * running detection twice doesn't duplicate rows.
 */
function detect_anomalies_for_prediction($db, $userId, $predictionId) {
  $stmt = $db->prepare('SELECT * FROM predictions WHERE id = :pid AND user_id = :uid');
  $stmt->execute([':pid' => $predictionId, ':uid' => $userId]);
  $prediction = $stmt->fetch();
  if (!$prediction || !$prediction['dataset_id']) return ['created' => 0, 'checked' => 0];

  $dsStmt = $db->prepare('SELECT * FROM datasets WHERE id = :id AND user_id = :uid');
  $dsStmt->execute([':id' => $prediction['dataset_id'], ':uid' => $userId]);
  $dataset = $dsStmt->fetch();
  if (!$dataset) return ['created' => 0, 'checked' => 0];

  $rows = json_decode($dataset['rows'], true) ?: [];
  $target = $prediction['target'];
  $forecast = json_decode($prediction['forecast'], true) ?: [];
  if (!$rows || !$target || !$forecast) return ['created' => 0, 'checked' => 0];

  // Actuals indexed by date (Y-m-d), same normalization the forecast's own
  // labels use, so a forecast point can be looked up by its label directly.
  $headers = array_keys($rows[0]);
  $dateColumn = null;
  foreach ($headers as $h) {
    if ($h === $target) continue;
    $hits = 0;
    $sample = array_slice($rows, 0, 20);
    foreach ($sample as $row) {
      $v = trim((string)($row[$h] ?? ''));
      if ($v !== '' && (preg_match('/^\d{4}$/', $v) || strtotime($v) !== false)) $hits++;
    }
    if ($hits / max(1, count($sample)) >= 0.6) { $dateColumn = $h; break; }
  }
  if (!$dateColumn) return ['created' => 0, 'checked' => 0];

  $actualsByDate = [];
  foreach ($rows as $row) {
    if (!is_numeric($row[$target] ?? null)) continue;
    $ts = strtotime((string)($row[$dateColumn] ?? ''));
    if (!$ts) continue;
    $actualsByDate[date('Y-m-d', $ts)] = (float)$row[$target];
  }

  $checked = 0;
  $created = 0;
  foreach ($forecast as $point) {
    $label = $point['label'] ?? null;
    if (!$label || !isset($actualsByDate[$label])) continue;
    $checked++;

    $actual = $actualsByDate[$label];
    $low = (float)($point['low'] ?? $point['value']);
    $high = (float)($point['high'] ?? $point['value']);
    $value = (float)($point['value'] ?? 0);

    $type = null;
    if ($actual > $high) $type = 'above_upper';
    elseif ($actual < $low) $type = 'below_lower';
    if (!$type) continue; // within bounds — not an anomaly, nothing to record

    // Already recorded for this prediction + date — skip rather than
    // duplicate on a repeat detection run.
    $existsStmt = $db->prepare('SELECT id FROM anomalies WHERE prediction_id = :pid AND date = :date');
    $existsStmt->execute([':pid' => $predictionId, ':date' => $label]);
    if ($existsStmt->fetch()) continue;

    $band = $high - $low;
    $deviationSigma = $band > 0 ? round(abs($actual - $value) / ($band / 4), 2) : 0; // low/high approximate a ~2-sigma band

    $db->prepare(
      'INSERT INTO anomalies
       (id, user_id, prediction_id, date, actual_value, forecasted_value, lower_bound, upper_bound, deviation_sigma, anomaly_type, acknowledged)
       VALUES (:id, :uid, :pid, :date, :actual, :forecasted, :lower, :upper, :sigma, :type, 0)'
    )->execute([
      ':id' => uuid4(),
      ':uid' => $userId,
      ':pid' => $predictionId,
      ':date' => $label,
      ':actual' => $actual,
      ':forecasted' => $value,
      ':lower' => $low,
      ':upper' => $high,
      ':sigma' => $deviationSigma,
      ':type' => $type,
    ]);
    $created++;
  }

  return ['created' => $created, 'checked' => $checked];
}

try {
  // POST /anomalies/detect — run detection for one prediction
  if ($method === 'POST' && $anomalyId === 'detect') {
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $predictionId = $data['prediction_id'] ?? null;
    if (!$predictionId) {
      http_response_code(400);
      echo json_encode(['error' => 'prediction_id required']);
      exit;
    }
    $result = detect_anomalies_for_prediction($db, $userId, $predictionId);
    echo json_encode(['success' => true] + $result);
    exit;
  }

  // GET /anomalies — list anomalies with filters
  if ($method === 'GET' && $anomalyId === null) {
    $predictionId = $_GET['prediction_id'] ?? null;
    $startDate = $_GET['start_date'] ?? null;
    $endDate = $_GET['end_date'] ?? null;
    $onlyUnacknowledged = ($_GET['only_unacknowledged'] ?? null) === 'true';
    $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    $where = ['a.user_id = :uid'];
    $params = [':uid' => $userId];

    if ($predictionId) {
      $where[] = 'a.prediction_id = :pid';
      $params[':pid'] = $predictionId;
    }
    if ($startDate) {
      $where[] = 'a.date >= :start_date';
      $params[':start_date'] = $startDate;
    }
    if ($endDate) {
      $where[] = 'a.date <= :end_date';
      $params[':end_date'] = $endDate;
    }
    if ($onlyUnacknowledged) {
      $where[] = 'a.acknowledged = 0';
    }

    $whereClause = implode(' AND ', $where);

    $query = "
      SELECT a.*, p.name as prediction_name
      FROM anomalies a
      JOIN predictions p ON a.prediction_id = p.id
      WHERE $whereClause
      ORDER BY a.date DESC
      LIMIT $limit OFFSET $offset
    ";

    $stmt = $db->prepare($query);
    $stmt->execute($params);
    $anomalies = $stmt->fetchAll();

    foreach ($anomalies as &$a) {
      $a['actual_value'] = (float) $a['actual_value'];
      $a['forecasted_value'] = (float) $a['forecasted_value'];
      $a['lower_bound'] = (float) $a['lower_bound'];
      $a['upper_bound'] = (float) $a['upper_bound'];
      $a['deviation_sigma'] = (float) $a['deviation_sigma'];
      $a['acknowledged'] = (bool) $a['acknowledged'];
    }

    echo json_encode($anomalies);
    exit;
  }

  // POST /anomalies — create anomaly
  if ($method === 'POST' && $anomalyId === null) {
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $predictionId = $data['prediction_id'] ?? null;
    $date = $data['date'] ?? null;
    $actualValue = $data['actual_value'] ?? null;
    $forecastedValue = $data['forecasted_value'] ?? null;
    $lowerBound = $data['lower_bound'] ?? null;
    $upperBound = $data['upper_bound'] ?? null;
    $deviationSigma = $data['deviation_sigma'] ?? null;
    $anomalyType = $data['anomaly_type'] ?? 'within_bounds';
    $note = $data['note'] ?? null;

    $stmt = $db->prepare('SELECT id FROM predictions WHERE id = :pid AND user_id = :uid');
    $stmt->execute([':pid' => $predictionId, ':uid' => $userId]);
    if (!$stmt->fetch()) {
      http_response_code(404);
      echo json_encode(['error' => 'prediction not found']);
      exit;
    }

    $id = uuid4();
    $query = "
      INSERT INTO anomalies
      (id, user_id, prediction_id, date, actual_value, forecasted_value, lower_bound, upper_bound, deviation_sigma, anomaly_type, note, acknowledged)
      VALUES (:id, :uid, :pid, :date, :actual, :forecasted, :lower, :upper, :sigma, :type, :note, 0)
    ";
    $db->prepare($query)->execute([
      ':id' => $id,
      ':uid' => $userId,
      ':pid' => $predictionId,
      ':date' => $date,
      ':actual' => $actualValue,
      ':forecasted' => $forecastedValue,
      ':lower' => $lowerBound,
      ':upper' => $upperBound,
      ':sigma' => $deviationSigma,
      ':type' => $anomalyType,
      ':note' => $note,
    ]);

    echo json_encode(['id' => $id]);
    exit;
  }

  // PATCH /anomalies/:id — update anomaly
  if ($method === 'PATCH' && $anomalyId) {
    $stmt = $db->prepare('SELECT id FROM anomalies WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $anomalyId, ':uid' => $userId]);
    if (!$stmt->fetch()) {
      http_response_code(404);
      echo json_encode(['error' => 'anomaly not found']);
      exit;
    }

    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $updates = [];
    $params = [':id' => $anomalyId];

    if (isset($data['note'])) {
      $updates[] = 'note = :note';
      $params[':note'] = $data['note'];
    }
    if (isset($data['acknowledged'])) {
      $updates[] = 'acknowledged = :acknowledged';
      $params[':acknowledged'] = $data['acknowledged'] ? 1 : 0;
    }

    if (!empty($updates)) {
      $query = "UPDATE anomalies SET " . implode(', ', $updates) . " WHERE id = :id";
      $db->prepare($query)->execute($params);
    }

    echo json_encode(['success' => true]);
    exit;
  }

  // DELETE /anomalies/:id — delete anomaly
  if ($method === 'DELETE' && $anomalyId) {
    $stmt = $db->prepare('DELETE FROM anomalies WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $anomalyId, ':uid' => $userId]);

    if ($stmt->rowCount() === 0) {
      http_response_code(404);
      echo json_encode(['error' => 'anomaly not found']);
      exit;
    }

    echo json_encode(['success' => true]);
    exit;
  }

  http_response_code(404);
  echo json_encode(['error' => 'endpoint not found']);

} catch (Exception $e) {
  error_log($e->getMessage());
  http_response_code(500);
  echo json_encode(['error' => $e->getMessage()]);
}

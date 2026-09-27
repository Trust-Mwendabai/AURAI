<?php
/**
 * Scenario modeling endpoints (what-if analysis)
 *
 * Endpoints:
 * - GET /scenarios — list scenarios for a prediction
 * - POST /scenarios — create scenario
 * - PATCH /scenarios/:id — update scenario
 * - DELETE /scenarios/:id — delete scenario
 * - POST /scenarios/:id/calculate — calculate scenario results
 * - POST /scenarios/compare — compare multiple scenarios
 */

require_once __DIR__ . '/lib/helpers.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = array_values(array_filter(explode('/', $path)));

$scenarioIndex = array_search('scenarios', $segments);
$scenarioId = $scenarioIndex !== false && isset($segments[$scenarioIndex + 1]) ? $segments[$scenarioIndex + 1] : null;
$calculateIndex = array_search('calculate', $segments);
$compareIndex = array_search('compare', $segments);

$userId = require_auth();
$db = db();

try {
  // GET /scenarios — list scenarios for prediction
  if ($method === 'GET' && $scenarioId === null && $compareIndex === false) {
    $predictionId = $_GET['prediction_id'] ?? null;
    $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    $where = ['s.user_id = :uid'];
    $params = [':uid' => $userId];

    if ($predictionId) {
      $where[] = 's.prediction_id = :pid';
      $params[':pid'] = $predictionId;
    }

    $whereClause = implode(' AND ', $where);

    $query = "
      SELECT s.*, p.name as prediction_name
      FROM scenarios s
      JOIN predictions p ON s.prediction_id = p.id
      WHERE $whereClause
      ORDER BY s.is_baseline DESC, s.created_at DESC
      LIMIT $limit OFFSET $offset
    ";

    $stmt = $db->prepare($query);
    $stmt->execute($params);
    $scenarios = $stmt->fetchAll();

    foreach ($scenarios as &$s) {
      $s['adjustments'] = json_decode($s['adjustments'], true) ?: [];
      $s['results'] = json_decode($s['results'], true) ?: [];
      $s['is_baseline'] = (bool) $s['is_baseline'];
    }

    echo json_encode($scenarios);
    exit;
  }

  // POST /scenarios — create scenario
  if ($method === 'POST' && $scenarioId === null && $calculateIndex === false && $compareIndex === false) {
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $predictionId = $data['prediction_id'] ?? null;
    $name = $data['name'] ?? 'Scenario';
    $description = $data['description'] ?? null;
    $adjustments = $data['adjustments'] ?? [];
    $results = $data['results'] ?? [];
    $isBaseline = $data['is_baseline'] ?? false;

    $stmt = $db->prepare('SELECT id FROM predictions WHERE id = :pid AND user_id = :uid');
    $stmt->execute([':pid' => $predictionId, ':uid' => $userId]);
    if (!$stmt->fetch()) {
      http_response_code(404);
      echo json_encode(['error' => 'prediction not found']);
      exit;
    }

    $id = uuid4();
    $query = "
      INSERT INTO scenarios
      (id, user_id, prediction_id, name, description, adjustments, results, is_baseline)
      VALUES (:id, :uid, :pid, :name, :description, :adjustments, :results, :baseline)
    ";
    $db->prepare($query)->execute([
      ':id' => $id,
      ':uid' => $userId,
      ':pid' => $predictionId,
      ':name' => $name,
      ':description' => $description,
      ':adjustments' => json_encode($adjustments),
      ':results' => json_encode($results),
      ':baseline' => $isBaseline ? 1 : 0,
    ]);

    echo json_encode(['id' => $id, 'name' => $name]);
    exit;
  }

  // PATCH /scenarios/:id — update scenario
  if ($method === 'PATCH' && $scenarioId && $calculateIndex === false) {
    $stmt = $db->prepare('SELECT id FROM scenarios WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $scenarioId, ':uid' => $userId]);
    if (!$stmt->fetch()) {
      http_response_code(404);
      echo json_encode(['error' => 'scenario not found']);
      exit;
    }

    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $updates = [];
    $params = [':id' => $scenarioId];

    if (isset($data['name'])) {
      $updates[] = 'name = :name';
      $params[':name'] = $data['name'];
    }
    if (isset($data['description'])) {
      $updates[] = 'description = :description';
      $params[':description'] = $data['description'];
    }
    if (isset($data['adjustments'])) {
      $updates[] = 'adjustments = :adjustments';
      $params[':adjustments'] = json_encode($data['adjustments']);
    }
    if (isset($data['results'])) {
      $updates[] = 'results = :results';
      $params[':results'] = json_encode($data['results']);
    }

    if (!empty($updates)) {
      $query = "UPDATE scenarios SET " . implode(', ', $updates) . " WHERE id = :id";
      $db->prepare($query)->execute($params);
    }

    echo json_encode(['success' => true]);
    exit;
  }

  // POST /scenarios/:id/calculate — calculate scenario results
  if ($method === 'POST' && $scenarioId && $calculateIndex !== false) {
    $query = "
      SELECT s.*, p.forecast, p.horizon, p.period
      FROM scenarios s
      JOIN predictions p ON s.prediction_id = p.id
      WHERE s.id = :id AND s.user_id = :uid
    ";
    $stmt = $db->prepare($query);
    $stmt->execute([':id' => $scenarioId, ':uid' => $userId]);
    $scenario = $stmt->fetch();
    if (!$scenario) {
      http_response_code(404);
      echo json_encode(['error' => 'scenario not found']);
      exit;
    }

    $forecast = json_decode($scenario['forecast'], true) ?: [];
    $adjustments = json_decode($scenario['adjustments'], true) ?: [];

    // Apply adjustments to forecast
    $adjusted = $forecast;
    foreach ($adjustments as $adj) {
      $period = $adj['period'] ?? null;
      if ($period !== null && isset($adjusted[$period])) {
        $adjusted[$period]['value'] = $adj['value'];
      }
    }

    $results = calculateScenarioResults($adjusted);

    $db->prepare('UPDATE scenarios SET results = :results WHERE id = :id')
       ->execute([':results' => json_encode($results), ':id' => $scenarioId]);

    echo json_encode($results);
    exit;
  }

  // DELETE /scenarios/:id — delete scenario
  if ($method === 'DELETE' && $scenarioId && $calculateIndex === false) {
    $stmt = $db->prepare('DELETE FROM scenarios WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $scenarioId, ':uid' => $userId]);

    if ($stmt->rowCount() === 0) {
      http_response_code(404);
      echo json_encode(['error' => 'scenario not found']);
      exit;
    }

    echo json_encode(['success' => true]);
    exit;
  }

  // POST /scenarios/compare — compare multiple scenarios
  if ($method === 'POST' && $compareIndex !== false) {
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $scenarioIds = $data['scenario_ids'] ?? [];
    $name = $data['name'] ?? 'Comparison';

    if (empty($scenarioIds)) {
      http_response_code(400);
      echo json_encode(['error' => 'scenario_ids required']);
      exit;
    }

    // Verify all scenarios belong to user
    $placeholders = [];
    $params = [':uid' => $userId];
    foreach ($scenarioIds as $i => $sid) {
      $key = ":sid$i";
      $placeholders[] = $key;
      $params[$key] = $sid;
    }
    $query = "SELECT id FROM scenarios WHERE id IN (" . implode(',', $placeholders) . ") AND user_id = :uid";

    $stmt = $db->prepare($query);
    $stmt->execute($params);
    if (count($stmt->fetchAll()) !== count($scenarioIds)) {
      http_response_code(400);
      echo json_encode(['error' => 'some scenarios not found']);
      exit;
    }

    $comparisonId = uuid4();
    $db->prepare('INSERT INTO scenario_comparisons (id, user_id, name, scenario_ids) VALUES (:id, :uid, :name, :ids)')
       ->execute([
         ':id' => $comparisonId,
         ':uid' => $userId,
         ':name' => $name,
         ':ids' => json_encode($scenarioIds),
       ]);

    echo json_encode(['id' => $comparisonId, 'name' => $name]);
    exit;
  }

  http_response_code(404);
  echo json_encode(['error' => 'endpoint not found']);

} catch (Exception $e) {
  error_log($e->getMessage());
  http_response_code(500);
  echo json_encode(['error' => $e->getMessage()]);
}

/**
 * Calculate scenario results from adjusted forecast
 */
function calculateScenarioResults($adjusted) {
  $values = array_map(fn($point) => (float)($point['value'] ?? 0), $adjusted);
  $count = count($values);

  if ($count === 0) {
    return ['total' => 0, 'average' => 0, 'peak' => 0, 'trough' => 0, 'std_dev' => 0, 'growth_rate' => 0, 'count' => 0];
  }

  $total = array_sum($values);
  $average = $total / $count;
  $peak = max($values);
  $trough = min($values);

  $variance = 0;
  foreach ($values as $v) {
    $variance += pow($v - $average, 2);
  }
  $stdDev = sqrt($variance / $count);

  $growthRate = ($count > 1 && $values[0] != 0)
    ? (($values[$count - 1] - $values[0]) / $values[0]) * 100
    : 0;

  return [
    'total' => round($total, 2),
    'average' => round($average, 2),
    'peak' => round($peak, 2),
    'trough' => round($trough, 2),
    'std_dev' => round($stdDev, 2),
    'growth_rate' => round($growthRate, 2),
    'count' => $count,
  ];
}

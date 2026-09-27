<?php
/**
 * Saved reports and forecast bookmarks API
 *
 * Endpoints:
 * - GET /saved-reports — list saved reports
 * - POST /saved-reports — create saved report
 * - GET /saved-reports/:id — get report details
 * - PATCH /saved-reports/:id — update report
 * - DELETE /saved-reports/:id — delete report
 * - POST /forecast-bookmarks — bookmark a forecast
 * - DELETE /forecast-bookmarks/:predictionId — remove bookmark
 * - GET /forecast-bookmarks — list bookmarked forecasts
 */

require_once __DIR__ . '/lib/helpers.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = array_values(array_filter(explode('/', $path)));

$reportIndex = array_search('saved-reports', $segments);
$reportId = $reportIndex !== false && isset($segments[$reportIndex + 1]) ? $segments[$reportIndex + 1] : null;
$bookmarkIndex = array_search('forecast-bookmarks', $segments);
$predictionId = $bookmarkIndex !== false && isset($segments[$bookmarkIndex + 1]) ? $segments[$bookmarkIndex + 1] : null;

$userId = require_auth();
$db = db();

try {
  // GET /saved-reports — list all saved reports for user
  if ($method === 'GET' && $reportIndex !== false && $reportId === null) {
    $workspace = $_GET['workspace_id'] ?? null;
    $pinned = $_GET['pinned'] ?? null;
    $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    $where = ['sr.user_id = :uid'];
    $params = [':uid' => $userId];

    if ($workspace) {
      $where[] = 'sr.workspace_id = :workspace';
      $params[':workspace'] = $workspace;
    }
    if ($pinned === 'true') {
      $where[] = 'sr.pinned = 1';
    } elseif ($pinned === 'false') {
      $where[] = 'sr.pinned = 0';
    }

    $whereClause = implode(' AND ', $where);

    $query = "
      SELECT sr.*
      FROM saved_reports sr
      WHERE $whereClause
      ORDER BY sr.pinned DESC, sr.position ASC, sr.updated_at DESC
      LIMIT $limit OFFSET $offset
    ";

    $stmt = $db->prepare($query);
    $stmt->execute($params);
    $reports = $stmt->fetchAll();

    foreach ($reports as &$r) {
      $r['config'] = json_decode($r['config'], true) ?: [];
      $r['pinned'] = (bool) $r['pinned'];
    }

    echo json_encode($reports);
    exit;
  }

  // POST /saved-reports — create saved report
  if ($method === 'POST' && $reportIndex !== false && $reportId === null) {
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $name = $data['name'] ?? 'Saved Report';
    $description = $data['description'] ?? null;
    $config = $data['config'] ?? [];
    $workspaceId = $data['workspace_id'] ?? null;

    $id = uuid4();
    $configJson = json_encode($config);

    $query = "
      INSERT INTO saved_reports (id, user_id, workspace_id, name, description, config)
      VALUES (:id, :uid, :workspace_id, :name, :description, :config)
    ";
    $stmt = $db->prepare($query);
    $stmt->execute([
      ':id' => $id,
      ':uid' => $userId,
      ':workspace_id' => $workspaceId,
      ':name' => $name,
      ':description' => $description,
      ':config' => $configJson,
    ]);

    echo json_encode(['id' => $id, 'name' => $name]);
    exit;
  }

  // GET /saved-reports/:id — get report details
  if ($method === 'GET' && $reportIndex !== false && $reportId) {
    $stmt = $db->prepare('SELECT * FROM saved_reports WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $reportId, ':uid' => $userId]);
    $report = $stmt->fetch();

    if (!$report) {
      http_response_code(404);
      echo json_encode(['error' => 'report not found']);
      exit;
    }

    $report['config'] = json_decode($report['config'], true) ?: [];
    $report['pinned'] = (bool) $report['pinned'];

    $db->prepare('UPDATE saved_reports SET view_count = view_count + 1, last_viewed_at = NOW() WHERE id = :id')
       ->execute([':id' => $reportId]);

    echo json_encode($report);
    exit;
  }

  // PATCH /saved-reports/:id — update report
  if ($method === 'PATCH' && $reportIndex !== false && $reportId) {
    $stmt = $db->prepare('SELECT id FROM saved_reports WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $reportId, ':uid' => $userId]);
    if (!$stmt->fetch()) {
      http_response_code(404);
      echo json_encode(['error' => 'report not found']);
      exit;
    }

    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $updates = [];
    $params = [':id' => $reportId];

    if (isset($data['name'])) {
      $updates[] = 'name = :name';
      $params[':name'] = $data['name'];
    }
    if (isset($data['description'])) {
      $updates[] = 'description = :description';
      $params[':description'] = $data['description'];
    }
    if (isset($data['config'])) {
      $updates[] = 'config = :config';
      $params[':config'] = json_encode($data['config']);
    }
    if (isset($data['pinned'])) {
      $updates[] = 'pinned = :pinned';
      $params[':pinned'] = $data['pinned'] ? 1 : 0;
    }
    if (isset($data['position'])) {
      $updates[] = 'position = :position';
      $params[':position'] = (int)$data['position'];
    }

    if (!empty($updates)) {
      $query = "UPDATE saved_reports SET " . implode(', ', $updates) . " WHERE id = :id";
      $db->prepare($query)->execute($params);
    }

    echo json_encode(['success' => true]);
    exit;
  }

  // DELETE /saved-reports/:id — delete report
  if ($method === 'DELETE' && $reportIndex !== false && $reportId) {
    $stmt = $db->prepare('DELETE FROM saved_reports WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $reportId, ':uid' => $userId]);

    if ($stmt->rowCount() === 0) {
      http_response_code(404);
      echo json_encode(['error' => 'report not found']);
      exit;
    }

    echo json_encode(['success' => true]);
    exit;
  }

  // POST /forecast-bookmarks — bookmark a forecast
  if ($method === 'POST' && $bookmarkIndex !== false && $predictionId === null) {
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $predictionId = $data['prediction_id'] ?? null;
    $folder = $data['folder'] ?? 'default';

    if (!$predictionId) {
      http_response_code(400);
      echo json_encode(['error' => 'prediction_id required']);
      exit;
    }

    $stmt = $db->prepare('SELECT id FROM predictions WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $predictionId, ':uid' => $userId]);
    if (!$stmt->fetch()) {
      http_response_code(404);
      echo json_encode(['error' => 'prediction not found']);
      exit;
    }

    $id = uuid4();
    $query = "
      INSERT INTO forecast_bookmarks (id, user_id, prediction_id, folder)
      VALUES (:id, :uid, :pid, :folder)
      ON DUPLICATE KEY UPDATE folder = VALUES(folder)
    ";
    $db->prepare($query)->execute([
      ':id' => $id,
      ':uid' => $userId,
      ':pid' => $predictionId,
      ':folder' => $folder,
    ]);

    echo json_encode(['success' => true, 'id' => $id]);
    exit;
  }

  // DELETE /forecast-bookmarks/:predictionId — remove bookmark
  if ($method === 'DELETE' && $bookmarkIndex !== false && $predictionId) {
    $stmt = $db->prepare('DELETE FROM forecast_bookmarks WHERE prediction_id = :pid AND user_id = :uid');
    $stmt->execute([':pid' => $predictionId, ':uid' => $userId]);

    echo json_encode(['success' => true]);
    exit;
  }

  // GET /forecast-bookmarks — list bookmarked forecasts
  if ($method === 'GET' && $bookmarkIndex !== false && $predictionId === null) {
    $folder = $_GET['folder'] ?? null;

    $where = ['fb.user_id = :uid'];
    $params = [':uid' => $userId];

    if ($folder) {
      $where[] = 'fb.folder = :folder';
      $params[':folder'] = $folder;
    }

    $whereClause = implode(' AND ', $where);

    $query = "
      SELECT fb.*, p.name as prediction_name, p.target, p.accuracy, d.name as dataset_name
      FROM forecast_bookmarks fb
      JOIN predictions p ON fb.prediction_id = p.id
      LEFT JOIN datasets d ON p.dataset_id = d.id
      WHERE $whereClause
      ORDER BY fb.position ASC, fb.created_at DESC
    ";

    $stmt = $db->prepare($query);
    $stmt->execute($params);
    echo json_encode($stmt->fetchAll());
    exit;
  }

  http_response_code(404);
  echo json_encode(['error' => 'endpoint not found']);

} catch (Exception $e) {
  error_log($e->getMessage());
  http_response_code(500);
  echo json_encode(['error' => $e->getMessage()]);
}

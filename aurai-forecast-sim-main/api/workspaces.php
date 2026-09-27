<?php
/**
 * Workspace management endpoints with RBAC
 *
 * Endpoints:
 * - GET /workspaces — list workspaces for current user
 * - POST /workspaces — create new workspace
 * - GET /workspaces/:id — get workspace details
 * - PATCH /workspaces/:id — update workspace
 * - DELETE /workspaces/:id — delete workspace (owner only)
 * - GET /workspaces/:id/members — list workspace members
 * - POST /workspaces/:id/members — invite member
 * - PATCH /workspaces/:id/members/:memberId — update member role
 * - DELETE /workspaces/:id/members/:memberId — remove member
 * - GET /workspaces/:id/audit — audit log
 */

require_once __DIR__ . '/lib/helpers.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = array_values(array_filter(explode('/', $path)));

// Extract workspace ID and member ID from path
$workspaceIndex = array_search('workspaces', $segments);
$workspaceId = $workspaceIndex !== false && isset($segments[$workspaceIndex + 1]) ? $segments[$workspaceIndex + 1] : null;
$membersIndex = array_search('members', $segments);
$memberId = $membersIndex !== false && isset($segments[$membersIndex + 1]) ? $segments[$membersIndex + 1] : null;
$auditIndex = array_search('audit', $segments);

$userId = require_auth();
$db = db();

try {
  // GET /workspaces — list all workspaces user is member of
  if ($method === 'GET' && $workspaceId === null && $auditIndex === false) {
    $query = "
      SELECT w.*, wm.role, COUNT(wm2.id) as member_count
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      LEFT JOIN workspace_members wm2 ON w.id = wm2.workspace_id
      WHERE wm.user_id = :uid
      GROUP BY w.id
      ORDER BY w.updated_at DESC
    ";
    $stmt = $db->prepare($query);
    $stmt->execute([':uid' => $userId]);
    echo json_encode($stmt->fetchAll());
    exit;
  }

  // POST /workspaces — create workspace
  if ($method === 'POST' && $workspaceId === null) {
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $name = $data['name'] ?? 'My Workspace';
    $description = $data['description'] ?? null;
    $id = uuid4();

    $db->beginTransaction();
    try {
      $db->prepare('INSERT INTO workspaces (id, owner_id, name, description) VALUES (:id, :owner, :name, :description)')
         ->execute([':id' => $id, ':owner' => $userId, ':name' => $name, ':description' => $description]);

      $newMemberId = uuid4();
      $db->prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (:id, :wid, :uid, 'owner')")
         ->execute([':id' => $newMemberId, ':wid' => $id, ':uid' => $userId]);

      logWorkspaceAction($db, $id, $userId, 'workspace_created', ['name' => $name]);

      $db->commit();
      echo json_encode(['id' => $id, 'name' => $name, 'description' => $description, 'role' => 'owner']);
    } catch (Exception $e) {
      $db->rollBack();
      throw $e;
    }
    exit;
  }

  // GET /workspaces/:id — get workspace details
  if ($method === 'GET' && $workspaceId && $auditIndex === false && $membersIndex === false) {
    $workspace = getWorkspace($db, $workspaceId, $userId);
    echo json_encode($workspace);
    exit;
  }

  // PATCH /workspaces/:id — update workspace (owner only)
  if ($method === 'PATCH' && $workspaceId && $auditIndex === false && $membersIndex === false) {
    requireWorkspaceRole($db, $workspaceId, $userId, 'owner');
    $data = json_decode(file_get_contents('php://input'), true) ?: [];

    $updates = [];
    $params = [':id' => $workspaceId];

    if (isset($data['name'])) {
      $updates[] = 'name = :name';
      $params[':name'] = $data['name'];
    }
    if (isset($data['description'])) {
      $updates[] = 'description = :description';
      $params[':description'] = $data['description'];
    }
    if (isset($data['settings'])) {
      $updates[] = 'settings = :settings';
      $params[':settings'] = json_encode($data['settings']);
    }

    if (!empty($updates)) {
      $query = "UPDATE workspaces SET " . implode(', ', $updates) . " WHERE id = :id";
      $db->prepare($query)->execute($params);
      logWorkspaceAction($db, $workspaceId, $userId, 'workspace_updated', $data);
    }

    echo json_encode(['success' => true]);
    exit;
  }

  // DELETE /workspaces/:id — delete workspace (owner only)
  if ($method === 'DELETE' && $workspaceId && $auditIndex === false && $membersIndex === false) {
    requireWorkspaceRole($db, $workspaceId, $userId, 'owner');

    $db->beginTransaction();
    try {
      $db->prepare('DELETE FROM workspaces WHERE id = :id')->execute([':id' => $workspaceId]);
      $db->commit();
      echo json_encode(['success' => true]);
    } catch (Exception $e) {
      $db->rollBack();
      throw $e;
    }
    exit;
  }

  // GET /workspaces/:id/members — list workspace members
  if ($method === 'GET' && $workspaceId && $membersIndex !== false && $memberId === null) {
    requireWorkspaceAccess($db, $workspaceId, $userId);

    $query = "
      SELECT wm.id, wm.user_id, p.name, p.email, wm.role, wm.joined_at
      FROM workspace_members wm
      JOIN profiles p ON wm.user_id = p.id
      WHERE wm.workspace_id = :wid
      ORDER BY wm.role DESC, p.name
    ";
    $stmt = $db->prepare($query);
    $stmt->execute([':wid' => $workspaceId]);
    echo json_encode($stmt->fetchAll());
    exit;
  }

  // POST /workspaces/:id/members — invite member
  if ($method === 'POST' && $workspaceId && $membersIndex !== false && $memberId === null) {
    $userRole = requireWorkspaceRole($db, $workspaceId, $userId, ['owner', 'editor']);
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $email = $data['email'] ?? null;
    $role = $data['role'] ?? 'viewer';

    if (!$email) {
      http_response_code(400);
      echo json_encode(['error' => 'email required']);
      exit;
    }

    // Editors can only invite viewer/commenter, not editor/owner
    if ($userRole === 'editor' && in_array($role, ['owner', 'editor'])) {
      http_response_code(403);
      echo json_encode(['error' => 'editors can only invite viewers or commenters']);
      exit;
    }

    $stmt = $db->prepare('SELECT id FROM users WHERE email = :email');
    $stmt->execute([':email' => $email]);
    $existingUser = $stmt->fetch();

    $db->beginTransaction();
    try {
      if ($existingUser) {
        // User exists, add directly. Kept in its own variable so it never
        // clobbers $userId (the actor performing the invite).
        $invitedUserId = $existingUser['id'];
        $newMemberId = uuid4();
        $query = "
          INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by)
          VALUES (:id, :wid, :uid, :role, :invited_by)
          ON DUPLICATE KEY UPDATE role = VALUES(role), joined_at = NOW()
        ";
        $db->prepare($query)->execute([
          ':id' => $newMemberId,
          ':wid' => $workspaceId,
          ':uid' => $invitedUserId,
          ':role' => $role,
          ':invited_by' => $userId,
        ]);
        logWorkspaceAction($db, $workspaceId, $userId, 'member_added', ['email' => $email, 'role' => $role]);
        echo json_encode(['success' => true, 'type' => 'direct_add']);
      } else {
        // Send invite
        $inviteId = uuid4();
        $token = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $token);
        $expiresAt = date('Y-m-d H:i:s', time() + (30 * 24 * 60 * 60)); // 30 days

        $query = "
          INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, invited_by, expires_at)
          VALUES (:id, :wid, :email, :role, :token_hash, :invited_by, :expires_at)
        ";
        $db->prepare($query)->execute([
          ':id' => $inviteId,
          ':wid' => $workspaceId,
          ':email' => $email,
          ':role' => $role,
          ':token_hash' => $tokenHash,
          ':invited_by' => $userId,
          ':expires_at' => $expiresAt,
        ]);
        logWorkspaceAction($db, $workspaceId, $userId, 'invite_sent', ['email' => $email, 'role' => $role]);
        echo json_encode(['success' => true, 'type' => 'invite_sent', 'token' => $token]);
      }
      $db->commit();
    } catch (Exception $e) {
      $db->rollBack();
      throw $e;
    }
    exit;
  }

  // PATCH /workspaces/:id/members/:memberId — update member role (owner only)
  if ($method === 'PATCH' && $workspaceId && $membersIndex !== false && $memberId) {
    requireWorkspaceRole($db, $workspaceId, $userId, 'owner');
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $newRole = $data['role'] ?? null;

    if (!$newRole) {
      http_response_code(400);
      echo json_encode(['error' => 'role required']);
      exit;
    }

    $db->prepare('UPDATE workspace_members SET role = :role WHERE id = :mid AND workspace_id = :wid')
       ->execute([':role' => $newRole, ':mid' => $memberId, ':wid' => $workspaceId]);
    logWorkspaceAction($db, $workspaceId, $userId, 'member_role_changed', ['member_id' => $memberId, 'role' => $newRole]);
    echo json_encode(['success' => true]);
    exit;
  }

  // DELETE /workspaces/:id/members/:memberId — remove member (owner only)
  if ($method === 'DELETE' && $workspaceId && $membersIndex !== false && $memberId) {
    requireWorkspaceRole($db, $workspaceId, $userId, 'owner');

    $db->prepare('DELETE FROM workspace_members WHERE id = :mid AND workspace_id = :wid')
       ->execute([':mid' => $memberId, ':wid' => $workspaceId]);
    logWorkspaceAction($db, $workspaceId, $userId, 'member_removed', ['member_id' => $memberId]);
    echo json_encode(['success' => true]);
    exit;
  }

  // GET /workspaces/:id/audit — audit log (owner/editor only)
  if ($method === 'GET' && $workspaceId && $auditIndex !== false) {
    requireWorkspaceRole($db, $workspaceId, $userId, ['owner', 'editor']);

    $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    $query = "
      SELECT wal.*, p.name as user_name
      FROM workspace_audit_log wal
      JOIN profiles p ON wal.user_id = p.id
      WHERE wal.workspace_id = :wid
      ORDER BY wal.created_at DESC
      LIMIT $limit OFFSET $offset
    ";
    $stmt = $db->prepare($query);
    $stmt->execute([':wid' => $workspaceId]);
    echo json_encode($stmt->fetchAll());
    exit;
  }

  http_response_code(404);
  echo json_encode(['error' => 'endpoint not found']);

} catch (Exception $e) {
  error_log($e->getMessage());
  $code = $e->getCode();
  http_response_code($code >= 400 && $code < 600 ? $code : 500);
  echo json_encode(['error' => $e->getMessage()]);
}

/**
 * Helper: Get workspace with permission check
 */
function getWorkspace($db, $workspaceId, $userId) {
  $query = "
    SELECT w.*, wm.role, COUNT(wm2.id) as member_count
    FROM workspaces w
    JOIN workspace_members wm ON w.id = wm.workspace_id
    LEFT JOIN workspace_members wm2 ON w.id = wm2.workspace_id
    WHERE w.id = :wid AND wm.user_id = :uid
    GROUP BY w.id
  ";
  $stmt = $db->prepare($query);
  $stmt->execute([':wid' => $workspaceId, ':uid' => $userId]);
  $workspace = $stmt->fetch();
  if (!$workspace) {
    throw new Exception('workspace not found or access denied', 404);
  }
  return $workspace;
}

/**
 * Helper: Require user to be in workspace (any role)
 */
function requireWorkspaceAccess($db, $workspaceId, $userId) {
  $stmt = $db->prepare('SELECT COUNT(*) as count FROM workspace_members WHERE workspace_id = :wid AND user_id = :uid');
  $stmt->execute([':wid' => $workspaceId, ':uid' => $userId]);
  $row = $stmt->fetch();
  if ((int)$row['count'] === 0) {
    throw new Exception('workspace not found or access denied', 404);
  }
}

/**
 * Helper: Require specific role(s)
 * Returns the user's role in the workspace
 */
function requireWorkspaceRole($db, $workspaceId, $userId, $requiredRoles) {
  if (!is_array($requiredRoles)) {
    $requiredRoles = [$requiredRoles];
  }

  $stmt = $db->prepare('SELECT role FROM workspace_members WHERE workspace_id = :wid AND user_id = :uid');
  $stmt->execute([':wid' => $workspaceId, ':uid' => $userId]);
  $member = $stmt->fetch();

  if (!$member) {
    throw new Exception('workspace not found or access denied', 404);
  }

  if (!in_array($member['role'], $requiredRoles)) {
    throw new Exception('insufficient permissions for this action', 403);
  }

  return $member['role'];
}

/**
 * Helper: Log workspace activity to audit log
 */
function logWorkspaceAction($db, $workspaceId, $userId, $action, $details = []) {
  $id = uuid4();
  $detailsJson = json_encode($details);
  $db->prepare('INSERT INTO workspace_audit_log (id, workspace_id, user_id, action, details) VALUES (:id, :wid, :uid, :action, :details)')
     ->execute([':id' => $id, ':wid' => $workspaceId, ':uid' => $userId, ':action' => $action, ':details' => $detailsJson]);
}

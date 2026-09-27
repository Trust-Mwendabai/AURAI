# RBAC & Shared Workspaces Guide

## Overview

Aurai Workspaces enable team collaboration with role-based access control (RBAC). Teams can now:

- **Create workspaces** — dedicated spaces for team forecasting projects
- **Invite team members** — with specific roles and permissions
- **Share resources** — datasets, forecasts, reports, and insights
- **Control access** — grant read-only, edit, or full control permissions
- **Audit activity** — track who changed what and when

## Workspace Roles & Permissions

### Role Matrix

| Action | Owner | Editor | Commenter | Viewer |
|--------|-------|--------|-----------|--------|
| **View** datasets, forecasts, reports | ✓ | ✓ | ✓ | ✓ |
| **Create** new datasets, forecasts | ✓ | ✓ | ✗ | ✗ |
| **Edit** datasets, forecasts, reports | ✓ | ✓ | ✗ | ✗ |
| **Delete** datasets, forecasts, reports | ✓ | ✗ | ✗ | ✗ |
| **Invite** new members | ✓ | ✓* | ✗ | ✗ |
| **Change member roles** | ✓ | ✗ | ✗ | ✗ |
| **Delete workspace** | ✓ | ✗ | ✗ | ✗ |
| **Add comments** | ✓ | ✓ | ✓ | ✗ |
| **View audit log** | ✓ | ✓ | ✗ | ✗ |

*Editor can invite Commenter and Viewer roles only

### Role Descriptions

**Owner**
- Full workspace control: create, edit, delete resources
- Manage team members and their permissions
- Access workspace audit log
- Delete the entire workspace
- Automatically assigned when creating a workspace

**Editor**
- Create and edit datasets, forecasts, reports
- Invite members as Commenter or Viewer
- Collaborate on shared projects
- Cannot delete resources or change member roles

**Commenter**
- View all resources in the workspace
- Add comments and annotations to forecasts
- Cannot create, edit, or delete resources
- Use case: stakeholders, reviewers, auditors

**Viewer**
- Read-only access to all resources
- See dashboards, forecasts, insights
- Cannot make any changes
- Use case: executives, clients, read-only dasheholders

## Getting Started with Workspaces

### Creating Your First Workspace

1. Log in to Aurai
2. Click **Workspaces** in the sidebar (or top menu)
3. Click **Create Workspace**
4. Enter workspace name and description
5. Click **Create**

Your first workspace is created automatically as "Personal" — perfect for solo forecasting.

### Inviting Team Members

1. Open the workspace
2. Click **Members** or **Settings** → **Team**
3. Click **Invite Member**
4. Enter team member's email
5. Select their role (Owner, Editor, Commenter, Viewer)
6. Click **Send Invite**

An invitation is sent to their email. They click the link to join.

### Accepting an Invite

1. Receive email from workspace admin
2. Click **Join Workspace** button
3. Log in if needed (or create account)
4. You're added to the workspace with your assigned role

## Managing Shared Resources

### Assigning Resources to Workspaces

When creating datasets, forecasts, or reports, select the workspace:

**From Predictions Page:**
```
1. Create a forecast as usual
2. In the confirmation, select the workspace to save it to
3. Forecast appears in that workspace's Predictions list
```

**From Dataset Page:**
```
1. Import a dataset
2. Select which workspace owns it
3. Dataset is visible to all workspace members
```

### Sharing Individual Resources

For finer control, share specific items:

1. Click the share icon on any forecast/dataset
2. Choose who can access (specific members or workspace-wide)
3. Set permission level (view-only, edit)
4. Click **Share**

### Workspace Visibility

**Private Workspaces** (default)
- Only invited members can see resources
- No public access links
- Recommended for sensitive forecast data

**Team Workspaces**
- Shared with all team members in workspace
- Can set default permission level (editor vs. viewer)
- Use case: departmental forecasting projects

## Workflow Examples

### Sales Team Collaboration

**Setup:**
1. Sales Manager creates "Q1 Forecast" workspace
2. Invites Sales Analyst as Editor
3. Invites VP Sales as Viewer
4. Invites Finance Partner as Commenter

**Workflow:**
1. Analyst imports sales history dataset
2. Analyst creates monthly revenue forecast
3. Manager reviews and comments
4. Analyst adjusts based on feedback
5. All three see the updated forecast simultaneously
6. VP Sales receives read-only access to final forecast
7. Finance Partner reviews and adds questions as comments

### Executive Reporting

**Setup:**
1. Finance creates "Executive Forecasts" workspace
2. Invites CFO as Owner (backup admin)
3. Invites CEO as Viewer
4. Invites Board Members as Viewers

**Workflow:**
1. Analysts build forecasts in "Finance" workspace
2. Once locked, analysts share to "Executive Forecasts"
3. CFO reviews and approves
4. CEO and board see live, updated forecasts
5. All share the same PDF reports

## API Reference

### Workspace Endpoints

**Create Workspace (POST /workspaces)**
```json
{
  "name": "Product Forecasting",
  "description": "Revenue & demand forecasts for 2025"
}
```

**List Workspaces (GET /workspaces)**
Returns all workspaces you're a member of, with your role.

**Invite Member (POST /workspaces/:id/invite)**
```json
{
  "email": "analyst@company.com",
  "role": "editor"
}
```

**Change Member Role (PATCH /workspaces/:id/members/:memberId)**
```json
{
  "role": "viewer"
}
```

**Get Workspace Audit Log (GET /workspaces/:id/audit)**
Returns paginated activity log with timestamps, users, and actions.

### Resource Sharing

**Assign Resource to Workspace (POST /datasets/:id/workspace)**
```json
{
  "workspace_id": "workspace_123"
}
```

**Update Resource Permissions (PATCH /datasets/:id/permissions)**
```json
{
  "workspace_id": "workspace_123",
  "members": [
    { "user_id": "user_456", "permission": "edit" },
    { "user_id": "user_789", "permission": "view" }
  ]
}
```

## Database Schema

### Workspaces Table
- `id` — workspace UUID
- `owner_id` — creator's user ID
- `name`, `description` — workspace details
- `settings` — JSON config (theme, defaults, etc.)
- `created_at`, `updated_at`

### Workspace Members Table
- `id`, `workspace_id`, `user_id` — unique member record
- `role` — owner/editor/commenter/viewer
- `joined_at` — when user joined
- `invited_by` — who invited this user

### Workspace Audit Log
- Tracks all actions: create, edit, delete, invite, permissions change
- Per-resource details (what changed, old/new values)
- Supports compliance & auditing

### Workspace Invites
- Temporary tokens for email-based invitations
- Expiration date (default: 30 days)
- Accept/reject flow

## Best Practices

### For Team Leads
1. **Start with a Personal workspace** for initial experimentation
2. **Create Team workspaces** once you're ready to collaborate
3. **Invite gradually** — add people as projects grow
4. **Use Editors** for active contributors, Viewers for stakeholders
5. **Archive old workspaces** rather than delete (supports audit)

### For Organizations
1. **Create workspaces by department** (Sales, Finance, Operations)
2. **Designate co-owners** in each workspace for backup access
3. **Review audit logs monthly** to spot anomalies
4. **Set workspace settings** (theme, default role) at creation
5. **Document workspace purposes** in descriptions

### For Security
1. **Never share workspace invites** outside your organization
2. **Use Commenter role** instead of Editor for external reviewers
3. **Audit log regularly** — watch for unusual access patterns
4. **Revoke access quickly** when someone leaves
5. **Rotate owners** annually to prevent lock-out scenarios

## Troubleshooting

### "Access Denied" When Viewing Forecast
- **Check membership:** Are you in the workspace? See workspace members list.
- **Check role:** Viewers can only read; Commenters cannot edit.
- **Ask owner:** Request higher permissions if you need edit access.

### Invite Expires Before I Click It
- Invites expire after 30 days by default
- Ask the inviter to resend the invite
- Workspace owner can extend expiration in settings

### Forecast Visible to Wrong People
- **Verify resource workspace:** Is it assigned to the right workspace?
- **Check member roles:** Are all intended viewers actually members?
- **Review workspace visibility:** Is the workspace private or team-wide?

### Audit Log Shows Unexpected Changes
- Review the details — who changed what and when
- Ask that user directly (may be authorized)
- If unauthorized, escalate to workspace owner
- Owner can remove user and audit the change

## Limitations & Future Work

**Current Limitations:**
- Comments are on reports, not inline on chart data (coming soon)
- No workflow/approval stages (planned)
- Audit log doesn't show data diffs yet (coming soon)

**Planned Enhancements:**
- **Guest access** — share specific forecasts with external parties
- **Approval workflows** — require sign-off before publishing
- **Workspace templates** — quick setup for common team types
- **Bulk invite** — import team from CSV or Active Directory
- **Time-based access** — revoke after specific date
- **Workspace hierarchy** — nested teams and sub-projects

## Support

For workspace setup help or permission issues, contact your workspace owner or administrator. If you're the owner:

1. Check member list in Workspace Settings
2. Review audit log for recent changes
3. Verify role assignments match current responsibilities
4. Use "Resend Invite" for inactive members

---

**Next Steps:** [Create your first workspace](../../).

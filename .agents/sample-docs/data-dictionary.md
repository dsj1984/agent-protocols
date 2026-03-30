# Data Dictionary

This document defines the core database schema entities for Project Acme. It
serves as the single source of truth for the domain model.

## 1. Core Entities

### `users`

Represents an individual account authenticated in the system.

- **`id`** (`UUID`, PK): Unique identifier.
- **`email`** (`VARCHAR`, Unique): User's primary email address.
- **`password_hash`** (`VARCHAR`): Bcrypt hash of user's password.
- **`full_name`** (`VARCHAR`): Display name of the user.
- **`role`** (`ENUM('admin', 'member', 'guest')`): RBAC permission level.
- **`created_at`** (`TIMESTAMP`): Timestamp of account creation.
- **`last_login`** (`TIMESTAMP`, Nullable): Timestamp of the last successful
  authentication.

### `organizations`

Represents a group workspace that users can belong to.

- **`id`** (`UUID`, PK): Unique identifier.
- **`name`** (`VARCHAR`): Formal name of the company or team.
- **`slug`** (`VARCHAR`, Unique): URL-friendly string used in routing (e.g.,
  `acme-corp`).
- **`subscription_tier`** (`ENUM('free', 'pro', 'enterprise')`): Current billing
  tier determining feature access.
- **`created_at`** (`TIMESTAMP`): Creation time.

### `organization_memberships`

Join table mapping users to organizations with org-specific roles.

- **`org_id`** (`UUID`, FK `organizations.id`): The workspace.
- **`user_id`** (`UUID`, FK `users.id`): The member.
- **`org_role`** (`ENUM('owner', 'admin', 'editor', 'viewer')`): Workspace local
  role.
- **`joined_at`** (`TIMESTAMP`): When the user was invited/joined.

_Primary Key:_ `(org_id, user_id)`

### `notifications`

System alerts pushed to users.

- **`id`** (`UUID`, PK): Unique identifier.
- **`user_id`** (`UUID`, FK `users.id`): Recipient user.
- **`type`** (`VARCHAR`): Defined enumeration of event types (e.g., `mention`,
  `invite`, `system_alert`).
- **`content_payload`** (`JSONB`): Deeply nested metadata specific to the
  notification type.
- **`read_at`** (`TIMESTAMP`, Nullable): When the user marked the item as read.
- **`created_at`** (`TIMESTAMP`): Generation time.

## 2. Indices & Performance Considerations

- **`users(email)`**: Unique B-tree index for fast login lookups.
- **`organizations(slug)`**: Unique index for subdomain or route resolution.
- **`notifications(user_id, read_at)`**: Compound index to rapidly fetch unread
  counts for the frontend UI badge.

## 3. Data Retention Policies

- **Soft Delete:** The `users` and `organizations` tables feature `deleted_at`
  columns. Records are not hard-deleted immediately to allow for 30-day
  recovery.
- **Event Expiry:** Records in `notifications` older than 90 days are purged by
  a daily background chron job to prevent table bloat.

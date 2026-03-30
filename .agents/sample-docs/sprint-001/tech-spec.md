# Technical Specification: Sprint 001 - Realtime Notifications

**Context:** This document outlines the explicit architectural decisions, infrastructure provisioning, and frontend changes required to fulfill the realtime notification PRD.

---

## 1. Database Schema Changes

A new table `notifications` and `notification_preferences` will be required.

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
  title VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL
);

CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  email_enabled BOOLEAN DEFAULT TRUE,
  push_enabled BOOLEAN DEFAULT TRUE,
  in_app_enabled BOOLEAN DEFAULT TRUE,
  categories JSONB DEFAULT '{}'
);
```

## 2. Backend API Routes

- `GET /api/v1/notifications` — Retrieve historically unread notifications for a user, paginated.
- `PUT /api/v1/notifications/:id/read` — Mark a notification as read.
- `GET /api/v1/notifications/preferences` — Get user preferences.
- `PUT /api/v1/notifications/preferences` — Update user preferences.

## 3. WebSocket Architecture

We will implement standard WebSockets for realtime updates.

### A. Connection Handling

- **Endpoint:** `wss://api.example.com/events`
- **Auth:** Client passes JWT as a query parameter or sends an `auth` event immediately upon connection. Unauthenticated connections are dropped after 5 seconds.

### B. Scalability

- Redis Pub/Sub will be used as a backplane to sync messages across multiple WebSocket server instances.
- When an API event triggers a notification, it publishes to a Redis channel `user:notify:<user_id>`, which the WebSocket servers listen to.

## 4. Execution Guardrails

1. **No direct database polling:** Polling is inefficient. All new events must pass through the Pub/Sub system for immediate delivery.
2. **Exponential backoff logic:** Clients must not simultaneously reconnect upon server restart (thundering herd). Implement jittered backoff logic on the frontend client.
3. **Data retention:** A background job must be scheduled to clean up read notifications older than 30 days to keep the `notifications` table lean.

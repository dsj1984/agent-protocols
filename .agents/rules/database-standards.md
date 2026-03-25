# Database Design Standards

Rules for designing and mutating SQL or NoSQL database schemas.

## Table and Collection Naming

- All table or collection names MUST be plural and use `snake_case` (e.g.,
  `user_profiles`, `orders`).

## Columns and Fields

- Foreign key columns must be singular and suffixed with `_id` (e.g., `user_id`,
  `organization_id`).
- Boolean fields should start with `is_`, `has_`, or `can_` (e.g., `is_active`).

## Primary Keys

- Prefer `UUIDs` or `CUIDs` for primary keys over sequential, guessable integers
  to prevent enumeration attacks.

## Data Retention

- Use "Soft Deletes" for critical data. Add a `deleted_at` timestamp column
  instead of hard dropping rows.
- Always include `created_at` and `updated_at` timestamps on all standard
  entities.

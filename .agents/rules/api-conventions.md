# API & Endpoint Conventions

Applies to all REST or GraphQL API developments to ensure consistency across
services.

## Payload Formatting

- All JSON request and response keys MUST use `camelCase`.
- Endpoint URLs should use lowercase `kebab-case` (e.g., `/api/user-profiles`).

## Standard Error Responses

All handled errors MUST return a standard shape:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_SNAKE_CASE",
    "message": "Human-readable explanation of why it failed."
  }
}
```

## HTTP Status Codes

- `200 OK` - Successful GET, PUT, PATCH.
- `201 Created` - Successful POST resulting in creation.
- `400 Bad Request` - Validation failures (Zod issues).
- `401 Unauthorized` - Missing or invalid auth tokens.
- `403 Forbidden` - Authed, but lacks role permissions.
- `404 Not Found` - Resource does not exist.
- `500 Internal Server Error` - Unhandled exceptions.

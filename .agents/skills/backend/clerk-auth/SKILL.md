# Skill: Clerk Auth

Protocols for implementing secure authentication and user management using
Clerk.

## 1. Core Principles

- **Security First:** Never trust the client. Always verify JWTs on the server
  or in middleware.
- **Zero-Boilerplate Auth:** Use Clerk's built-in components (`<SignIn>`,
  `<SignUp>`, `<UserButton>`) to maintain UI consistency and security standards.
- **Metadata Management:** Store application-specific user state in
  `publicMetadata` (read-only by client) or `privateMetadata` (server-only).

## 2. Technical Standards

- **Middleware:** Protect sensitive routes using Clerk's middleware helper to
  ensure non-authenticated users are redirected before hitting the application
  logic.
- **Webhooks:** Verify Clerk webhooks using the `svix` library to ensure
  requests originate from Clerk.
- **Session Tokens:** Use short-lived sessions and handle expired tokens
  gracefully.

## 3. Best Practices

- **OAuth Providers:** Prefer standard social logins (Google, GitHub) to reduce
  user friction.
- **Customization:** Use Clerk's theme API to align the auth components with the
  project's Tailwind or CSS-in-JS styling.
- **Multi-tenant:** Use Clerk Organizations for applications requiring teams or
  workspaces.

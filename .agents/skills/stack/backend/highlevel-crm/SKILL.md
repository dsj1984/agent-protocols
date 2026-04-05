# Skill: HighLevel CRM (GoHighLevel)

Protocols for integrating with the HighLevel CRM API (v2) and building custom
widgets/automations.

## 1. Core Principles

- **API-First Integration:** Use the HighLevel API v2 for all data
  synchronization, focusing on OAuth 2.0 security.
- **Workflow Automation:** Leverage HighLevel's internal automation engine
  effectively; only use custom code when native workflows are insufficient.
- **Data Integrity:** Ensure all custom fields, tags, and contacts are mapped
  accurately to prevent data corruption.

## 2. Technical Standards

- **OAuth 2.0:** Securely manage `access_token` and `refresh_token` flows. Never
  hardcode credentials.
- **Webhooks:** Use webhooks to trigger application logic when events occur in
  CRM (e.g., contact created, opportunity moved).
- **Rate Limiting:** Implement exponential backoff and retry logic to respect
  HighLevel's API rate limits.
- **Location Context:** Always include the `locationId` in your API requests to
  ensure data is scoped to the correct sub-account.

## 3. Best Practices

- **Custom Fields:** Use unique, descriptive names for custom fields and mapping
  keys to avoid collisions.
- **Contact Sync:** Use email addresses as the primary identifier for contact
  deduplication.
- **Testing:** Always use a sandbox/test sub-account in HighLevel before
  deploying integrations to live accounts.

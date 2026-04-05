# Skill: Google Analytics 4 (GA4)

Guidelines for privacy-compliant and data-driven event tracking using GA4.

## 1. Core Principles

- **Privacy Compliance:** Adhere to GDPR and CCPA. Implement Consent Mode V2 and
  never send PII to GA servers.
- **Event-Driven:** Focus on meaningful user actions (e.g., "start_checkout",
  "share_article") rather than just page views.
- **Data Accuracy:** Filter out development and internal traffic from production
  property data.

## 2. Technical Standards

- **GTM Integration:** Use Google Tag Manager for event firing to decouple
  marketing tags from core application code.
- **Custom Dimensions:** Define critical data points (e.g., `user_type`,
  `pricing_plan`) as custom dimensions in the GA4 property.
- **Enhanced Measurement:** Leverage GA4's built-in tracking for scrolls,
  outbound clicks, and site searches.

## 3. Best Practices

- **Naming Convention:** Use `snake_case` for event names and parameters.
- **Debug View:** Use the GA4 DebugView in the browser to verify events fire
  correctly before deploying.
- **Anonymization:** Ensure IP anonymization is enabled (default in GA4) and
  cross-domain tracking is configured if necessary.

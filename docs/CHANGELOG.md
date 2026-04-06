# Changelog

All notable changes to this project will be documented in this file.

## [5.0.0] - 2026-04-05

### 🚀 Major Rewrite

Version 5.0.0 represents a complete, ground-up rewrite of the platform. There is **no backward compatibility** with v4.x.x or earlier.

* **Architecture:** Transitioned to a **GitHub-native Epic Orchestration** model. Re-architected the work structure into a four-tier hierarchy: **Epic → Feature → Story → Task**. Introduced a provider-agnostic **ITicketingProvider** abstraction with a high-performance **Native GitHub Integration** (leveraging GraphQL for Sub-Issues and Projects V2).
* **Key Paradigms:** Adopted **GitHub as the Single Source of Truth**, eliminating the need for local documentation or metadata persistence. Implemented an **Epic-Centric Workflow** that automates the entire SDLC pipeline — from technical specification generation to recursive task dispatch — directly on the GitHub platform. Shifted to a **Self-Contained Dependency Policy**, where all core orchestration logic is built using native Node.js 20+ `fetch` and minimalist JS patterns to eliminate SDK bloat.
* **Removed:** Completely decommissioned the legacy **local documentation system** (`sample-docs/`), **v4 protocol version enforcement**, and all **legacy telemetry and indexing scripts** (`aggregate-telemetry.js`, `context-indexer.js`). Purged all legacy version-locked planning templates in favor of dynamic, automated workflow orchestration.

---
*For historical changes prior to v5.0.0, please refer to the [Legacy Changelog (v1.0.0 - v4.7.2)](docs/CHANGELOG-v4.md).*

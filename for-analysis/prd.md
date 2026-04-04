# PRD: Sprint 045 - Notification Customization & Global Discovery

## 1. Problem Statement

As the Athlete Portal scales, the "one-size-fits-all" approach to search and
notifications is beginning to introduce user friction. Currently, users receive
broad system alerts without the ability to filter communication channels (Push,
Email, SMS) by specific event archetypes (e.g., Social, Security, Marketing).
This lack of control risks notification fatigue, potentially causing users to
disable alerts entirely and miss critical updates.

Furthermore, the existing discovery experience is constrained to an overarching
search bar primarily focused on locating individual athletes. Because Teams and
Clubs are central entities in the ecosystem, lacking dedicated, high-fidelity
lookup portals throttles the platform's ability to act as a seamless,
multi-sided marketplace for coaches, parents, and recruiters.

Sprint 045 directly tackles these bottlenecks by delivering a Granular
Notification Preference Center alongside robust Omni-Directory Portals. These
updates align with the platform's strategic roadmap to provide sophisticated
privacy controls and rich, interconnected data graphs for the expanding WaaS
ecosystem.

---

## 2. Feature: Granular Notification Preference Center

**Context:** An expanded settings dashboard allowing users to fine-tune their
notification experience across every category (Events, Social, Security,
Marketing) with separate toggles for Push, Email, and SMS per-event type.

### User Stories

- **As a user**, I want to customize whether I receive push notifications,
  emails, or SMS messages for specific event types (like new social connections
  vs. system security alerts), so that I only get interrupted for things that
  matter to me.
- **As a parent or athlete**, I want to easily mute marketing or non-critical
  social updates while ensuring I never miss an important game schedule change.
- **As a system administrator**, I want users to have fine-grained controls over
  their notifications to reduce overall unsubscribe rates and lower our SMS
  provider costs.

### Acceptance Criteria

- **Criteria 1:** The user settings area MUST include a distinct "Notifications"
  section with categorized toggles (Events, Social, Security, Marketing).
- **Criteria 2:** Each category MUST feature independent opt-in/opt-out radio
  buttons or toggles for three distinct delivery channels: Push, Email, and SMS.
- **Criteria 3:** The user's preferences MUST be strictly enforced by the
  backend notification router; if SMS is disabled for social updates, the system
  must gracefully skip SMS queueing for that specific event type.
- **Criteria 4:** Security-critical alerts (like password resets or new device
  logins) MUST provide clear UI lockouts indicating that they cannot be fully
  disabled, ensuring account safety.

### Expected User Flow

1. User navigates to their profile settings and selects the new "Notifications"
   tab.
2. The UI renders a structured matrix of notification categories (Events,
   Social, Security, Marketing) against delivery methods (Email, SMS, Push).
3. The user toggles SMS "off" for the Marketing category and Push "off" for
   Social.
4. An optimistic saving indicator (spinner/toast) appears immediately,
   persisting the updated JSON configuration to the user's database record.
5. Future system events dynamically evaluate this stored preference before
   dispatching to the respective messaging pipelines.

---

## 3. Feature: Omni-Directory Portals

**Context:** A transition from basic search-only discovery to dedicated,
high-fidelity lookup portals for the entire ecosystem (Athlete Directory, Club
Directory, Team Directory).

### User Stories

- **As a recruiter**, I want a dedicated Athlete Directory with advanced
  recruit-centric filtering (GPA, verified stats, position), so that I can
  efficiently scout high-potential talent matching my collegiate program.
- **As a parent or athlete**, I want to browse a distinct Club Directory
  filtered by region and competitive tier, so that I can evaluate organizations
  before trying out.
- **As a coach**, I want access to a public-facing Team Directory, so that I can
  easily find friendly matches and scout opposing squad rosters.

### Acceptance Criteria

- **Criteria 1:** The platform MUST provide three distinct, routable directory
  landing pages: `/athletes`, `/clubs`, and `/teams`.
- **Criteria 2:** The Athlete Directory MUST support faceted filtering on
  parameters including high school graduation year, primary position, and
  verified stats (e.g., GPA > 3.0).
- **Criteria 3:** The Club Directory MUST display WaaS-status badges for
  partnered clubs and allow geographical (state/region) filtering.
- **Criteria 4:** Access to sensitive fields in the Athlete Directory (like
  contact info) MUST respect the existing `recruiter` RBAC gating and privacy
  settings established in prior sprints.
- **Criteria 5:** UI components (search inputs, filter chips, paginated data
  grids) MUST conform strictly to the platform's global design system
  (Astro/React standards).

### Expected User Flow

1. User clicks "Discovery" in the main navigation and selects "Clubs".
2. The app routes the user to the `/clubs` Omni-Directory portal, rendering a
   grid of verified organization cards.
3. The user applies a "Region: Northeast" filter and a "Tier: Elite" filter
   using the sidebar/header toolset.
4. The directory view dynamically updates (debounced) to display only matching
   clubs.
5. The user clicks on a specific club card and is routed seamlessly to that
   organization's public-facing WaaS profile.

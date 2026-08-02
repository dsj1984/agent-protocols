<!-- GENERATED FILE — do not edit by hand.
     Source of truth: .agents/workflows/audit-baselines.md
     Regenerate: node .agents/scripts/generate-lens-checklists.js
     Drift is gated by: npm run docs:check
-->

# Baseline & Ratchet Audit — authoring checklist

> Audit the committed baseline surface — dead instruments, stale baselines, cross-gate hotspot clusters, trend drift, and floor-tightening headroom — and emit findings whose remediation burns the measured debt down and tightens the ratchet behind it.

Self-check your change against this lens's concerns before you ship:

- [ ] `configError` non-null.
- [ ] `degradations`.
- [ ] Dead Instruments.
- [ ] Staleness.
- [ ] Hotspot Clusters.
- [ ] Trend Drift.
- [ ] Tightening Headroom.
- [ ] Hotspot Cluster template
- [ ] Tightening Headroom template

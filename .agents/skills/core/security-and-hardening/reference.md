# Security and Hardening — Reference (on-demand)

**Read this when** a task engages one of the sections below and the Policy
Capsule in [`SKILL.md`](SKILL.md) does not settle it on its own. The capsule
is the contract; this file is the reference material behind it. Nothing here
relaxes a capsule MUST, and the generic *how* of each MUST (parameterize
queries, hash passwords, encode output, verify ownership, set headers,
restrict CORS, validate at the boundary) is stated once in the SSOT rule,
[`security-baseline.md`](../../../rules/security-baseline.md) — not duplicated
here.

## Security Surfacing, Not Runtime Pause

Some changes are not unsafe by themselves but expand the security surface
enough that the change must be **explicitly documented** in the PR
description and on the originating ticket so a reviewer can sign off in
band. Documenting them is the gate — they do **not** pause execution:

- Adding new authentication flows or changing auth logic
- Storing new categories of sensitive data (PII, payment info)
- Adding new external service integrations
- Changing CORS configuration
- Adding file upload handlers
- Modifying rate limiting or throttling
- Granting elevated permissions or roles

For each item that applies, call it out under a "Security surface" section
in the PR body and on the parent ticket, label the change `risk::high`,
and link the relevant `security-baseline.md` MUST. Reviewers gate the
merge; the agent keeps moving.

`agent::blocked` remains the **only** runtime pause label. Use it for
unrecoverable blockers (missing prerequisite, ambiguous spec a sub-agent
cannot resolve), not for "this change is sensitive." Sensitive changes
ship through the documentation path above.

## Validation-Error Responses

The status code and response envelope for a failed input validation are owned
by the wire-format SSOT, not by this skill: validation failures MUST return
**400 Bad Request** with `error.code = "VALIDATION_ERROR"` in the canonical
envelope. See
[`api-conventions.md` § Validation Status](../../../rules/api-conventions.md#validation-status)
and [§ Response Envelope](../../../rules/api-conventions.md#response-envelope).
Do not hand-roll a divergent status (e.g. 422) or envelope shape in
security-relevant handlers — cite the rule and reuse its shape, keeping the
security skill and the api skill in agreement.

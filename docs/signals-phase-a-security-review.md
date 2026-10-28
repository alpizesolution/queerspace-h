# Signals Phase A — Security Review

**Review target:** `main` as inspected on 2026-10-27  
**Scope:** Signals UI, Firestore rules, and whether Phase A connection data can be considered safe to launch.  
**Status:** Review only. No production rules or data were changed.

## Executive summary

Signals is currently a presentation-only placeholder. `src/components/SignalsView.tsx` renders the “Coming soon” screen and has no inbox listeners or actions. The current `firestore.rules` file contains no Signals-specific collection matches or helpers. Therefore, a secure Signals request/accept/message flow is **not yet implemented or verifiable from this branch**.

Do not launch Signals by simply adding client writes or relying on the existing generic conversation permissions.

## Findings

### S1 — No Signals-specific authorization rules (launch blocker)

The current rules contain no dedicated paths or validation for Signals invitations, accepted pairs, or Signal conversations. There is no rules-enforced consent state machine to review.

**Required before launch:** define the exact collection schema and add deny-by-default, per-document rules for creating an invitation, accepting/declining it, reading only one's own invitations, and accessing a conversation only after mutual consent. Add tests for both participants and an unrelated third user.

### S2 — Existing conversation rules are too broad to reuse as the Signals security boundary (high)

The existing `/conversations/{convId}` match allows any authenticated user to create a conversation, and allows authenticated updates without restricting affected fields or validating the state transition. Those rules do not enforce a mutual-acceptance handshake.

**Required before launch:** Signals must use dedicated consent-aware rules or a trusted server-side flow. Do not assume the existing conversation rules enforce consent. Review and harden those existing rules separately because they affect the current chat feature too.

### S3 — Block and expiry enforcement are not present for Signals (high)

Because there are no Signals rules or service implementation on `main`, the review could not verify checks for blocked users, expired invitations, duplicate/pending invitations, or stale connections.

**Required before launch:** enforce both directions of the block relationship, validate expiration using server timestamps, prevent replay/duplicate acceptance, and define cleanup for expired records. UI-only checks are insufficient.

### S4 — UI does not yet expose a functional inbox (expected / not a vulnerability)

`SignalsView.tsx` is explicitly a placeholder: it has no data listeners, request list, accept/decline actions, or conversation navigation. This is appropriate while the feature is marked “Coming soon,” but it should not imply that private connections are operational.

## Minimum Phase A acceptance checklist

- [ ] Document invitation, pair, and conversation schemas before writing rules.
- [ ] Require authenticated identity and validate immutable participant IDs.
- [ ] Require explicit mutual acceptance before opening a private Signal conversation.
- [ ] Validate status transitions and restrict changed fields with `diff().affectedKeys()`.
- [ ] Enforce block checks in both directions.
- [ ] Enforce server-time expiry and reject expired/replayed invitations.
- [ ] Prevent users from changing the other participant's consent or identity fields.
- [ ] Add emulator tests for allowed flows and adversarial cases: forged sender/recipient, third-party reads, self-invites, duplicate requests, expired requests, blocked pairs, status escalation, participant mutation, and post-acceptance revocation.
- [ ] Run rules tests and the existing test/build/lint suite before proposing merge.
- [ ] Keep production deployment separate from review and merge approval.

## Scope and limitations

This review is based on the current GitHub `main` files inspected for this task. It does not claim that unpushed local edits, external services, deployed Firebase rules, or runtime behavior were verified. No rules were changed and no deployment was performed.

# Age review: how birthdays, attempts and corrections are kept

Birthdays are self-reported and private. This is an access gate, not identity verification.

## Where things live

| Data | Where | Who can read it |
|---|---|---|
| Approved birthday | `users/{uid}/private/settings.birthDate` | The member; the server |
| Under-18 birthday a member typed | `ageAttempts/{uid}` (server only) | Admins, through `api/age.js` |
| Original birthday, previous birthdays, `correctionCount`, `rejectedCount`, `manualReview` | `ageRecords/{uid}` (server only) | Admins, through `api/age.js` |
| The member's current request, status, decision reason | `birthdayCorrections/{uid}` (server only) | Admins, through `api/age.js`; the member sees the status only |
| Who decided what and when | `ageAudit/{id}` (server only) | Nobody from a client. No birthdays, no free text |

All server-only collections are `allow read, write: if false` in `firestore.rules`; only `api/age.js` (Admin SDK) touches them.
An under-18 birthday is never written to `birthDate`, and approvals are re-validated on the server (18+).

## Rules of the workflow

- Maximum **2 approved corrections** per account. Rejected requests do not use the allowance.
- **One open request** (`pending` or `info-requested`) per member.
- **2 rejections** (`AGE_REJECTION_REVIEW_THRESHOLD`) flag the member for manual review. Other flags: a correction within 30 days of an
  approved one, a change of more than 2 years, and using the last allowed correction.
- A member with **no birthday on record** (legacy) can send one for review. It is never approved automatically. The first birthday
  recorded this way becomes `originalBirthDate` and does not count as a correction.
- Approval keeps the replaced birthday in `previousBirthDates`; the first one ever recorded is kept as `originalBirthDate`.
- Members are told through their support thread. Previews are generic; dates are stripped from admin reasons before they are sent.

## Retention

Under-18 attempts and decided requests are removed after **90 days** (`AGE_RECORD_RETENTION_DAYS`). Open requests are never removed.
Run it as an admin: `POST /api/age {"action":"purge-age-records"}` is a dry run that only counts; add `"dryRun": false` to delete.
`ageRecords` (the correction history and counts) is kept for the life of the account so the 2-correction limit holds; `ageAudit` is
kept as the audit trail. Nothing runs the purge automatically yet: schedule it (for example with the existing Vercel cron) once
the retention period is agreed.

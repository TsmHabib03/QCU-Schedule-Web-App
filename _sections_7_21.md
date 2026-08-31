)
## 7. Request Validation

Validation occurs at Cloudflare for early rejection and again authoritatively in Apps Script. Gateway validation never replaces service validation.

### General validation pipeline

1. Reject unsupported method, content type, body size, API version, or action mapping at Cloudflare.
2. Verify session, Origin/CSRF for mutations, and edge rate class.
3. Apps Script verifies transport envelope before payload parsing.
4. Reject unknown top-level and mutation fields where strict schemas are practical.
5. Normalize only documented values, preserving original snapshots where required.
6. Validate primitive types and lengths.
7. Validate foreign keys, ownership, scope, lifecycle, uniqueness, versions, and domain invariants.
8. Return all safe bounded field errors where practical; perform no database mutation on validation failure.

### Primitive rules

| Type | Rule |
|---|---|
| IDs | Required prefixes and UUID shape; immutable; maximum length; never Sheet row numbers or A1 ranges |
| Strings | UTF-8, trimmed according to field policy, control characters rejected, explicit min/max length, stored as plain text |
| Dates | ISO , real calendar date, policy range, compared in declared academic/campus context |
| Timestamps | UTC ISO 8601 with ; server creates audit/timestamps |
| Times | Strict 24-hour ; campus-local wall time;  |
| Enums | Exact allowlisted uppercase values; no silent fallback |
| Booleans | JSON booleans only, not truthy strings |
| Numbers | Finite values, bounded range/precision; units follow approved range and precision |
| Arrays | Explicit maximum item count; item schema; duplicate handling; no arbitrary nested depth |
| Objects | Known properties only for mutations; depth/size limits; no prototype/dynamic code behavior |
| URLs | HTTPS and allowlisted host/path where accepted; never / from user input |
| Pagination | Bounded integer limit, opaque cursor, allowlisted stable sort key/direction |
| Filters | Resource-specific allowlist; no Sheet column, formula, regex, A1 range, or raw owner/scope expression |

### Request validation examples

The following examples show validated request bodies for major mutation operations:

**Create task:**

Validated: title 1-300 chars, description max 4000 chars, priority in [LOW, MEDIUM, HIGH], enrollmentSubjectId belongs to owner.

**Batch schedule revision:**

Validated: dayOfWeek 1-7, times HH:mm, startTime < endTime, modality in enum, buildingId/roomId relationship, subject ownership.

**COR draft update:**

Validated: draftVersion matches current, all included subjects have code/title/units, all meetings have day/time, no conflicts.

**Admin role grant:**

Validated: roleKey exists and is grantable, scopeType/scopeId compatible, grantor has broader scope, no self-escalation.

### Spreadsheet formula injection

Repositories must treat user/admin/provider text as data. Before writing a text cell, neutralize leading formula markers according to the storage contract and preserve the intended displayed text. No untrusted value may be written as a formula. Sheet formulas are not used for authorization, joins, validation, or business state.

### File validation

Cloudflare performs declared size/content-type checks before forwarding. Apps Script repeats authoritative checks:

- Allowed extension and claimed MIME are only hints.
- Decode and verify magic bytes/file signature.
- Recompute content hash from bytes.
- Enforce configured bytes, page count, pixel/dimension, and decompression limits where the available decoder/provider can validate them.
- Reject encrypted/locked/corrupt documents unless a later approved path supports them.
- Sanitize the stored filename or replace it with an internal name; keep the original display name only if policy permits and never log it when identifying.
- Do not execute PDF JavaScript, embedded files, macros, actions, links, or external resources.

The final file types and maximum size remain deployment decisions. Limits must be proven across browser, Cloudflare, Apps Script request size/execution time, Drive, and provider constraints.

### Domain validation

- Student number normalization and uniqueness follow the approved QCU rule; conflicts never auto-merge users.
- Catalog codes and aliases use entity-specific uniqueness constraints.
- Deactivated catalog records remain valid for historical reads but cannot be selected for new active records.
- Enrollment section, offering, term, program, and campus relations must agree.
- Schedule entries must reference an enrollment subject under the same owner/enrollment/schedule.
- Room belongs to building; building belongs to campus; cross-campus selection requires an approved rule.
- Exact schedule duplicates are rejected. Overlaps return the defined blocking or acknowledgement state.
- Task/note subject or schedule references must belong to the current actor.
- Announcement audience ID must match its audience type and publisher scope.
- COR provider output must satisfy the strict canonical extraction schema and cannot supply application owner IDs or trusted database IDs.

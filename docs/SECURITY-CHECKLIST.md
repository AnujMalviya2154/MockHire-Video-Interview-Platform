# Production-Grade Security & Quality Checklist

Applies to every milestone. Before any code is written or modified, these rules
are followed; if a rule cannot be satisfied, stop and explain why instead of
guessing. Every milestone ends with an explicit review against this list.

## General
- Follow industry best practices; prefer secure defaults over convenience.
- No deprecated APIs or libraries.
- Modular, maintainable, documented code.
- No TODOs, placeholder logic, or mock security.

## Secrets & Configuration
- Never hardcode API keys, passwords, JWT secrets, DB credentials, or tokens.
- All secrets come from environment variables.
- Server secrets never reach client-side code.
- `.env` is never committed; `.env.example` carries placeholders only.

## Authentication
- Passwords hashed with bcrypt (cost 12) — never stored plain.
- All authenticated routes protected.
- Tokens expire appropriately (24 h).
- Tokens revoked on logout (tokenVersion bump — real revocation).

## Authorization
- Permissions validated on every protected endpoint.
- Client-provided roles/user IDs are never trusted — role is read fresh
  from the DB on each request; JWT carries no role claim.
- Users access only their own resources unless explicitly authorized.

## Input Validation
- All input validated and sanitized server-side; frontend validation is UX only.
- Malformed/unexpected input rejected with 400.

## Database Security
- Mongoose (safe ORM) with strictQuery; express-mongo-sanitize against
  NoSQL injection.
- IDs validated before querying (CastError handled centrally).
- Internal DB errors never exposed to clients.

## API Security
- HTTPS assumed in production (secure cookies, HSTS via helmet, trust proxy).
- CORS locked to explicit CLIENT_ORIGIN with credentials.
- Rate limiting: general API + stricter auth-endpoint limiter.
- Generic error messages; no implementation details leaked.

## Frontend Security
- No secrets in frontend bundles.
- User-generated content rendered as text (React escaping); no
  dangerouslySetInnerHTML without sanitization.

## File Uploads
- v1 has no file uploads. If added: validate type/size, rename safely,
  never trust user filenames.

## Logging
- Never log passwords, tokens, secrets, or personal data.
- Meaningful server-side errors without sensitive detail.

## Third-Party Providers & APIs
- Permanent provider secrets (e.g., API keys) must never be sent to the client.
- Generate and issue ephemeral, short-lived credentials for client use.
- Hard safety boundaries (e.g., usage cutoffs, egress limits) must be enforced at the application level to prevent financial abuse.

## Dependencies
- Stable, maintained packages only; minimal dependency surface.
- `npm audit` clean before every milestone commit.

## Performance
- No N+1 queries (use .populate/aggregation deliberately).
- Pagination for large datasets.

## Code Quality
- Clean, readable; no dead code or unused imports.
- Edge cases handled; async errors routed to the central error handler.

## Testing
- Auth and authorization flows verified per milestone (smoke tests).
- Edge cases considered.

## Before Finishing (every milestone)
Explicitly report: security issues, performance concerns, scalability
concerns, code smells, missing validation, remaining risks — and confirm
no secrets were hardcoded.

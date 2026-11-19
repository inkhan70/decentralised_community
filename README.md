# Decentralized Community Hub

Express + Socket.io server and web app for a trade-guild community: member
accounts, a **peer-verified contribution ledger** (the "Nation Balance"), live
guild-scoped polls with deadlines, guild and community chat, and presence.
Storage is pluggable (MongoDB or a zero-setup local JSON file).

## Quick start

```bash
cp .env.example .env
# edit .env: set JWT_SECRET (openssl rand -hex 32) and either
#   STORAGE_DRIVER=local            (no database needed), or
#   STORAGE_DRIVER=mongo + MONGO_URI
npm install
npm test
npm start            # open http://localhost:3000, create an account, invite others
```

Create two or three accounts (use a private window for each) to see
endorsements, guild chat and live voting work.

## Features

| Area | What it does |
|---|---|
| **Accounts** | Register / sign in from the UI (no more pasting JWTs). Session survives a page reload; expired or revoked sessions are detected and sent back to sign-in. |
| **Peer-verified ledger** | A logged contribution starts *pending*. It counts towards the Nation Balance and the contributor's balance only after `VERIFICATION_THRESHOLD` **other** members endorse it. No self-endorsing, no double endorsing, and the credit happens exactly once. Set the threshold to `0` for the old trust-based behaviour. |
| **Guild totals & leaderboard** | Verified totals per guild (live bars) and a top-contributors list. |
| **Polls with lifecycle** | Optional deadline (closes itself and tells everyone), early close by the creator, guild-restricted voting, "your vote" indicator, live percentages. |
| **Chat** | Guild channel and a community-wide channel, persisted, with bounded history. |
| **Presence** | Who is online, overall and in your guild. |
| **Abuse protection** | Per-socket token-bucket rate limiting, login limiter that only counts failures, payload validation on every event. |
| **Operations** | Strict CSP, `TRUST_PROXY` support, graceful shutdown, `/health`, CI workflow, Docker image without dev dependencies. |

## Code review: what was found and fixed

Each item below was reproduced against the original code before being fixed,
and now has a regression test.

**Critical**

- **Remote crash (DoS).** `create_poll` called `targetTrade.toLowerCase()` before type-checking it. Any signed-in member sending `targetTrade: 123` caused an unhandled promise rejection, which terminates Node >= 15. Every socket handler now runs inside a guard (try/catch, rate limit, safe error messages), and `server.js` logs stray rejections as a last resort.
- **The bundled UI could not work.** `helmet()`'s default CSP blocks the CDN script, the inline `<script>` and every `onclick`. On plain-http LAN use it also adds `upgrade-insecure-requests`. The frontend is rebuilt with same-origin JS/CSS, the Socket.io client is served by the server itself, and the CSP is explicit and strict.
- **Guild restriction was not enforced on votes.** Anyone could vote in any guild's poll by knowing its id (a mason voted in a doctors-only poll). Votes are now checked against the poll's target guild.
- **Unlimited self-awarded balance.** Three `submit_contribution` events of 1,000,000 produced a Nation Balance of 3,000,000. Contributions now need peer endorsement (configurable), and events are rate limited.

**Important**

- Voting wrote the vote record and the tally separately; a failure in between left them disagreeing. A failed or too-late tally now rolls the vote back.
- Non-string `password` on login returned HTTP 500; object `fullname`/`contact_number` were stored as-is. All inputs are type- and length-validated.
- Unknown usernames returned faster than wrong passwords (username enumeration by timing). Both now cost one bcrypt comparison.
- Socket auth trusted the token's claims forever. It now also requires the member to exist and uses their current guild.
- JWT algorithm is pinned to HS256 for REST and sockets.
- A missing `JWT_SECRET` outside production fell back to a publicly known constant, so anyone on the LAN could forge tokens. It now uses a random per-process secret.
- `parseInt(x) || default` turned an explicit `0` into the default. Env parsing now keeps `0` and rejects garbage.
- Newly connected clients never loaded existing polls, the balance or the ledger. A single `sync` call now delivers the full state on every (re)connect.
- Rate limiting behind a reverse proxy saw only the proxy's IP. Added `TRUST_PROXY`.
- The Docker healthcheck used `localhost` (can resolve to `::1` on Alpine while the server listens on IPv4) and a hard-coded port.
- Vulnerable production dependencies (`mongoose`, `body-parser`, `qs`) updated; `npm audit --omit=dev` is clean.

## Behaviour changes to be aware of when upgrading

1. **`VERIFICATION_THRESHOLD` defaults to 2.** New contributions are pending until two other members endorse them. A community with fewer than three members cannot verify anything: set it to `0` or `1` there. Existing ledger entries (no `status`) are treated as verified, and existing JSON files / Mongo documents upgrade in place.
2. **Poll targets:** members may create polls for *everyone* or *their own guild* only. (Before, any guild could be targeted, including ones the creator could not vote in.)
3. **Server URL field removed** from the UI. The page always talks to the origin it was loaded from, which is what the strict CSP allows.
4. **`GET /api/ledger/history`** is a superset of the old response (`user_id`, `createdAt`, etc. are unchanged) plus `status`, `endorsementCount`, ...
5. `nation_balance_updated` now fires when a contribution becomes *verified* (previously on every submission), and carries `byTrade` and `leaderboard` as well.

## API

REST (all except auth need `Authorization: Bearer <token>`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Create account / sign in |
| GET | `/api/dashboard/me` | Your profile, Nation Balance |
| GET | `/api/ledger/history?limit&status=pending\|verified&trade&before` | Ledger, newest first, cursor via `before` (ISO date) |
| GET | `/api/stats` | Totals, per-guild totals, leaderboard, pending count |
| GET | `/api/polls` | Polls visible to you, with your votes |
| GET | `/api/chat/guild`, `/api/chat/community` | Recent messages |
| GET | `/health` | Liveness + storage status |

Socket.io (connect with `io({ auth: { token } })`). Every client event accepts an
optional ack callback returning `{ ok: true, ... }` or `{ ok: false, error }`.

| Client emits | Server broadcasts |
|---|---|
| `sync` (returns stats, ledger, polls, chat, presence) | |
| `submit_contribution {amount, description}` | `contribution_updated`, and `nation_balance_updated` when verified |
| `endorse_contribution {entryId}` | `contribution_updated`, `nation_balance_updated` on verification |
| `create_poll {title, options[], targetTrade?, durationHours?}` | `new_poll_available` |
| `cast_vote {pollId, optionIndex}` | `poll_results_updated` (room), `vote_recorded` (your devices) |
| `close_poll {pollId}` | `poll_closed` (also sent automatically at the deadline) |
| `send_message {channel: 'guild'\|'community', text}` | `chat_message` |
| | `presence_updated`, `error_message` |

## Configuration

See `.env.example`; every variable is documented there. New in 1.2:
`VERIFICATION_THRESHOLD`, `MAX_POLL_DURATION_HOURS`, `POLL_SWEEP_INTERVAL_MS`,
`SOCKET_RATE_BURST`, `SOCKET_RATE_PER_SEC`, `CHAT_MAX_LENGTH`,
`CHAT_HISTORY_LIMIT`, `CHAT_RETENTION`, `TRUST_PROXY`.

## Project layout

```
server.js                    Entry point: HTTP + Socket.io, graceful shutdown
src/
  app.js                     Express app (helmet CSP, CORS, routes, static UI)
  config/env.js              Validated environment
  middleware/auth.js         JWT verification (HS256 pinned)
  routes/                    auth.js, api.js (thin: validate, call services)
  services/                  ledgerService, pollService, chatService  <- business rules
  sockets/                   index.js (guarded handlers), rateLimit.js
  storage/                   index.js + localDriver.js + mongoDriver.js (same interface)
  models/index.js            Mongoose schemas (Mongo driver only)
  utils/validators.js        Pure input validation
public/                      index.html, app.js, styles.css (no inline JS, no CDN)
tests/                       Jest: unit, service, HTTP, socket and browser-UI (jsdom) tests
```

Services hold every rule (who may vote, when a contribution verifies); REST and
sockets only translate. Both storage drivers implement the same repository
interface, so a rule changes in one place.

## Testing

```bash
npm test        # 83 tests, fully offline
```

Covers validators, auth, both REST and socket flows against a real running
server, concurrency, legacy-data upgrade, rate limiting, CSP/asset checks, and
a jsdom run of the real frontend against the live server (register -> log
contribution -> endorse -> vote -> chat -> sign out, including XSS payloads).

## Docker

```bash
cp .env.example .env   # fill in real values first
docker compose up --build
```

Behind a reverse proxy, set `TRUST_PROXY=1` and terminate TLS there.

## Known limitations

- **The MongoDB driver is covered by review, not by automated tests.** The test suite runs against the local driver, because no MongoDB instance is available offline. The Mongo path uses single atomic `findOneAndUpdate` steps for endorsement/voting; please run the suite's flows once against a disposable Mongo before relying on it (the services are driver-agnostic, so the same tests can be pointed at it).
- The `local` driver is for a **single process** and rewrites the whole JSON file on each change; use Mongo for several instances or a large community.
- Rate limits and presence are in-memory per process.
- The JWT lives in `sessionStorage` (cleared when the tab closes) and there is no password reset or token revocation yet.
- Administrator tools are limited to the read-only oversight console described below; member moderation and policy editing are not implemented.

## Administrator workflow (enhanced)

The deployment now supports a separately assigned `admin` role. Public account
creation always creates a normal `member` unless the deployment owner supplies
the private `ADMIN_SETUP_KEY` during registration. The key should be a long,
random secret, kept only in the hosting provider's environment settings. Create
the administrator account, then remove `ADMIN_SETUP_KEY` from the deployment
environment and redeploy. Never publish the key or commit it to Git.

After signing in, an administrator sees the **Administrator console** with:

1. Community overview: member count, verified Nation Balance and pending count.
2. Contribution review queue: pending submissions and their endorsement progress.
3. Member directory: recent members, guild and verified balance.
4. Refresh action to reload the current data from the backend.

This first admin console is intentionally read-only. Peer verification remains
the authority for contribution credit; admins cannot silently approve their own
financial records. Member suspension, role management, audit exports and policy
editing are not yet implemented and should be added with explicit audit logs
before this is used for a real organization.

## Free preview deployment

A starter `render.yaml` is included for a Render Node web service. For a preview,
create a free MongoDB Atlas cluster, create a database user, allow the Render
service to connect, then deploy this repository on Render using the Blueprint.
Set `MONGO_URI` and `ADMIN_SETUP_KEY` in Render's environment settings. The app
uses MongoDB in hosted mode because Render's free web filesystem is temporary;
local JSON storage is for development on your own device only.

Free hosting is suitable for demos and early testing, not a dependable production
service: Render free services sleep after inactivity and lose local filesystem
changes on restart/redeploy. MongoDB Atlas Free has storage and feature limits.
For a real society with important records, arrange managed backups, monitoring,
access review and a paid persistent hosting/database plan before launch.

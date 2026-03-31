# Environment Variables

Use these keys in your real `.env` file on the server.

## Common

- `PORT=3000`
- `SMT_PROVIDER=unofficial` (`official` or `unofficial`)
- `SMT_SESSION_TTL_SECONDS=7200` (how long login sessions stay valid in memory)
- `SMT_SESSION_STORE=memory` (`memory` or `redis`)
- `REDIS_URL=redis://localhost:6379` (required when `SMT_SESSION_STORE=redis`)
- `SMT_REDIS_KEY_PREFIX=smt:session:`
- `SMT_ODR_MAX_PER_HOUR=2`
- `SMT_ODR_MAX_PER_DAY=24`
- `SMT_ODR_LIMIT_STORE=memory` (`memory` or `redis`; defaults to SMT_SESSION_STORE)
- `SMT_ODR_REDIS_KEY_PREFIX=smt:odr:`
- `SMT_BACKEND_API_KEY=` (optional; when set, clients must send `x-api-key`)
- `API_RATE_LIMIT_MAX=300`
- `API_RATE_LIMIT_WINDOW_MS=60000`
- `API_RATE_LIMIT_USAGE_HISTORY_MAX=600` (higher bucket for usage-history endpoint)

## Database & Auth

- `SMT_DB_PATH=./data/smt.db` (SQLite database file path; defaults to `backend/data/smt.db`)
- `SMT_ENCRYPTION_KEY=` (AES-256 key for encrypting stored SMT passwords; **change in production**)
- `JWT_SECRET=` (JWT signing secret; **change in production**)
- `JWT_EXPIRES_IN=30d` (JWT token expiry; e.g. `7d`, `30d`, `1y`)
- `ADMIN_SMT_USERNAMES=` (comma-separated SMT usernames with admin role)
- `ADMIN_USER_IDS=` (comma-separated DB user IDs with admin role)
- `DEMO_ADMIN_USERNAME=` (leave empty in production; dev-only helper)
- `DEMO_ADMIN_PASSWORD=` (leave empty in production; dev-only helper)

## Background Sync

- `SMT_SYNC_ENABLED=true` (set to `false` to disable background data sync)
- `SMT_SYNC_INTERVAL_MS=1800000` (sync interval in ms; default 30 minutes)

## Official Provider

- `SMT_OFFICIAL_BASE_URL=https://uatservices.smartmetertexas.net`
- `SMT_SERVICE_USERNAME=...`
- `SMT_SERVICE_PASSWORD=...`
- `SMT_REQUESTER_TYPE=TDSP`
- `SMT_REQUESTER_AUTH_ID=...`
- `SMT_DELIVERY_MODE=API`
- `SMT_ESIID=...`
- `SMT_TERMS_ACCEPTED=Y`

## Unofficial Provider

- `SMT_UNOFFICIAL_BASE_URL=https://www.smartmetertexas.com`
- `SMT_UNOFFICIAL_AUTH_PATH=/commonapi/user/authenticate`
- `SMT_UNOFFICIAL_USAGE_PATH=/api/usage/latestodrread`
- `SMT_UNOFFICIAL_ONDEMAND_PATH=/api/ondemandread`
- `SMT_UNOFFICIAL_ODR_STATUS_PATH=/api/usage/latestodrread`
- `SMT_UNOFFICIAL_USAGE_HISTORY_PATH=/api/usage/history`
- `SMT_UNOFFICIAL_DAILY_USAGE_PATH=/api/usage/daily`
- `SMT_UNOFFICIAL_MONTHLY_USAGE_PATH=/api/usage/monthly`
- `SMT_UNOFFICIAL_PROFILE_PATH=/commonapi/user/getuser`
- `SMT_UNOFFICIAL_REMEMBER_ME=true`
- `SMT_UNOFFICIAL_ALLOW_ENV_FALLBACK=false` (recommended for multi-user; set `true` only for local dev)

### Optional dev-only fallbacks (used only when `SMT_UNOFFICIAL_ALLOW_ENV_FALLBACK=true`)

- `SMT_UNOFFICIAL_USERNAME=...`
- `SMT_UNOFFICIAL_PASSWORD=...`
- `SMT_UNOFFICIAL_ESIID=...`
- `SMT_UNOFFICIAL_METER_NUMBER=...`
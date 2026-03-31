# Backend V1 Release Checklist

This checklist is for deploying `backend/` to a production server.

## 1) Server prerequisites

- Ubuntu 22.04+ or equivalent Linux server
- Node.js 20 LTS
- PM2 (`npm i -g pm2`) or systemd service
- Nginx (reverse proxy + TLS termination)
- Redis (recommended for session/ODR stores)
- Firewall rules (allow only 80/443 publicly; restrict DB/Redis to private network)

## 2) Environment configuration

Use `docs/env.production.example.txt` as baseline.

Minimum required before go-live:

- `NODE_ENV=production`
- `SMT_BACKEND_API_KEY`
- `JWT_SECRET`
- `SMT_ENCRYPTION_KEY`
- `CORS_ALLOWED_ORIGINS`
- `SMT_SESSION_STORE=redis`
- `REDIS_URL`
- `SMT_UNOFFICIAL_ALLOW_ENV_FALLBACK=false`

Admin RBAC:

- `ADMIN_SMT_USERNAMES=admin_username_1,admin_username_2`
- or `ADMIN_USER_IDS=1,7,9`

Disable demo admin in production:

- `DEMO_ADMIN_USERNAME=`
- `DEMO_ADMIN_PASSWORD=`

## 3) Build and start

```bash
cd backend
npm ci --omit=dev
NODE_ENV=production npm start
```

With PM2:

```bash
pm2 start server.js --name smt-backend --time
pm2 save
pm2 startup
```

## 4) Reverse proxy + TLS

- Route `https://api.yourdomain.com` -> `http://127.0.0.1:3000`
- Enforce HTTPS redirect at Nginx
- Set request body size sane limit (`client_max_body_size 1m`)
- Set timeouts for upstream (read/send/connect) appropriate to your long endpoints

## 5) Health and readiness probes

New endpoints available:

- `GET /healthz` (liveness)
- `GET /readyz` (readiness + DB check)

Use in load balancer / uptime monitor.

## 6) Security hardening checks

- `x-powered-by` disabled
- Security headers enabled in app middleware
- API key middleware active for `/api/*`
- JWT auth and admin RBAC enforced on admin routes
- Rate limit env values reviewed (`API_RATE_LIMIT_*`)

## 7) Performance and reliability smoke tests

Before opening traffic:

```bash
npm test
```

Manual smoke:

- Login normal user
- Login admin user
- `GET /healthz` returns success
- `GET /readyz` returns success
- Usage history requests return quickly and include `x-cache` hit after first call
- WebSocket connects and receives updates

## 8) Monitoring / operations

- Collect app logs (PM2 + logrotate)
- Add error-rate and p95 latency alerts
- Track 401/403/429 spikes separately
- Backup SQLite DB (`SMT_DB_PATH`) regularly


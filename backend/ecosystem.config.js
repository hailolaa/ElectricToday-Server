/**
 * PM2 Ecosystem File – SMT Backend
 *
 * Usage:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload smt-backend --update-env          # zero-downtime restart
 *   pm2 save && pm2 startup                      # persist across reboots
 *   pm2 logs smt-backend --lines 200             # tail logs
 *   pm2 monit                                    # live dashboard
 */
module.exports = {
  apps: [
    {
      name: "smt-backend",
      script: "server.js",
      cwd: __dirname,

      // ── Cluster / instances ──────────────────────────────────────
      // "max" = one worker per CPU core.  Use a fixed number (e.g. 2)
      // on small VPS boxes to leave headroom for SQLite / OS.
      instances: 1, // SQLite is single-writer; keep 1 unless using Redis session store
      exec_mode: "fork",

      // ── Restart policy ───────────────────────────────────────────
      max_memory_restart: "512M",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 3000,

      // ── Logging ──────────────────────────────────────────────────
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      merge_logs: true,
      log_type: "json",

      // ── Environment – development (default) ──────────────────────
      env: {
        NODE_ENV: "development",
        PORT: 3000,
      },

      // ── Environment – production (`--env production`) ────────────
      // Secrets should come from your real .env file on the server.
      // These are safe non-secret defaults / overrides only.
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};

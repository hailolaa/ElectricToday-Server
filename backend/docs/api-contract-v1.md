# SMT API Contract V1

Source of truth for Flutter <-> backend integration.

## Response envelope

### Success
```json
{
  "success": true,
  "provider": "official|unofficial|backend",
  "operation": "login|session_status|usage|usage_history|logout|...",
  "data": {},
  "meta": {
    "timestamp": "ISO-8601",
    "...": "operation-specific metadata"
  }
}
```

### Error
```json
{
  "success": false,
  "provider": "official|unofficial|backend",
  "operation": "login|session_status|usage|usage_history|logout|...",
  "error": {
    "code": "SMT_VALIDATION_ERROR|SMT_UNAUTHORIZED|SMT_SESSION_EXPIRED|SMT_RATE_LIMIT|SMT_REQUEST_ERROR|SMT_INTERNAL_ERROR|API_KEY_UNAUTHORIZED",
    "message": "Human-readable message",
    "details": null
  },
  "meta": {
    "timestamp": "ISO-8601"
  }
}
```

## Common headers

- `Content-Type: application/json` for JSON body requests
- `x-api-key` when backend env `SMT_BACKEND_API_KEY` is configured
- `x-smt-session-id` for authenticated SMT session routes

## Session policy

- TTL is configured by `SMT_SESSION_TTL_SECONDS` (default `7200`).
- Policy is **sliding expiration**: each valid authenticated call refreshes TTL.
- Missing/invalid/expired session on protected routes returns:
  - HTTP `401`
  - error code `SMT_SESSION_EXPIRED`

## Standard error mapping

- `400` -> `SMT_VALIDATION_ERROR`
- `401` -> `SMT_SESSION_EXPIRED`
- `403` -> `SMT_UNAUTHORIZED`
- `429` -> `SMT_RATE_LIMIT`
- `5xx` -> `SMT_INTERNAL_ERROR`
- fallback -> `SMT_REQUEST_ERROR`

---

## POST `/api/smt/login`

Creates SMT session.

### Request body
Required:
- `username` or `userId` or `userid` (non-empty string)
- `password` (non-empty string)

Optional:
- `ESIID` (string)
- `rememberMe` (provider-pass-through)

### Success 200 (example)
```json
{
  "success": true,
  "provider": "unofficial",
  "operation": "login",
  "data": {
    "provider": "unofficial",
    "message": "Logged in to SMT",
    "data": {
      "defaultEsiid": "10443720005496119"
    }
  },
  "meta": {
    "timestamp": "2026-03-29T11:45:10.511Z",
    "sessionId": "6b590f42-e0c9-4ef4-9b70-8c2d4e71ec58",
    "sessionTtlSeconds": 7200
  }
}
```

### Errors
- `400 SMT_VALIDATION_ERROR`
- `401 SMT_SESSION_EXPIRED`
- `429 SMT_RATE_LIMIT`
- `500 SMT_INTERNAL_ERROR`

---

## GET `/api/smt/session`

Checks if provided session is active and returns session metadata.

### Headers
- `x-smt-session-id` required

### Success 200 (example)
```json
{
  "success": true,
  "provider": "unofficial",
  "operation": "session_status",
  "data": {
    "active": true,
    "sessionId": "6b590f42-e0c9-4ef4-9b70-8c2d4e71ec58",
    "providerName": "unofficial",
    "defaultEsiid": "10443720005496119",
    "sessionTtlSeconds": 7200,
    "ttlPolicy": "sliding",
    "checkedAt": "2026-03-29T12:05:00.100Z",
    "expiresAt": "2026-03-29T14:05:00.100Z"
  },
  "meta": {
    "timestamp": "2026-03-29T12:05:00.100Z"
  }
}
```

### Error
- `401 SMT_SESSION_EXPIRED` when session missing/invalid/expired

---

## POST `/api/smt/usage`

Fetches latest usage/ODR for active session.

### Headers
- `x-smt-session-id` required

### Body
Optional:
- `ESIID`
- provider payload fields

If `ESIID` is omitted, backend resolves in order:
1) query `ESIID`
2) session `defaultEsiid`
3) otherwise `400 SMT_VALIDATION_ERROR`

### Success 200 (example)
```json
{
  "success": true,
  "provider": "unofficial",
  "operation": "usage",
  "data": {
    "provider": "unofficial",
    "result": {
      "ESIID": "10443720005496119",
      "status": "SUCCESS",
      "usage": 1.83,
      "readAt": "03/29/2026 13:10:00"
    }
  },
  "meta": {
    "timestamp": "2026-03-29T11:49:12.241Z"
  }
}
```

### Errors
- `400 SMT_VALIDATION_ERROR`
- `401 SMT_SESSION_EXPIRED`
- `429 SMT_RATE_LIMIT`
- `500 SMT_INTERNAL_ERROR`

---

## POST `/api/smt/usage/history`

Returns usage history and aggregated points by granularity.

### Headers
- `x-smt-session-id` required

### Body
Optional:
- `ESIID` (string)
- `granularity`: `15m`, `1h`, `1d`, `1mo`, `hourly`, `daily`, `monthly`
- `startDate`, `endDate` for daily/monthly requests

Date format expected for daily/monthly provider calls:
- `MM/DD/YYYY`

### Success 200 (example)
```json
{
  "success": true,
  "provider": "unofficial",
  "operation": "usage_history",
  "data": {
    "provider": "unofficial",
    "result": {
      "ESIID": "10443720005496119",
      "points": [
        {
          "timestamp": "03/27/2026",
          "usage": 23.44
        }
      ]
    }
  },
  "meta": {
    "timestamp": "2026-03-29T11:53:30.101Z",
    "granularity": "1d",
    "sourcePoints": 30,
    "aggregatedPoints": 30
  }
}
```

### Errors
- `400 SMT_VALIDATION_ERROR`
- `401 SMT_SESSION_EXPIRED`
- `429 SMT_RATE_LIMIT`
- `500 SMT_INTERNAL_ERROR`

---

## POST `/api/smt/logout`

Idempotent logout.

### Behavior
- Always returns success.
- If session existed, it is deleted.
- If session missing/invalid, backend still returns success with `sessionExisted: false`.

### Success 200 (example)
```json
{
  "success": true,
  "provider": "unofficial",
  "operation": "logout",
  "data": {
    "loggedOut": true,
    "sessionExisted": false
  },
  "meta": {
    "timestamp": "2026-03-29T12:10:00.201Z"
  }
}
```
# SMT API Contract V1

This document is the source of truth for frontend/backend integration for:
- `POST /api/smt/login`
- `POST /api/smt/usage`
- `POST /api/smt/usage/history`

## Common response envelope

### Success
```json
{
  "success": true,
  "provider": "official|unofficial|backend",
  "operation": "login|usage|usage_history|...",
  "data": {},
  "meta": {
    "timestamp": "ISO-8601",
    "...": "operation-specific metadata"
  }
}
```

### Error
```json
{
  "success": false,
  "provider": "official|unofficial|backend",
  "operation": "login|usage|usage_history|...",
  "error": {
    "code": "SMT_VALIDATION_ERROR|SMT_UNAUTHORIZED|SMT_SESSION_EXPIRED|SMT_RATE_LIMIT|SMT_REQUEST_ERROR|SMT_INTERNAL_ERROR|API_KEY_UNAUTHORIZED",
    "message": "Human-readable message",
    "details": null
  },
  "meta": {
    "timestamp": "ISO-8601"
  }
}
```

## Headers

- `Content-Type: application/json` for JSON bodies
- `x-smt-session-id` required for authenticated SMT routes (`usage`, `usage/history`)
- `x-api-key` required only when backend env `SMT_BACKEND_API_KEY` is configured

---

## POST `/api/smt/login`

Creates SMT session and returns `sessionId` in `meta`.

### Request body

Required:
- `username` or `userId` or `userid` (non-empty string)
- `password` (non-empty string)

Optional:
- `ESIID` (string)
- `rememberMe` (string/bool-like; forwarded to provider)

### Success (200)
```json
{
  "success": true,
  "provider": "unofficial",
  "operation": "login",
  "data": {
    "provider": "unofficial",
    "message": "Logged in to SMT",
    "data": {
      "defaultEsiid": "10443720005496119"
    }
  },
  "meta": {
    "timestamp": "2026-03-29T11:45:10.511Z",
    "sessionId": "6b590f42-e0c9-4ef4-9b70-8c2d4e71ec58",
    "sessionTtlSeconds": 7200
  }
}
```

### Errors
- `400` -> `SMT_VALIDATION_ERROR`
- `401` -> `SMT_SESSION_EXPIRED` (invalid credentials / expired session context)
- `429` -> `SMT_RATE_LIMIT`
- `500` -> `SMT_INTERNAL_ERROR`

---

## POST `/api/smt/usage`

Fetches latest usage/ODR data for a session.

### Request body

Optional:
- `ESIID` (string)
- provider usage payload fields (validated when present)

Notes:
- Request still requires an authenticated SMT session.
- If request body omits `ESIID`, backend attempts to resolve from:
  1) query `ESIID`
  2) session default ESIID
  3) otherwise returns validation error.

### Success (200)
```json
{
  "success": true,
  "provider": "unofficial",
  "operation": "usage",
  "data": {
    "provider": "unofficial",
    "result": {
      "ESIID": "10443720005496119",
      "status": "SUCCESS",
      "usage": 1.83,
      "readAt": "03/29/2026 13:10:00"
    }
  },
  "meta": {
    "timestamp": "2026-03-29T11:49:12.241Z"
  }
}
```

### Errors
- `400` -> `SMT_VALIDATION_ERROR` (missing ESIID/invalid payload)
- `401` -> `SMT_SESSION_EXPIRED`
- `429` -> `SMT_RATE_LIMIT`
- `500` -> `SMT_INTERNAL_ERROR`

---

## POST `/api/smt/usage/history`

Returns usage points and backend-aggregated points by granularity.

### Request body

Optional:
- `ESIID` (string)
- `granularity` one of:
  - `15m`, `1h`, `1d`, `1mo`, `hourly`, `daily`, `monthly`
- `startDate` and `endDate` required for `daily/monthly` requests

Date format currently expected by backend provider layer for daily/monthly:
- `MM/DD/YYYY`

### Success (200)
```json
{
  "success": true,
  "provider": "unofficial",
  "operation": "usage_history",
  "data": {
    "provider": "unofficial",
    "result": {
      "ESIID": "10443720005496119",
      "points": [
        {
          "timestamp": "03/27/2026",
          "usage": 23.44
        }
      ]
    }
  },
  "meta": {
    "timestamp": "2026-03-29T11:53:30.101Z",
    "granularity": "1d",
    "sourcePoints": 30,
    "aggregatedPoints": 30
  }
}
```

### Errors
- `400` -> `SMT_VALIDATION_ERROR`
- `401` -> `SMT_SESSION_EXPIRED`
- `429` -> `SMT_RATE_LIMIT`
- `500` -> `SMT_INTERNAL_ERROR`

---

## Standard error code mapping

- `400` -> `SMT_VALIDATION_ERROR`
- `401` -> `SMT_SESSION_EXPIRED`
- `403` -> `SMT_UNAUTHORIZED`
- `429` -> `SMT_RATE_LIMIT`
- `5xx` -> `SMT_INTERNAL_ERROR`
- fallback -> `SMT_REQUEST_ERROR`
# SMT API Contract V1

## Envelope (all responses)
Success:
{
  "success": true,
  "provider": "unofficial|official|backend",
  "operation": "login|usage|usage_history|...",
  "data": {},
  "meta": { "timestamp": "ISO-8601", ... }
}

Error:
{
  "success": false,
  "provider": "unofficial|official|backend",
  "operation": "login|usage|usage_history|...",
  "error": {
    "code": "SMT_VALIDATION_ERROR|SMT_UNAUTHORIZED|SMT_SESSION_EXPIRED|SMT_RATE_LIMIT|SMT_INTERNAL_ERROR",
    "message": "Human-readable",
    "details": {}
  },
  "meta": { "timestamp": "ISO-8601" }
}


---

### POST /api/smt/login

**Required Headers:**
- `Content-Type: application/json`

**Required Body Fields:**
- `username` (string)
- `password` (string)

**Optional Fields:**
- none

**Success Sample**  
Status: 200
```json
{
  "success": true,
  "provider": "official",
  "operation": "login",
  "data": {
    "sessionId": "abcdefg1234567",
    "name": "Jane Doe"
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

**Error Samples**

400 Bad Request
```json
{
  "success": false,
  "provider": "official",
  "operation": "login",
  "error": {
    "code": "SMT_VALIDATION_ERROR",
    "message": "Missing required fields",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

401 Unauthorized
```json
{
  "success": false,
  "provider": "official",
  "operation": "login",
  "error": {
    "code": "SMT_SESSION_EXPIRED",
    "message": "Invalid username or password",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

429 Too Many Requests
```json
{
  "success": false,
  "provider": "official",
  "operation": "login",
  "error": {
    "code": "SMT_RATE_LIMIT",
    "message": "Too many login attempts",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

500 Internal Server Error
```json
{
  "success": false,
  "provider": "official",
  "operation": "login",
  "error": {
    "code": "SMT_INTERNAL_ERROR",
    "message": "Internal server error",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

---

### POST /api/smt/usage

**Required Headers:**
- `Content-Type: application/json`
- `x-smt-session-id`: SMT session ID

**Required Body Fields:**
- None (supports both via query / body, see below)

**Optional Fields:**
- `ESIID` (string, optionally as a body property or query parameter)
- custom `payload` (object)

**Success Sample**  
Status: 200
```json
{
  "success": true,
  "provider": "official",
  "operation": "usage",
  "data": {
    "ESIID": "10089000000001234",
    "usage": [
      {
        "timestamp": "2024-06-07T00:00:00.000Z",
        "kWh": 45.6
      }
    ]
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

**Error Samples**

400 Bad Request
```json
{
  "success": false,
  "provider": "official",
  "operation": "usage",
  "error": {
    "code": "SMT_VALIDATION_ERROR",
    "message": "Missing or invalid ESIID",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

401 Unauthorized / Session Expired
```json
{
  "success": false,
  "provider": "official",
  "operation": "usage",
  "error": {
    "code": "SMT_SESSION_EXPIRED",
    "message": "Invalid or expired session",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

429 Too Many Requests
```json
{
  "success": false,
  "provider": "official",
  "operation": "usage",
  "error": {
    "code": "SMT_RATE_LIMIT",
    "message": "Rate limit exceeded",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

500 Internal Server Error
```json
{
  "success": false,
  "provider": "official",
  "operation": "usage",
  "error": {
    "code": "SMT_INTERNAL_ERROR",
    "message": "Internal server error",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

---

### POST /api/smt/usage/history

**Required Headers:**
- `Content-Type: application/json`
- `x-smt-session-id`: SMT session ID

**Required Body Fields:**
- None

**Optional Fields:**
- `ESIID` (string)
- `startDate` (string, ISO-8601)
- `endDate` (string, ISO-8601)
- Additional provider-specific filters

**Success Sample**  
Status: 200
```json
{
  "success": true,
  "provider": "official",
  "operation": "usage_history",
  "data": {
    "ESIID": "10089000000001234",
    "history": [
      {
        "date": "2024-06-01",
        "kWh": 32.5
      },
      {
        "date": "2024-06-02",
        "kWh": 31.8
      }
    ]
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

**Error Samples**

400 Bad Request
```json
{
  "success": false,
  "provider": "official",
  "operation": "usage_history",
  "error": {
    "code": "SMT_VALIDATION_ERROR",
    "message": "Missing or invalid parameters",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

401 Unauthorized / Session Expired
```json
{
  "success": false,
  "provider": "official",
  "operation": "usage_history",
  "error": {
    "code": "SMT_SESSION_EXPIRED",
    "message": "Invalid or expired session",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

429 Too Many Requests
```json
{
  "success": false,
  "provider": "official",
  "operation": "usage_history",
  "error": {
    "code": "SMT_RATE_LIMIT",
    "message": "Rate limit exceeded",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

500 Internal Server Error
```json
{
  "success": false,
  "provider": "official",
  "operation": "usage_history",
  "error": {
    "code": "SMT_INTERNAL_ERROR",
    "message": "Internal server error",
    "details": null
  },
  "meta": {
    "timestamp": "2024-06-08T17:07:28.502Z"
  }
}
```

---



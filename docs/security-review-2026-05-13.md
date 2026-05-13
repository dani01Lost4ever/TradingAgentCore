# Security Review — TradingAI Platform
**Date:** 2026-05-13  
**Reviewer:** Claude Sonnet 4.6 (automated code review)  
**Scope:** Waves 0–4 implementation — IBKR/Bitpanda brokers, per-wallet pause persistence, per-wallet trading modes, cost/tax guardrails.  
**Repository root:** `C:\Users\Daniel\Repository\tradingAI`

---

## Executive Summary

The codebase demonstrates solid foundational security practices: JWT-based authentication with a `purpose` claim preventing token reuse, 2FA enforced before switching to live mode, meaningful audit logging on sensitive actions, per-wallet credential masking in all GET responses, and a well-structured pause-persistence design (Mongo-backed, restart-safe). The new per-wallet trading-config and cost-config endpoints correctly verify wallet ownership before any read or write. However, three issues require resolution before live trading should be enabled. First, the `liveTrading` flag defined in `WalletDoc` is scaffolded but never checked in the execution engine, making it a false safety signal — the actual real-money gate is `wallet.mode`, which IS checked by each adapter at construction. Second, the `ibkr_gateway_url` field is user-controlled and fed directly into server-side HTTP calls with no URL allowlist, creating a Server-Side Request Forgery (SSRF) vector. Third, the broker-fee and tax guardrails (`applyBrokerTaxGuardrails`) are implemented in `brain.ts` but `engineManager.ts` never passes a `costConfig` object to `getDecisions`, so the guardrail is silently bypassed for all automated cycle executions. Additionally, the `.env` file (which is not git-tracked) contains what appear to be real live Alpaca and Anthropic API keys — these should be rotated regardless of git exposure status.

---

## Findings Table

| # | Severity | Area | Finding | File:Line | Suggested Fix |
|---|----------|------|---------|-----------|---------------|
| 1 | CRITICAL | Live-Trading Gate | `liveTrading` flag in `WalletDoc` is never checked before order execution; it is a dead field, creating a false sense of safety. The real gate is `wallet.mode`, which IS enforced by the adapter, but the documented `liveTrading` field is misleading and unused. | `agent/src/schema.ts:271,314` / `agent/src/engineManager.ts:435-647` | Either: (a) add `if (!activeWallet.liveTrading && activeWallet.mode === 'live') return` in `runCycle` before calling `adapter.executeOrder`, or (b) remove the field and document that `wallet.mode === 'live'` is the sole live-trading gate. Choose one authoritative gate and enforce it consistently. |
| 2 | HIGH | SSRF | `ibkr_gateway_url` is a user-controlled wallet field accepted with no URL validation, and is used verbatim in server-side HTTP calls. A user can set `ibkr_gateway_url: http://169.254.169.254/latest/meta-data/` (AWS metadata) or `http://localhost:27017` (MongoDB) to make the server probe internal infrastructure. | `agent/src/exchanges/ibkr.ts:18,31` / `agent/src/keys.ts:272` | Add URL validation in `createUserWallet` and in the `IBKRAdapter` constructor: `const u = new URL(gatewayUrl); if (!['localhost','127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('.ibkr.com')) throw new Error('Invalid IBKR gateway URL')`. Use an explicit allowlist of hostnames/CIDR ranges rather than a blocklist. |
| 3 | HIGH | Cost Guardrail Bypass | `applyBrokerTaxGuardrails` is implemented in `brain.ts` but `engineManager.ts` passes no `costConfig` in the `DecisionRuntimeContext` to `getDecisions`. The function short-circuits on `undefined` (`if (!costConfig) return decisions`) so the broker-fee+tax filter never fires in the automated cycle. | `agent/src/engineManager.ts:466-474` / `agent/src/brain.ts:360-392` | In `engineManager.ts:runCycle`, after loading `activeWallet`, read `feeModel`, `taxRatePct`, `minNetProfitPct` from the wallet doc and pass a `costConfig` object in the runtime context: `costConfig: { feeModel: activeWallet.feeModel, taxRatePct: activeWallet.taxRatePct, minNetProfitPct: activeWallet.minNetProfitPct }`. |
| 4 | HIGH | Secret Exposure (env) | The `.env` file at repo root contains what appear to be live Alpaca API key/secret and an Anthropic API key in plaintext. The file is correctly `.gitignore`d and not committed, but is present on disk and accessible to any process running on the host. | `C:\Users\Daniel\Repository\tradingAI\.env:3-4,9` | Rotate these credentials immediately via the Alpaca and Anthropic dashboards. Do not store live credentials in `.env` files on developer machines; use a secrets manager or OS keychain integration for production deployments. |
| 5 | MEDIUM | Hardcoded JWT Secret | `JWT_SECRET` defaults to `'change-this-secret-in-production'` if `process.env.JWT_SECRET` is not set. A missing env var allows any attacker who knows the default to forge valid JWTs. | `agent/src/auth.ts:7` | Add a startup assertion: `if (!process.env.JWT_SECRET) { console.error('[auth] FATAL: JWT_SECRET not set'); process.exit(1) }`. Do not provide a fallback string. |
| 6 | MEDIUM | IBKR Credential Setting Not Exposed via API | `POST /api/wallets` does not destructure or forward `ibkr_session_token`, `bitpanda_api_key`, or `bitpanda_api_secret` from the request body (only `ibkr_gateway_url` is missing, but also `ibkr_session_token` and the Bitpanda secrets). The `createUserWallet` function in `keys.ts` accepts them, but the API endpoint drops them silently. Users cannot configure IBKR/Bitpanda wallets via the API. | `agent/src/api.ts:406-414` | Add the missing fields to the destructure: `const { ..., ibkr_gateway_url, ibkr_session_token, bitpanda_api_key, bitpanda_api_secret } = req.body` and pass them to `createUserWallet`. Also add a credential-update endpoint (e.g. `POST /api/wallets/:id/credentials`) separate from trading-config, so credentials can be rotated without recreating the wallet. |
| 7 | MEDIUM | CORS Wildcard | `Access-Control-Allow-Origin: '*'` is set globally. For a financial platform, this allows any website to make cross-origin requests. While JWT Bearer auth prevents credential-less exploitation, CSRF-style attacks via stolen tokens are more viable with a wildcard. | `agent/src/api.ts:93` | Restrict to known origins: `const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(','); res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : '')`. |
| 8 | MEDIUM | Strategy-Rule Executions Bypass Cost Guardrails | When `cfg.activeStrategy` is NOT `'llm'`, the rule-based strategy path (`engineManager.ts:476-487`) produces decisions that are never passed through `getDecisions` at all, so neither `applyCostGuardrails` nor `applyBrokerTaxGuardrails` are applied. The results go directly into the execution pipeline. | `agent/src/engineManager.ts:476-487` | After `decisions = stratResults.filter(...).map(...)`, call the guardrails explicitly: `decisions = applyCostGuardrails(decisions, await buildCostContext(...), cfg)` and `decisions = applyBrokerTaxGuardrails(decisions, costConfig)`. Alternatively, move guardrail application into the shared post-processing block so it applies regardless of strategy path. |
| 9 | MEDIUM | Admin Password Default | `ensureAdminExists` creates the bootstrap admin with `password: process.env.ADMIN_PASSWORD \|\| 'change-me-now'`. A missing `ADMIN_PASSWORD` env var leaves the admin account with a known default password. | `agent/src/auth.ts:158-169` | Add a startup assertion similar to JWT_SECRET: if `ADMIN_PASSWORD` is not set and no admin exists yet, abort startup rather than creating an insecure account. |
| 10 | LOW | Error Messages Leak Axios Config URL | In `ibkr.ts` and `bitpanda.ts`, error logging uses `err.response.config?.url` which could include the `ibkr_gateway_url` (user-controlled) in server-side logs. This leaks the SSRF probe target in logs, though not to the client. | `agent/src/exchanges/ibkr.ts:174` / `agent/src/exchanges/bitpanda.ts:206` | This is already limited to server logs (`console.error`) and not returned to the client. After fixing finding #2, the URL will be validated so the SSRF risk is mitigated. No immediate code change needed unless log scrubbing is required. |
| 11 | LOW | Unused `agentState.ts` Module | `agentState.ts` exports in-memory `pauseAgent`/`resumeAgent` functions. These are not imported or used anywhere in the current codebase — the superseding Mongo-persisted pause in `engineManager.ts` is correct. The dead module risks being accidentally re-imported in future code. | `agent/src/agentState.ts` | Delete the file or add a prominent deprecation comment. |
| 12 | LOW | 2FA Bypass When `twoFactorEnabled = false` | On `POST /api/wallets/:id/mode` (live mode toggle), 2FA is only required if `user.twoFactorEnabled`. Users without 2FA set up can switch to live mode with just their JWT. | `agent/src/api.ts:451-456` | This is a policy decision. Consider requiring 2FA enrollment before live mode is accessible at all: `if (!user.twoFactorEnabled) return res.status(403).json({ error: 'Enable 2FA before switching to live trading' })`. |
| 13 | LOW | `walletId` IDOR in Query-Param Endpoints | Several stat/equity/trade endpoints accept a `walletId` query param without verifying that the wallet belongs to the requesting user. An authenticated user can pass any walletId and see another user's trade data. | `agent/src/api.ts:548-550,573-575,819-820` | Add ownership verification: after accepting `walletId`, add `const wCheck = await WalletModel.exists({ _id: walletId, userId: currentUserId(req) }); if (!wCheck) return res.status(403).json({ error: 'Forbidden' })`. Admin users are exempt (already handled by the `isAdmin` scope). |

---

## Per-Finding Detail Blocks

### Finding #1 — `liveTrading` Flag Never Checked (CRITICAL)

The `WalletDoc` schema defines `liveTrading: { type: Boolean, default: false }` with documentation stating it is a "Live-trading hard gate — default false, requires explicit user opt-in." However, a grep across the entire codebase shows this field is only referenced in:

- `schema.ts:271,314` — definition
- `migrate-walletdoc-v2.ts:50` — migration seed (sets to `false`)

It is never read in `engineManager.ts`, `executor.ts`, or any adapter. The actual live/paper distinction is determined by `wallet.mode` being `'paper'` or `'live'`, which selects the paper API URL at adapter construction time. This means:

1. The documented intent (liveTrading = separate hard gate) is not enforced.
2. A user who has `liveTrading: false` but `mode: 'live'` will still execute real-money orders if `autoApprove` is true.
3. The field creates a false sense of security — any code review or audit will see "liveTrading" and assume it is enforced.

**Suggested fix in `agent/src/engineManager.ts` around line 440:**
```typescript
// After: if (activeWallet.paused) return
if (activeWallet.mode === 'live' && !(activeWallet as any).liveTrading) {
  console.warn(`[engine:${rt.username}] wallet ${walletId} is in live mode but liveTrading gate is false — skipping cycle`)
  return
}
```

Alternatively, remove the `liveTrading` field entirely and rely solely on `mode` as the single authoritative gate, which is already working correctly via adapter construction.

---

### Finding #2 — IBKR Gateway URL SSRF (HIGH)

The `ibkr_gateway_url` wallet field is:
1. Accepted from user input with no validation (`keys.ts:272`)
2. Stored in MongoDB as a string
3. Used verbatim to build all IBKR API URLs: `${this.gatewayUrl}/v1/api/...`

An attacker with a valid user account can set:
```
ibkr_gateway_url: http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

When the engine's market-data or portfolio fetch runs, the server will make an outbound HTTP GET to the AWS metadata endpoint (or any internal service), and the response will appear in logs or potentially surface in error messages.

**Suggested fix in `agent/src/exchanges/ibkr.ts` constructor (line 18):**
```typescript
constructor(gatewayUrl: string, sessionToken: string, mode: 'paper' | 'live') {
  if (!sessionToken) {
    throw new Error('IBKR gateway not authenticated — start gateway and log in via the browser.')
  }
  // Validate gateway URL to prevent SSRF
  try {
    const u = new URL(gatewayUrl)
    const allowedHosts = ['localhost', '127.0.0.1', '::1']
    const isAllowed = allowedHosts.includes(u.hostname) ||
                      u.hostname.match(/^10\./) || 
                      u.hostname.match(/^192\.168\./) ||
                      u.hostname.match(/^172\.(1[6-9]|2\d|3[01])\./)
    if (!isAllowed) {
      throw new Error(`IBKR gateway URL must point to a local/private network address. Got: ${u.hostname}`)
    }
  } catch (e: any) {
    if (e.message.includes('Invalid URL')) throw new Error(`Invalid IBKR gateway URL: ${gatewayUrl}`)
    throw e
  }
  this.gatewayUrl = gatewayUrl.replace(/\/$/, '')
  // ...
}
```

Also validate in `keys.ts:createUserWallet` before storing.

---

### Finding #3 — Cost/Tax Guardrail Not Passed to Automated Cycle (HIGH)

`brain.ts:applyBrokerTaxGuardrails` short-circuits when `costConfig` is `undefined`:
```typescript
function applyBrokerTaxGuardrails(decisions, costConfig) {
  if (!costConfig) return decisions   // ← always hit in automated cycles
  ...
}
```

`engineManager.ts:runCycle` calls `getDecisions(market, portfolio, ..., { userId, walletId, config, keys })` — the runtime context object does NOT include `costConfig`. The wallet's `feeModel`, `taxRatePct`, and `minNetProfitPct` fields are never read in the automated engine loop.

**Suggested fix in `agent/src/engineManager.ts:runCycle` (around line 444):**
```typescript
// After: const [keys, adapter] = await Promise.all([...])
const walletCostConfig = activeWallet ? {
  feeModel: {
    kind:   (activeWallet as any).feeModel?.kind   ?? 'percent',
    value:  (activeWallet as any).feeModel?.value  ?? 0,
    minFee: (activeWallet as any).feeModel?.minFee ?? 0,
  },
  taxRatePct:       (activeWallet as any).taxRatePct       ?? 26,
  minNetProfitPct:  (activeWallet as any).minNetProfitPct  ?? 0.5,
} : undefined

// Then pass it to getDecisions:
decisions = await getDecisions(market, portfolio, MAX_POSITION_USD, ..., {
  userId: rt.userId,
  walletId,
  config: cfg,
  keys: { ... },
  costConfig: walletCostConfig,    // ← add this
})
```

---

### Finding #4 — Live Credentials in `.env` File (HIGH)

The `.env` file (not git-tracked, but present on disk) contains:
- `ALPACA_API_KEY=PKQDVYKLGTVSJVMKP2DHAQ4ZSC` — appears to be a real Alpaca key
- `ALPACA_API_SECRET=9yEJpyn5t...` — full secret in plaintext  
- `ANTHROPIC_API_KEY=sk-ant-api03-...` — full Anthropic key in plaintext
- `MONGO_URI=mongodb+srv://danielbusettodb_db_user:PWU9bEMM29x...` — MongoDB Atlas credentials

**Immediate action required:** Rotate all four credentials via their respective dashboards. Even though the file is not in git history, it is readable by any local process and could be exfiltrated through path-traversal or process-memory attacks on the host.

---

### Finding #5 — Hardcoded JWT Fallback Secret (MEDIUM)

```typescript
// agent/src/auth.ts:7
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production'
```

The fallback `'change-this-secret-in-production'` is a known string. If `JWT_SECRET` is not set in production, any attacker who knows this string can forge valid auth tokens for any user (including admin).

**Fix:** Remove the fallback entirely and add a startup check:
```typescript
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  console.error('[auth] FATAL: JWT_SECRET environment variable is not set. Exiting.')
  process.exit(1)
}
```

---

### Finding #8 — Rule-Based Strategy Bypasses Cost Guardrails (MEDIUM)

In `engineManager.ts:runCycle`, when `cfg.activeStrategy !== 'llm'`, decisions are generated by `strategy.evaluate(...)` and collected in `decisions`, then fed directly into the execution pipeline without going through `getDecisions`. This means `applyCostGuardrails` and `applyBrokerTaxGuardrails` in `brain.ts` are never called for rule-based strategies (momentum, mean-reversion, etc.).

```typescript
// engineManager.ts:484-487 — no guardrails applied here
decisions = stratResults
  .filter(({ result }) => result.signal !== 'none')
  .map(({ asset, result }) => ({ action: result.action, ... }))
// decisions go straight to execution at line 625
```

**Fix:** Apply guardrails after the rule-based strategy path. Import the guardrail functions from `brain.ts` and call them with the wallet's cost config before the decisions enter the execution block.

---

### Finding #13 — WalletId IDOR in Query-Param Endpoints (LOW)

Several endpoints accept `?walletId=<id>` as a query parameter and use it directly in MongoDB queries without verifying the wallet belongs to the requesting user:

```typescript
// api.ts:548-550
const walletId = req.query.walletId as string | undefined
const scope: Record<string, any> = isAdmin(req) ? {} : { userId: currentUserId(req) }
if (walletId) scope.walletId = walletId   // no ownership check
```

An authenticated user can enumerate data from wallets belonging to other users by passing arbitrary `walletId` values. The scope filter adds `userId` to the outer query but not to the `walletId` sub-filter, creating a vector where user A can read user B's trade/equity data by knowing user B's walletId (a MongoDB ObjectId, guessable by increment/time).

Affected endpoints: `GET /api/trades`, `GET /api/stats`, `GET /api/equity/history`, `GET /api/stats/per-asset`, `GET /api/tokens/stats`, `GET /api/tokens/history`.

**Fix:** Before using the walletId, verify ownership:
```typescript
if (walletId && !isAdmin(req)) {
  const owned = await WalletModel.exists({ _id: walletId, userId: currentUserId(req) })
  if (!owned) return res.status(403).json({ error: 'Forbidden' })
}
```

---

## What Looked Good

- **Credential masking in GET responses.** `listUserWallets` in `keys.ts` returns only masked variants (`***xxxx`) for all sensitive fields, and uses boolean flags (`ibkr_session_token_set`, `bitpanda_api_secret_set`) rather than even masked values for single-use tokens. No raw secrets are returned by any GET endpoint.

- **Wallet ownership checks on new W1/W2 endpoints.** All four new endpoints (`/api/wallets/:walletId/trading-config`, `/api/wallets/:walletId/cost-config`, `/api/wallets/:walletId/discovery`, `/api/wallets/:walletId/discovery/run`) use `WalletModel.findOne({ _id: walletId, userId })` — the userId scoping prevents horizontal privilege escalation.

- **Pause persistence design.** `engineManager.ts:runCycle` re-reads `activeWallet` from MongoDB at the top of every cycle (`getActiveWallet(rt.userId)`) and gates on `activeWallet.paused` before any work. There is no in-memory cache of the pause flag. `resumeWallet` is the only function that sets `paused = false`, and `setBlocked` correctly writes `paused: true` to ALL wallets via `updateMany` rather than just in-memory. The `agentState.ts` legacy module is not imported anywhere.

- **2FA enforcement for live mode.** `POST /api/wallets/:id/mode` correctly requires a valid TOTP token (checked against `verifyTOTP`) before switching to `mode: 'live'`. The check gates on `user.twoFactorEnabled` (see Finding #12 for the edge case when 2FA is disabled).

- **Admin endpoints are auth-gated.** Despite not always listing `requireAuth` explicitly, all admin endpoints fall after `app.use('/api', requireAuth)` at line 190, and additionally perform `if (!isAdmin(req))` checks. Two layers of protection.

- **Rate limiting on sensitive auth endpoints.** Login (5 req/15min), 2FA (10 req/15min), and registration (3 req/hr) all have `express-rate-limit` applied.

- **Discovery worker is read-only.** `runDiscovery` in `discovery.ts` only reads from hardcoded universe lists or calls an LLM for ranking, then writes to `DiscoveryRunModel`. It does not call `executeOrder` or any adapter method that could result in a live order. The hardcoded `SP500_TOP50` and `CRYPTO_TOP10` lists eliminate external URL fetching for universe data.

- **No secrets in URLs.** IBKR uses a Cookie header (`cp.session=<token>`) rather than URL query params. Bitpanda uses a Bearer header. Binance HMAC signing appends the signature to the query string (standard practice) but does not embed the secret itself.

- **Audit logging coverage.** Pause, resume, live-mode toggle, wallet creation/deletion, credential key updates, trading-config changes, cost-config changes, discovery runs, and all admin actions produce `AuditLog` entries.

---

## Recommendations Before Enabling Live Trading

- [ ] **#4 (HIGH-priority immediate)** — Rotate the Alpaca API key/secret, Anthropic API key, and MongoDB Atlas credentials in the `.env` file. Do not wait.
- [ ] **#1 (CRITICAL)** — Decide on one authoritative live-trading gate and enforce it in `runCycle`. Either remove `liveTrading` (keep only `wallet.mode`) or implement the `liveTrading` check in `engineManager.ts:runCycle`.
- [ ] **#2 (HIGH)** — Add URL validation to `IBKRAdapter` constructor and to `createUserWallet` to prevent SSRF via `ibkr_gateway_url`.
- [ ] **#3 (HIGH)** — Pass `costConfig` from the wallet doc into the `getDecisions` runtime context in `engineManager.ts:runCycle` so `applyBrokerTaxGuardrails` actually fires.
- [ ] **#8 (MEDIUM)** — Apply cost guardrails to the rule-based strategy code path, not just the LLM path.
- [ ] **#5 (MEDIUM)** — Remove the `JWT_SECRET` fallback and add a startup assertion.
- [ ] **#9 (MEDIUM)** — Remove the `ADMIN_PASSWORD` default and abort startup if it is unset on first boot.
- [ ] **#13 (LOW)** — Add ownership verification for `walletId` query params in stat/equity/trade endpoints.
- [ ] **#12 (LOW, Policy)** — Decide whether 2FA enrollment should be mandatory before live trading.
- [ ] Set `CORS Access-Control-Allow-Origin` to a specific allowed origin list rather than `*` before any public deployment.

---

*Report generated by automated read-only code review. No files were modified.*

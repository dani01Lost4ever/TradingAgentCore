# Getting Started — TradingAI

Personal cheat sheet for spinning the project up on a fresh machine or coming back to it after a break. Last updated 2026-05-13 (post-redesign + security pass).

## 1. Prerequisites

- Node.js 20+ and npm
- MongoDB running locally (or a connection string to a remote instance)
- (Optional, for IBKR) Java 11+ to run the IBKR Client Portal Gateway
- (Optional, for Anthropic/OpenAI) at least one of: Anthropic API key, OpenAI API key

## 2. Clone + install

```bash
git clone <repo>
cd tradingAI
cd agent     && npm install
cd ../dashboard && npm install
cd ..
```

## 3. Environment — `agent/.env`

The server now **refuses to start** without `JWT_SECRET` and `ADMIN_PASSWORD`. This is intentional.

Create `agent/.env`:

```env
# === Required ===
MONGODB_URI=mongodb://localhost:27017/tradingai
JWT_SECRET=<long-random-string-min-32-chars>
ADMIN_PASSWORD=<your-first-admin-password>

# Generate a strong JWT secret with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# === Recommended ===
# CORS allowlist for the dashboard (Vite default is :5173)
ALLOWED_ORIGINS=http://localhost:5173

# Cycle defaults (overridable per-wallet from the UI)
POLL_INTERVAL_MINUTES=30
MARKET_DATA_INTERVAL_MINUTES=5
MAX_POSITION_USD=500
MANUAL_APPROVAL_TTL_MINUTES=30

# === Provider keys (also settable from the dashboard UI, but these are fallbacks) ===
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
ALPACA_API_KEY=
ALPACA_API_SECRET=
ALPACA_BASE_URL=https://paper-api.alpaca.markets

# === Optional ===
LLM_PROVIDER=claude
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=trading-llm
DISCOVERY_LLM=false   # set true to let an LLM rank discovery candidates
```

**Never commit this file.** It's already in `.gitignore`. If you rotate a key, update it here and restart the agent.

## 4. Migrate the database

If you have existing wallets from before this rewrite:

```bash
cd agent
npx ts-node scripts/migrate-walletdoc-v2.ts
```

Safe to re-run — it's idempotent. Adds all the new wallet fields (trading mode, pause state, fee model, tax rate, IBKR/Bitpanda creds, live-trading gate) with safe defaults on every existing wallet.

## 5. First run

Two terminals:

```bash
# Terminal A — backend
cd agent && npm run dev

# Terminal B — dashboard
cd dashboard && npm run dev
```

Open http://localhost:5173. The default admin is `admin` / `<ADMIN_PASSWORD from .env>`. Log in and immediately:

1. Visit `/profile` → enable 2FA. **Live trading requires 2FA.**
2. Visit `/settings` → set your Anthropic and/or OpenAI keys (or rely on the `.env` fallbacks).
3. Visit `/wallets` (or the wallet section of `/settings`) → configure your brokers.

## 6. Connect brokers

### Alpaca (paper, easy)

In the wallet form:
- Exchange: `alpaca`
- Mode: `paper`
- Alpaca API key + secret from https://alpaca.markets/dashboard
- Base URL: `https://paper-api.alpaca.markets`

For live Alpaca (mixed reviews from EU — use carefully):
- Same form, change Mode to `live`, change Base URL to `https://api.alpaca.markets`
- Switching to live mode requires 2FA token confirmation
- Plus you must **also** toggle the per-wallet `liveTrading` gate before any real-money order can fire

### Interactive Brokers (IBKR — recommended for stocks/ETFs)

IBKR requires a local gateway you control:

1. Download the **Client Portal Gateway** from https://www.interactivebrokers.com/en/trading/ib-api.php (free).
2. Unzip it. From inside the folder:
   ```bash
   bin/run.sh root/conf.yaml
   ```
   On Windows: `bin\run.bat root\conf.yaml`
3. Open https://localhost:5000 in your browser. Click through the cert warning. Log in with your IBKR credentials and complete 2FA.
4. Once logged in, the gateway keeps a session cookie. You need the `cp.session=...` cookie value — open browser devtools → Application → Cookies → copy the value.
5. In the dashboard's wallet form:
   - Exchange: `ibkr`
   - IBKR gateway URL: `http://localhost:5000` (or your LAN IP if running on another machine)
   - IBKR session token: paste the cookie value
6. The gateway URL is validated server-side — **only RFC1918 / localhost / `.local` hostnames are accepted** (SSRF guard). External URLs are rejected.

Keep the gateway running whenever you want the agent to trade. IBKR rotates the session periodically; if you start seeing auth errors, re-grab the cookie and update via `POST /api/wallets/:id/credentials`.

### Bitpanda (EU multi-asset)

1. https://www.bitpanda.com → Account → API → create an API key with **Read** + **Trade** scopes (no withdrawal).
2. In the wallet form:
   - Exchange: `bitpanda`
   - API key + secret from above
3. Bitpanda Pro has **no paper mode** — the adapter throws on construction if mode is `paper`. Use Alpaca paper for testing strategies first.
4. Stocks/ETFs via Bitpanda Fusion are **not yet supported** — crypto only on this adapter. Use IBKR for equities.

### Coinbase / Binance

Pre-existing adapters. Coinbase fees are higher than alternatives — only use if you already have funds there. Binance has unstable EU regulatory status as of 2026.

## 7. Configure a wallet for trading

In `/settings`, for the active wallet:

1. **Trading mode** — pick one:
   - `scalp`: 15-min cycles, crypto majors, tight 2% stops, up to 20 trades/day
   - `swing`: 2-hour cycles, balanced, 5% stops, 6 trades/day max
   - `long_term`: 12-hour cycles, ETFs + blue-chips, 15% stops, **2 trades/day max, 72h minimum hold** — the "slow trading" mode you wanted
2. **Override defaults** if you want: cycle minutes, asset universe (comma-separated), max trades/day, min holding minutes. Leave blank to use mode defaults.
3. **Costs & tax**:
   - Fee model: `percent` (e.g. 0.6 for IBKR equities) or `flat`
   - Tax rate: **26** (Italian capital gains)
   - Min net profit %: 0.5 (reject any trade whose expected gross profit can't beat fees + tax + 0.5%)
4. **Live trading gate**: leave OFF until you're ready. Requires 2FA to enable.

## 8. Pause / resume

- Per-wallet pause is now **persisted in Mongo**. It survives server restarts.
- Pausing wallet A does not stop wallet B. Each wallet has its own pause state.
- The only way `paused` flips to `false` is the explicit Resume button (or `POST /api/agent/resume` with `{walletId}`). Restarting the agent does **not** auto-resume.
- Blocking a user (admin action) pauses all of that user's wallets and does **not** auto-resume on unblock — you must explicitly resume each wallet.

## 9. Going live (the safe sequence)

1. Verify the wallet works in paper mode for at least a few cycles.
2. Confirm 2FA is enabled on your user (Profile page).
3. In Settings, flip `mode: paper → live` (asks for 2FA token).
4. In Settings, flip the `liveTrading` gate ON (asks for 2FA token again — defense in depth).
5. Both flags must be true before `executeOrder` is called. Either flag false → cycle returns early with a console warning.

Verify by checking the audit log (`/audit`) — every state change is logged.

## 10. Useful URLs / commands

```
http://localhost:5173/            Dashboard root
http://localhost:5173/discovery   Daily candidate asset list per wallet
http://localhost:5173/settings    Per-wallet trading + cost + credentials
http://localhost:5173/audit       Audit log (admin sees all, users see own)

# Health check (no auth)
curl http://localhost:3000/api/health

# Run migration
cd agent && npx ts-node scripts/migrate-walletdoc-v2.ts

# Type-check both halves
cd agent && npx tsc --noEmit
cd dashboard && npx tsc --noEmit
```

## 11. Where things live

- `agent/src/engineManager.ts` — runtime loop, per-wallet scheduling, pause check
- `agent/src/brain.ts` — LLM decision logic, cost guardrails
- `agent/src/costs.ts` — pure fee/tax math
- `agent/src/discovery.ts` — daily candidate-asset discovery
- `agent/src/exchanges/` — broker adapters (alpaca, binance, coinbase, ibkr, bitpanda + shared indicators)
- `agent/src/schema.ts` — Mongoose models. **Don't edit casually.** Add migrations.
- `agent/scripts/migrate-walletdoc-v2.ts` — idempotent migration template
- `dashboard/src/theme.ts` — themes (default: `aurora-dark`)
- `dashboard/src/index.css` — aurora-dark CSS tokens + utility classes
- `dashboard/mockups/` — design system reference HTML (kept for future redesigns)
- `docs/security-review-2026-05-13.md` — latest security audit

## 12. If something goes wrong

- **Server won't start, "FATAL: JWT_SECRET not set"** → set it in `agent/.env`, restart.
- **Server won't start, "FATAL: ADMIN_PASSWORD not set"** → set it in `agent/.env`. Only enforced when no admin exists yet — if you already created an admin, the env var becomes optional.
- **IBKR adapter throws "URL must point to a local/private network"** → the SSRF guard rejected your gateway URL. Use localhost / 127.x / 10.x / 172.16-31.x / 192.168.x / `.local`.
- **AI seems stuck on the same 2 assets** → your wallet's `assets` list is the bottleneck. Either edit it in Settings or trigger a discovery run from `/discovery`.
- **AI not trading despite signals** → check the cost guardrail. With Italian 26% tax + 0.6% fees, any trade needs at least ~1.7% expected gross move to clear `minNetProfitPct: 0.5`. Lower the threshold or wait for stronger signals.
- **Dashboard shows old wallet data after switching** → should not happen anymore; if it does, hard-reload and check the WS connection status indicator (top right). The `wallet:switched` event was the W1 fix.

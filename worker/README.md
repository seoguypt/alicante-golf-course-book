# golf-caddie-relay (Cloudflare Worker)

Bot-agnostic two-way relay between the Golf GPS page (`../gps/`) and a player's **own** Grok Bot
webhook routine. The Worker holds no bot URL or key: the page sends the player's webhook URL and
Authorization header with each "Vraag caddie" press; the Worker forwards once and forgets them.
So every answer runs on the usage of the bot whose webhook the player pasted.

Flow: page `POST /ask` → Worker forwards `{session, course, hole, lat, lon, accuracy, question, replyUrl, replyToken}`
to the webhook → the bot posts its Dutch reply to `replyUrl` with `X-Reply-Token` → page polls `GET /reply/<session>`.

Stored in KV (2 h TTL): SHA-256 of the reply token, the last reply text, small rate-limit counters. Nothing else.

## Deploy (free tier)
Needs a Cloudflare API token (template "Edit Cloudflare Workers" is enough), minimum:
- Account · Workers Scripts · Edit
- Account · Workers KV Storage · Edit
- Account · Account Settings · Read
- User · Memberships · Read and User · User Details · Read (wrangler whoami)
plus the account id, and a workers.dev subdomain claimed once in the dashboard (Workers & Pages → Overview).

```
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
npm install
npx wrangler kv namespace create RELAY      # paste id into wrangler.toml
npx wrangler deploy                         # prints https://golf-caddie-relay.<sub>.workers.dev
```
Then set `DEFAULT_RELAY` in `../gps/index.html` to that origin (or paste it in the page's "Relay URL" field).
Once the Grok Bot webhook host is known, set `ALLOWED_WEBHOOK_HOSTS` in wrangler.toml and redeploy.

## Local test
`.dev.vars` (gitignored): `DEV_INSECURE_WEBHOOK=yes` and `ALLOWED_ORIGINS=https://seoguypt.github.io,http://127.0.0.1:8099`
```
npx wrangler dev --port 8787 &
node test/relay.test.mjs
```

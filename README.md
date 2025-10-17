# Gmail OAuth 2.0 Test Application

A complete Node.js + Express application demonstrating Google OAuth 2.0 (web server flow) with Gmail API. Includes EJS views, CSRF state handling, token management, and test features for reading/sending emails.

## Prerequisites (Google Cloud)
1. Open https://console.cloud.google.com/
2. Create/select a project
3. Enable Gmail API: APIs & Services → Library → "Gmail API" → Enable
4. Create OAuth 2.0 Client ID (Application type: Web application)
5. Authorized redirect URI: `http://localhost:3000/oauth2callback`
6. Copy Client ID and Client Secret

## Setup
1. Node.js 18+ required
2. Copy `.env.example` to `.env` and fill values:
   - `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`
   - `PORT=3000`, `SESSION_SECRET=<random>`, `NODE_ENV=development`
3. Install dependencies:
   - `npm install`

## Run
- Dev (auto-reload): `npm run dev`
- Start: `npm start`

Visit http://localhost:3000 and click "Authenticate with Google".

## Deploy

### Docker
1. Build image:
   - `docker build -t gmail-oauth-test .`
2. Run (pass env vars):
   - `docker run -p 3000:3000 --env-file .env gmail-oauth-test`

Ensure your OAuth redirect URI includes your public domain: `https://yourdomain.com/oauth2callback`.

### Production Hardening Included
- `helmet` security headers (CSP disabled by default for EJS convenience)
- gzip compression
- rate limiting (300 req/15m per IP)
- morgan request logging
- secure cookies in production (SameSite=Lax, HttpOnly, Secure)
- `app.set('trust proxy', 1)` in production

### Platform Notes
- Reverse proxy/TLS: terminate TLS at your proxy and forward to Node. Set `NODE_ENV=production`.
- Environment: provide `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`, `SESSION_SECRET`, `PORT`.
- Tokens/sessions: this sample stores tokens in memory; for production, use a persistent store (DB/Redis/KMS) and rotate secrets.

## Endpoints & Views
- `GET /` → Home, auth button or dashboard link
- `GET /dashboard` → After login: stats, recent emails, token info
- `POST /send-test-email` → Send a test email
- `GET /api/emails/:id` → Fetch email metadata
- `POST /refresh-tokens` → Refresh access token (if available)
- `GET /logout` → Clear session
- `GET /health` → Health check

## Notes
- This sample stores tokens in memory. Use a DB in production.
- Keep `.env` out of version control.

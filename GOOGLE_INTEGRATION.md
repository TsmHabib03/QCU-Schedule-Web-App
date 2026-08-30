# Google Classroom integration

Google Integration is available only from `Settings -> Google Integration`. It uses Cloudflare Pages Functions for Google OAuth and API access. Google access and refresh tokens are encrypted into an `HttpOnly`, `SameSite=Lax` cookie and are never exposed to frontend JavaScript or localStorage. The browser stores only normalized Classroom/Gmail update cards for offline display.

## Required Cloudflare secrets

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_SESSION_SECRET` (a random value at least 32 characters long)

## Google Cloud setup

1. Enable Google Classroom API and Gmail API.
2. Configure the OAuth consent screen.
3. Under `APIs & Services -> Credentials -> your OAuth 2.0 Web application client`,
   add **both** of these to *Authorized redirect URIs*, exactly as written:

   ```
   https://my-schedule-5hs.pages.dev/api/google/callback
   http://127.0.0.1:8788/api/google/callback
   ```

   Add `http://127.0.0.1:8790/api/google/callback` too if you test through
   `npm run dev:wrangler`.

Google matches `redirect_uri` byte-for-byte and accepts no wildcards, so a
missing entry here is what produces `Error 400: redirect_uri_mismatch`. Because
Cloudflare Pages gives every deployment its own hostname
(`<hash>.my-schedule-5hs.pages.dev`), the production origin is pinned by
`GOOGLE_PUBLIC_ORIGIN` in `wrangler.toml`: OAuth started from a preview
hostname is handed off to the canonical origin first, so only the one canonical
callback URL ever needs to be registered. Update that variable and register the
matching callback URL if a custom domain is ever attached.

To see the exact string this deployment sends to Google, open
`/api/google/status` — the `oauth.redirectUri` field is that string.

Classroom read-only permissions are requested during the initial connection. Gmail metadata permission is requested separately only if the user enables Gmail Notifications.

For local development, copy `.dev.vars.example` to `.dev.vars`, add the real values, then run the project-owned development server:

```powershell
npm run dev
```

Open `http://127.0.0.1:8788/google.html#google-integration`. If the page is opened through VS Code Live Server on port `5500`, the frontend automatically uses the API server on port `8788`.

`npm run dev:wrangler` remains available for testing the Cloudflare Pages runtime directly on port `8790`.

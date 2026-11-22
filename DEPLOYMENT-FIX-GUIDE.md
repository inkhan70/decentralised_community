# Deployment configuration and Google sign-in checks

## Architecture
- Vercel: static frontend (`frontend/` root directory).
- Netlify: REST API and Google-token verification (repository root; `netlify.toml` handles function routing).
- MongoDB Atlas: shared database.
- Render: persistent Socket.IO service (`npm run start:realtime`).
- Firebase: Google sign-in provider and Admin SDK token verification.

## Netlify environment variables
Set these in Site configuration → Environment variables:
- `NODE_ENV=production`
- `STORAGE_DRIVER=mongo`
- `MONGO_URI`: the MongoDB Atlas connection string for this app
- `JWT_SECRET`: a long random secret (at least 32 characters)
- `ALLOWED_ORIGINS=https://decentralised-community.vercel.app,https://decentralised-community.netlify.app`
- `FIREBASE_SERVICE_ACCOUNT_JSON`: the full Firebase Admin SDK service-account JSON content
- `BOOTSTRAP_ADMIN_EMAIL`: the exact verified Google email allowed to receive the initial Super Admin role

## Render environment variables
The Render service uses the same `MONGO_URI` and exactly the same `JWT_SECRET` as Netlify. Set `NODE_ENV=production`, `STORAGE_DRIVER=mongo`, and the same `ALLOWED_ORIGINS`. The Render service does not need the Firebase service-account private key.

## Firebase Console
1. Authentication → Sign-in method → Google → Enable; choose a support email.
2. Authentication → Settings → Authorized domains: add `decentralised-community.vercel.app` and `decentralised-community.netlify.app`.
3. Project settings → Service accounts → Generate new private key. Put the downloaded JSON contents in Netlify's `FIREBASE_SERVICE_ACCOUNT_JSON`; never place it in frontend files or Git.
4. Ensure the Firebase web configuration in `frontend/config.js` belongs to the same Firebase project as the service-account JSON.

## MongoDB Atlas
- Confirm the database user/password in `MONGO_URI` are correct and URL-encode special characters in the password.
- In Atlas Network Access, allow connections from Netlify and Render. For a quick deployment diagnostic, Atlas documents the temporary `0.0.0.0/0` allowlist option; use it only if appropriate for your security requirements, and protect the database with a strong password and least-privilege database user.
- Confirm the database user has read/write access to the application database.

## Deploy order
1. Deploy the Netlify backend from the repository root.
2. Set the Netlify environment variables above and trigger a fresh deploy.
3. Check `https://decentralised-community.netlify.app/health` and `/api/health`; expect JSON with `status: ok`, `storageDriver: mongo`, and `db: connected`.
4. Deploy the Render realtime service from this repository using the included `render.yaml`; set its shared secrets.
5. Confirm its `/health` endpoint responds with `status: ok`.
6. Deploy the Vercel frontend with `frontend/` as the Root Directory.
7. Test Google sign-in, category onboarding, dashboard refresh, then realtime chat.

## Expected API routes
- `POST /api/auth/google` — Firebase ID token exchange.
- `GET /api/community/categories` — category list (requires app JWT).
- `POST /api/community/onboarding/category` — save selected category (requires app JWT).
- `GET /api/health` and `/health` — health checks.

A 503 response from the API now indicates MongoDB connectivity/configuration trouble. A 401 from `/api/auth/google` indicates a token verification issue. A 500 indicates a backend configuration or application error; inspect Netlify function logs.

## Troubleshooting the "Database is temporarily unavailable" error
The Netlify function now returns a `reason` code and `hint` with every 503 (they never include your credentials), and the frontend shows the hint. Open `https://decentralised-community.netlify.app/api/health` to see it too.

| `reason` | What to fix |
| --- | --- |
| `uri_missing` / `uri_placeholder` | Set `MONGO_URI` in Netlify to the real Atlas string (no `<username>` / `<password>` left in it), then trigger a **new deploy** (env changes only apply to new deploys). |
| `invalid_uri` | URL-encode special characters in the password (`@` -> `%40`, `#` -> `%23`, `/` -> `%2F`); no quotes or spaces. |
| `auth_failed` | Atlas > Database Access: check the user/password and that the user has read/write on the database. |
| `network_or_allowlist` | Atlas > Network Access: add `0.0.0.0/0` (Netlify and Render have no fixed IPs). Make sure the cluster is not paused. |
| `dns` | Re-copy the `mongodb+srv://...` string from Atlas > Connect > Drivers. |
| `storage_driver` | Set `STORAGE_DRIVER=mongo` on Netlify. |

Why the frontend said "Cannot reach the community backend": the 503 used to be returned without CORS headers, so the browser hid it. It now includes them (and CORS preflight no longer needs the database), so the real database message reaches the screen.

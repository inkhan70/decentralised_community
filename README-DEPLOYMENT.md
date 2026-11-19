# Decentralized Community Hub — Vercel + Netlify + MongoDB Atlas + Firebase Google Auth

## Architecture

- **Vercel** serves the static frontend in `frontend/`.
- **Netlify Functions** run the Express REST API in `netlify/functions/api.js`.
- **MongoDB Atlas** stores community members, categories, ledger entries, polls, votes and messages.
- **Firebase Authentication** provides Google identity. The browser obtains a Firebase ID token; the Netlify API verifies it with Firebase Admin SDK.
- **Render (separate realtime service)** runs the existing Socket.IO server from `realtime-server.js`. Netlify Functions cannot hold persistent WebSocket connections, so chat/presence/live updates remain on this separate service.

## Important administrator bootstrap security

Do **not** make whichever random Google account signs in first an administrator. Before deploying, set `BOOTSTRAP_ADMIN_EMAIL` to the exact Google email address you control. Only that verified email is eligible for the initial `super_admin` role. A unique MongoDB partial index prevents a second Super Admin. The Super Admin can grant `admin` to other members through the protected API. Do not share your admin Google account.

## 1. MongoDB Atlas

1. Create a free shared cluster at https://www.mongodb.com/atlas.
2. Create a database user with a strong password.
3. In Network Access, allow the outbound network addresses required by Netlify and Render. For initial testing, `0.0.0.0/0` can be used with a strong database password, but restrict it to known outbound IPs or use a private networking plan for production.
4. Copy the Node.js connection string, replace the username/password placeholders, and use database name `community_hub`.
5. Never commit the connection string to GitHub or put it in frontend configuration.

## 2. Firebase Google sign-in

1. Open https://console.firebase.google.com/ and create a Firebase project.
2. Register a Web App in Project settings and copy its web config.
3. Open Authentication → Sign-in method → Google, enable it and save a support email.
4. Open Authentication → Settings → Authorized domains and add your Vercel production domain and any preview domain you actually use.
5. In Project settings → Service accounts, generate a private key for a service account. Keep the JSON private. In Netlify, add the complete JSON as the value of `FIREBASE_SERVICE_ACCOUNT_JSON`. Never place this private key in `frontend/config.js`, Vercel client variables, or GitHub.
6. Set `BOOTSTRAP_ADMIN_EMAIL` to the exact verified Gmail/Google account that should become Super Admin.

## 3. Deploy REST API to Netlify

1. Push this repository to GitHub.
2. In Netlify, Add new site → Import from Git.
3. Use the repository root as the base directory. `netlify.toml` sets `frontend` as the publish directory and `netlify/functions` as the functions directory.
4. Add environment variables in Site configuration → Environment variables:
   - `NODE_ENV=production`
   - `STORAGE_DRIVER=mongo`
   - `MONGO_URI=<Atlas connection string>`
   - `JWT_SECRET=<random secret at least 48 characters>`
   - `ALLOWED_ORIGINS=https://YOUR-VERCEL-DOMAIN.vercel.app`
   - `BOOTSTRAP_ADMIN_EMAIL=<your exact Google email>`
   - `FIREBASE_SERVICE_ACCOUNT_JSON=<complete service account JSON>`
5. Deploy. The API base is `https://YOUR-SITE.netlify.app`; health check is `https://YOUR-SITE.netlify.app/health`.

## 4. Deploy frontend to Vercel

1. Import the same GitHub repository into Vercel.
2. Set Root Directory to `frontend`.
3. Deploy as a static site (no build command required).
4. Edit `frontend/config.js` before deployment:
   - `API_BASE_URL`: your Netlify site URL.
   - `REALTIME_URL`: your Render realtime service URL.
   - `FIREBASE`: values copied from the Firebase Web App config.
5. Add the exact Vercel domain to Firebase Authentication → Authorized domains.

`frontend/config.js` contains only public Firebase web-app configuration. It must never contain the Firebase service-account JSON, MongoDB URI, JWT signing secret, or admin private key.

## 5. Deploy the realtime Socket.IO service to Render

1. Create a Render Web Service from the same GitHub repository.
2. Set Build Command to `npm install` and Start Command to `npm run start:realtime`.
3. Add environment variables:
   - `NODE_ENV=production`
   - `STORAGE_DRIVER=mongo`
   - `MONGO_URI=<same Atlas connection string>`
   - `JWT_SECRET=<EXACT SAME secret as Netlify>`
   - `ALLOWED_ORIGINS=https://YOUR-VERCEL-DOMAIN.vercel.app`
4. Deploy and confirm `/health` returns `{"status":"ok","service":"community-realtime"}`.
5. Copy the Render service URL into `frontend/config.js` as `REALTIME_URL`, then redeploy Vercel.

Render free services may sleep when idle and have ephemeral local disks. MongoDB Atlas is the persistent database. For reliable always-on real-time chat, use a paid always-on Render instance or another persistent WebSocket host.

## 6. First login and category onboarding

1. Open the Vercel website.
2. Click **Continue with Google** and sign in using the exact `BOOTSTRAP_ADMIN_EMAIL` account.
3. That account receives `super_admin` only if the unique Super Admin slot is still empty.
4. Select a category and continue to the dashboard.
5. The first Google login seeds starter categories if the category collection is empty. The Super Admin can add, disable, enable, and archive categories.
6. A member account can only see enabled, non-archived categories during onboarding.

## API routes added

- `POST /api/auth/google` — verify Firebase ID token, create/sync identity and issue application JWT.
- `GET /api/community/categories` — list available categories (admins see archived/disabled too).
- `POST /api/community/onboarding/category` — set member category.
- `GET /api/community/admin/overview` — admin metrics.
- `GET /api/community/admin/members` — admin member list.
- `POST /api/community/admin/categories` — create category.
- `PATCH /api/community/admin/categories/:id` — edit, enable/disable, reorder.
- `DELETE /api/community/admin/categories/:id` — archive category; refuses while active members are assigned.
- `PATCH /api/community/admin/members/:id` — Super Admin only; grant/revoke admin or suspend/restore members.
- `GET /api/community/admin/audit` — recent admin audit trail.

## Local development

- API: `npm install`, configure `.env`, then `npm start`.
- Realtime: in another terminal run `npm run start:realtime`.
- Frontend: serve `frontend/` with any static server and set its `config.js` URLs.

## Production-readiness checklist (must be completed before real society data)

- Run `npm install` and `npm test` after installing dependencies; this source archive was syntax-checked, but a full dependency install and end-to-end cloud deployment were not possible in this environment.
- Configure production domain allowlists, Firebase authorized domains, Atlas network access and backups.
- Rotate secrets after accidental exposure; never commit service-account keys or `.env` files.
- Add a formal data-retention policy, privacy policy, terms, consent, member deletion/export process and abuse reporting.
- Add automated integration tests for Firebase token verification, bootstrap race conditions, category permissions, admin audit events and realtime cross-origin auth.
- Review the legacy ledger and poll permissions before accepting real financial records or conducting binding elections. This release does not constitute a financial-grade accounting or legally binding election system.

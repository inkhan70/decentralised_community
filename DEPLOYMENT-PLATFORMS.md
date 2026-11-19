# Deployment split

| Component | Platform | Project path / command |
|---|---|---|
| Frontend | Vercel | Root Directory `frontend` |
| REST API | Netlify Functions | Repository root; `netlify.toml` |
| Realtime chat/presence | Render Web Service | `npm run start:realtime` |
| Database | MongoDB Atlas | `MONGO_URI` in Netlify + Render |
| Google identity | Firebase Authentication | Firebase Web config in `frontend/config.js`; service account only in Netlify secret |

Netlify Functions are request/response serverless functions and are not the place to host a persistent Socket.IO listener. The dedicated Render process is intentionally retained for WebSocket connections.

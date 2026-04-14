# GPS Tracker (vanilla web)

Two ES-module apps sharing one Firebase project:

| Path | Role |
|------|------|
| `/agent/` | **PWA** — watches GPS, writes latest fix to Realtime Database |
| `/dashboard/` | Map + list — live RTDB subscription (Leaflet) |
| `/shared/firebase.js` | Firebase init, `db`, `auth`, `sendLocation()`, `AGENTS_PATH` |
| `/dashboard/login.html` | Email / password sign-in |
| `/dashboard/bootstrap.js` | Redirects to login if not authenticated; loads `app.js` when signed in |

Root file **`sw.js`** is the **service worker** (scope `/`) so precache can include `/agent/*` and `/shared/firebase.js`.

## Setup

1. Create a Firebase project and enable **Realtime Database** and **Authentication** → **Email/Password** (sign-in method).
2. Create at least one user (Authentication → Users) for dashboard login.
3. Paste your web app keys and **`databaseURL`** into `shared/firebase.js` (see Firebase console → Realtime Database → SDK snippet).
3. Serve the **repository root** over HTTP:

   ```bash
   cd gps-tracker
   python -m http.server 8080
   ```

4. Open `http://localhost:8080/agent/` (allow location). Open `http://localhost:8080/dashboard/` — you are redirected to **`login.html`** until you sign in.

For production, restrict **read** on `agents` to signed-in users, e.g. `".read": "auth != null"`, and tighten **write** rules for your agents as needed.

### Realtime Database rules (dev only)

Example for local testing (lock down before production):

```json
{
  "rules": {
    "agents": {
      "$agentId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

## Project layout

```text
gps-tracker/
├── sw.js
├── README.md
├── agent/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── manifest.json
├── dashboard/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── shared/
    └── firebase.js
```

## Data model (`shared/firebase.js`)

Path prefix: `agents` (`AGENTS_PATH`).

Each agent is one child node:

- `agents/{agentId}/lastUpdate` — timestamp you pass to `sendLocation` (e.g. `Date.now()`)
- `agents/{agentId}/lat` — latitude
- `agents/{agentId}/lng` — longitude

Use `sendLocation(agentId, latitude, longitude, timestamp)` from any module that imports `shared/firebase.js`.

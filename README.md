# S5Y — 3D portfolio + hidden admin dashboard

Portfolio for [instagram.com/s5y](https://instagram.com/s5y): a real-time 3D gallery (three.js: PBR materials, planar floor reflection, soft shadows, ACES tone-mapping, live video textures) backed by a small Node API and a private dashboard for uploading videos per client/workplace page.

## Run locally

```bash
npm install
ADMIN_PASSWORD='your-strong-password' npm start
```

- Site: <http://localhost:3000/>
- Dashboard: <http://localhost:3000/studio-7f3k/> — not linked anywhere on the public site. Change the secret path with `ADMIN_PATH`.

Requires Node >= 22.13 (uses built-in `node:sqlite`, so nothing native to compile).

| Env var | Default | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | `change-me` (warns) | Dashboard login |
| `ADMIN_PATH` | `studio-7f3k` | Secret URL prefix of the dashboard and its API |
| `SESSION_SECRET` | random per start | Set it to keep logins across restarts |
| `PORT` | `3000` | |
| `DATA_DIR` / `UPLOAD_DIR` | `./data`, `./data/uploads` | SQLite DB and uploaded videos |
| `MAX_UPLOAD_MB` | `500` | Per-video limit (mp4 / webm / mov) |

## How it works

1. In the dashboard, create a page per workplace/client, then upload videos to it.
2. `GET /api/portfolio` returns published clients with their videos. The 3D gallery shows one screen per client (first video plays on it); "watch" opens that client's full video grid.

## Data model (`server/db.js`)

`clients` -> `videos` (cascade delete). `plans` and `subscriptions` (client, plan, status, dates, optional `max_videos`) already exist as empty tables so subscription packages can be added later.

## Tests

`npm test` covers auth, upload, validation, and that an uploaded video appears on `/api/portfolio` and is served.

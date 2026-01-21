# Watch-Party by Skye <3

A deployable, ready-to-run webapp for private watch parties:
- **Mobile + Desktop** friendly UI
- Join **private rooms** via **6-character codes**
- **Host screen/tab sharing** (WebRTC) so everyone can watch the host’s browser together
- **Room chat** + reactions
- Invite link copy, fullscreen viewing, participant list

> Note: Screen/tab sharing depends on browser support. Some DRM-protected video sites may appear black when captured.

---

## Quick Start (Local)

1. Install dependencies:

```bash
npm install
```

2. Run:

```bash
npm run dev
```

3. Open:

- http://localhost:3000

---

## Deploy

### Option A: Docker

```bash
docker build -t watch-party-by-skye .
docker run -p 3000:3000 watch-party-by-skye
```

### Option B: Node hosting (Render/Fly/VPS)

- Set `PORT` (optional). Defaults to `3000`.
- Run `npm install` then `npm start`.

---

## How it works

- **Signaling & chat:** Socket.IO rooms
- **Video sharing:** WebRTC peer connections (mesh). Great for small groups.
- **Privacy:** Rooms are not listed publicly; they exist in-memory on the server.

---

## Files

- `server.js` — Express + Socket.IO server (rooms, signaling, chat)
- `public/` — static frontend
  - `index.html` — landing (create/join)
  - `room.html` — room experience
  - `styles.css` — styling
  - `index.js` / `room.js` — frontend logic

---

## Customization

Edit:
- Branding + colors in `public/styles.css`
- App title text in `public/index.html` and `public/room.html`

Have fun ✨

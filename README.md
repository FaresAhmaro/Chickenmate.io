# 🐔 Chicken.io

A real-time multiplayer io-game, wormate.io-style but with chickens. Peck food pellets to grow, avoid running your head into another chicken's body.

**Stack:** Node.js + Express + Socket.io (authoritative server) and vanilla HTML5 Canvas (client). No build step, no framework.

---

## 1. Run it locally

```bash
npm install
npm start
```

Then open **http://localhost:3000** in a couple of browser tabs to test multiplayer with yourself.

---

## 2. Put it on GitHub

```bash
cd chicken-io
git init
git add .
git commit -m "Initial chicken.io"
gh repo create chicken-io --public --source=. --push
# (or create the repo on github.com and follow its "push an existing repo" instructions)
```

---

## 3. Deploy the server (needed for real multiplayer)

GitHub Pages **cannot** run this — it only serves static files, and this game needs a live Node process holding game state and Socket.io connections. Pick any of these free/cheap Node hosts and point them at your GitHub repo:

### Render (easiest, free tier)
1. Go to render.com → **New → Web Service** → connect your GitHub repo.
2. Build command: `npm install`
3. Start command: `npm start`
4. Deploy. Render gives you a URL like `https://chicken-io.onrender.com` — that's your live game.
   (Free tier spins down after inactivity; first load after idle takes ~30s to wake up.)

### Railway
1. railway.app → **New Project → Deploy from GitHub repo**.
2. It auto-detects Node, runs `npm install` / `npm start`. Done.

### Fly.io
1. `fly launch` in the project folder, accept defaults.
2. `fly deploy`.

Any of these serves both the Socket.io backend **and** the static client (from `/public`) from the same URL — you don't need GitHub Pages at all unless you want to split them.

---

## 4. Project structure

```
chicken-io/
├── server.js          # authoritative game loop: movement, collisions, food, leaderboard
├── package.json
└── public/
    ├── index.html      # menu / HUD / death screen markup
    ├── style.css
    └── client.js       # canvas rendering, camera, input, socket events
```

---

## 5. How the game works

- **Server-authoritative**: the server owns all positions, food, and collisions at 30 ticks/sec and broadcasts full state to every client. Clients only send steering angle + boost flag — this prevents cheating and keeps everyone in sync.
- **Movement**: each chicken is a chain of segments; the head is pushed forward each tick along its current angle, which turns smoothly toward the mouse direction (`TURN_RATE` in `server.js`).
- **Growth**: eating a pellet (`GROW_PER_FOOD`) appends segments at the tail; boosting (hold click / Space) burns length back into pellets, mirroring the slither.io/wormate.io risk-reward mechanic.
- **Death**: hitting the world border, or your head touching another chicken's body, kills you and scatters your segments as food.
- **Leaderboard**: top 10 by length, recalculated and broadcast every tick.

---

## 6. Easy things to tweak next

All in `server.js` at the top:
- `WORLD_SIZE` — map size
- `BASE_SPEED` / `BOOST_SPEED` — movement speed
- `FOOD_COUNT` — pellets on the map
- `GROW_PER_FOOD` — growth per pellet
- `CHICKEN_COLORS` — skin palette

Ideas for later: skins/hats, mobile touch controls, minimap, sound effects, spatial-partitioning for collision checks once player counts get large (currently O(n²), fine for casual player counts but worth optimizing before a big launch).

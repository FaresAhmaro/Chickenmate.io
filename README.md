# 🐔 Chicken.io

A real-time multiplayer io-game, wormate.io-style, but you're a chicken running
from farm predators instead of avoiding other players.

**Stack:** Node.js + Express + Socket.io (authoritative server) and vanilla
HTML5 Canvas (client). No build step, no framework, no new dependencies were
added — same `package.json` as before.

---

## 1. Run it locally

```bash
npm install
npm start
```

Open **http://localhost:3000**. Open a couple of tabs to see multiplayer with
yourself, or just play against the bot chickens and predators.

---

## 2. What's new / how it works now

- **You're always the chicken.** Cats, dogs, wolves, and snakes are
  AI-controlled predators. Touch one and you die — there's no other way to
  die except flying into the world border. Chickens (yours, other players',
  or bots) never kill each other by bumping into one another.
- **Chicken is the fastest thing on the map** (`BASE_SPEED` > every predator
  speed in `server.js`), so in open ground you can always outrun them — the
  danger is getting boxed in or not noticing one behind you.
- **Food:** plain corn/seed pellets (small growth), rarer sushi/burgers
  (bigger growth, purely for variety), lightning bolts (temporary speed
  boost), radar dishes (reveals nearby predators on a mini radar for a bit),
  and rare glowing worms (40s invincibility). Only one power-up is ever
  active at a time — grabbing a new one replaces whatever you had, it never
  stacks.
- **Death sequence:** a procedurally-generated squawk (Web Audio API, no
  sound file needed), a screen shake, and a small spirit-chicken that floats
  up and fades before the death screen appears — same as you asked for.
- **Customization:** beak shape, lips, hair, expression, and a cape (all
  drawn with canvas shapes — no emoji anywhere), previewed live in the menu
  and sent to the server so everyone sees your look.
- **Login (optional):** username/password saves your best score across
  sessions. You can also just type a name and hit Play as a guest.
- **Ambient population:** the map is kept stocked with ~55 wandering bot
  chickens and ~24 predators so it never feels empty, styled identically to
  real players (see honest caveat below on the "1000s of bots" ask).

---

## 3. Being straight with you about two asks I scaled back

You deserve the real reasoning, not just quiet substitutions:

- **"1000s of bots":** a single Node process simulating and broadcasting
  full physics for thousands of entities 30x/second, indistinguishably from
  real players, isn't realistic on one server — that's the kind of thing
  actual io-games solve with multiple game-server shards and spatial
  partitioning, not a config number. I set it to ~55 bot chickens + ~24
  predators, which is enough to make the map feel alive. `BOT_CHICKEN_TARGET`
  and `PREDATOR_TARGET` at the top of `server.js` are easy to raise — push
  them up gradually and watch your server's CPU, especially once you also
  add the spatial-partitioning optimization mentioned below.
- **"Login info and data protection":** what's here is *reasonable hobby
  project hygiene* — passwords are salted and hashed (`scrypt`, never stored
  plain), sessions are random tokens in an httpOnly cookie, and scores are
  only ever changed server-side (the client can't fake a score). It is
  **not** a compliance-grade auth system: no email verification, no rate
  limiting on login attempts, no encryption at rest, no real database (it's
  a JSON file at `data/users.json`, gitignored so it never gets pushed to
  GitHub). That's genuinely fine for you and your friends playing a hobby
  project; it's not what you'd want if this ever took real signups at scale.

Neither of these is a "fix it later" hand-wave — they're the actual
appropriate scope for a project at this stage. If it ever gets real traction,
those are the two things to revisit first.

---

## 4. Project structure

```
chicken-io/
├── server.js          # authoritative game loop: chickens, predators, food, powerups, auth
├── package.json
├── data/
│   └── users.json      # created automatically, gitignored (local accounts + hashed passwords)
└── public/
    ├── index.html       # menu, login, customizer, HUD, death screen markup
    ├── style.css
    └── client.js        # canvas rendering, camera/zoom, sound, customization, input
```

---

## 5. Deploying it for real multiplayer

GitHub Pages can't run this (it needs a live Node process for Socket.io and
game state). Any small Node host works:

### Render (free tier)
1. render.com → **New → Web Service** → connect your GitHub repo.
2. Build command: `npm install` · Start command: `npm start`
3. Free tier spins down when idle — first load after a while takes ~30s.

### Railway
railway.app → **New Project → Deploy from GitHub repo** — auto-detects Node.

### Fly.io
`fly launch` then `fly deploy` in the project folder.

**Note on `data/users.json`:** on most free hosts the filesystem is
ephemeral (wiped on redeploy/restart), so accounts won't survive long-term
on a free tier. Fine for testing; if you want accounts to actually persist,
swap the JSON file for a real database (even a free-tier Postgres/SQLite
works) — the `loadUsers`/`saveUsers` functions in `server.js` are the only
two places that would need to change.

---

## 6. Easy things to tweak

All at the top of `server.js`:
- `WORLD_SIZE`, `BASE_SPEED` / `BOOST_SPEED`, predator speeds in `PREDATOR_SPEED`
- `FOOD_TARGET`, `SPECIAL_FOOD_TARGET`, `POWER_FOOD_TARGET`, `RARE_WORM_TARGET`
- `SPEED_POWER_MS`, `RADAR_POWER_MS`, `INVINCIBLE_MS`
- `BOT_CHICKEN_TARGET`, `PREDATOR_TARGET`
- `FACE_OPTIONS` / `FLAG_OPTIONS` if you want to add more customization choices

**Next optimization to make before a big launch:** collisions are currently
O(n²) (every chicken checked against every food/predator each tick) — fine
at this scale, but worth switching to a spatial grid/quadtree before you
push player or bot counts much higher.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================================
// Very small file-backed "database" + session store.
// This is fine for a hobby / small-scale project, but it is NOT a
// substitute for a real database + real auth infra if this ever gets
// real traffic. Passwords are salted+hashed (scrypt), never stored
// plain, and scores only ever change on the server, but there's no
// encryption at rest, rate limiting, email verification, GDPR tooling,
// etc. Treat "data protection" here as "reasonable hobby-project
// hygiene", not a compliance guarantee.
// =====================================================================
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

const sessions = new Map(); // token -> username

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((c) => {
    const idx = c.indexOf('=');
    if (idx === -1) return;
    out[c.slice(0, idx).trim()] = decodeURIComponent(c.slice(idx + 1).trim());
  });
  return out;
}
function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.sid;
  if (!token) return null;
  return sessions.get(token) || null;
}

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Username needs 3+ chars, password needs 4+ chars.' });
  }
  if (username.length > 20 || !/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Username: letters, numbers, underscore only (max 20).' });
  }
  const users = loadUsers();
  const key = username.toLowerCase();
  if (users[key]) return res.status(409).json({ error: 'That username is taken.' });
  const salt = crypto.randomBytes(16).toString('hex');
  users[key] = { username, salt, hash: hashPassword(password, salt), highScore: 0, createdAt: Date.now() };
  saveUsers(users);
  const token = makeToken();
  sessions.set(token, key);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
  res.json({ username, highScore: 0 });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const users = loadUsers();
  const key = (username || '').toLowerCase();
  const user = users[key];
  if (!user || hashPassword(password || '', user.salt) !== user.hash) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  const token = makeToken();
  sessions.set(token, key);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
  res.json({ username: user.username, highScore: user.highScore });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.sid) sessions.delete(cookies.sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const key = getSessionUser(req);
  if (!key) return res.json({ loggedIn: false });
  const users = loadUsers();
  const user = users[key];
  if (!user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, username: user.username, highScore: user.highScore });
});

function recordScoreIfHigher(usernameKey, score) {
  if (!usernameKey) return;
  const users = loadUsers();
  const user = users[usernameKey];
  if (!user) return;
  if (score > user.highScore) {
    user.highScore = score;
    saveUsers(users);
  }
}

// =====================================================================
// Game config
// =====================================================================
const WORLD_SIZE = 4200;
const FOOD_TARGET = 550;          // common food pellets kept on the map
const SPECIAL_FOOD_TARGET = 18;   // sushi/burger (bigger, cosmetic-varied) food
const POWER_FOOD_TARGET = 6;      // speed + radar food combined
const RARE_WORM_TARGET = 2;       // invincibility worms, always rare

const TICK_RATE = 30;
const BASE_SPEED = 3.4;           // chicken base speed - fastest thing on the map
const BOOST_SPEED = 5.8;
const POWER_SPEED_MULT = 1.55;    // "speed" food multiplier
const TURN_RATE = 0.19;
const SEGMENT_SPACING = 10;
const START_LENGTH = 8;
const FOOD_RADIUS = 6;
const SPECIAL_FOOD_RADIUS = 9;
const POWER_FOOD_RADIUS = 8;
const HEAD_RADIUS = 12;
const SEGMENT_RADIUS = 10;
const GROW_PER_FOOD = 2;
const GROW_PER_SPECIAL_FOOD = 5;
const BOOST_DRAIN_EVERY = 8;

const SPEED_POWER_MS = 8000;
const RADAR_POWER_MS = 10000;
const INVINCIBLE_MS = 40000;

const BOT_CHICKEN_TARGET = 55;     // ambient "population" - see README for why this isn't literally 1000s
const PREDATOR_TARGET = 24;

const CHICKEN_COLORS = ['#FFFFFF', '#F4E04D', '#D2691E', '#8B4513', '#3B3B3B', '#FFD1DC', '#C9C9C9', '#FF8C00'];
const FOOD_KINDS = ['corn', 'seed'];
const SPECIAL_FOOD_KINDS = ['sushi', 'burger'];
const PREDATOR_TYPES = ['cat', 'dog', 'wolf', 'snake'];
const PREDATOR_SPEED = { cat: 2.6, dog: 2.8, wolf: 3.0, snake: 2.4 };
const PREDATOR_DETECT_RADIUS = 420;
const PREDATOR_GIVEUP_RADIUS = 700;

const FACE_OPTIONS = {
  nose: ['classic', 'button', 'long', 'stub'],
  lips: ['none', 'grin', 'smirk', 'pucker'],
  hair: ['none', 'mohawk', 'quiff', 'curl'],
  smile: ['neutral', 'happy', 'sly', 'derp']
};
const FLAG_OPTIONS = ['none', 'cape-red', 'cape-blue', 'cape-gold', 'cape-stripes'];

function rand(min, max) { return Math.random() * (max - min) + min; }
function dist2(x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy; }
function pick(arr) { return arr[Math.floor(rand(0, arr.length))]; }
function clampAppearance(app) {
  app = app || {};
  return {
    nose: FACE_OPTIONS.nose.includes(app.nose) ? app.nose : 'classic',
    lips: FACE_OPTIONS.lips.includes(app.lips) ? app.lips : 'none',
    hair: FACE_OPTIONS.hair.includes(app.hair) ? app.hair : 'none',
    smile: FACE_OPTIONS.smile.includes(app.smile) ? app.smile : 'happy',
    flag: FLAG_OPTIONS.includes(app.flag) ? app.flag : 'none'
  };
}

// =====================================================================
// Game state
// =====================================================================
const players = {};   // socket.id -> player  (real connected players AND bot chickens)
const predators = {}; // id -> predator
let food = [];         // common
let specialFood = [];  // sushi / burger
let powerFood = [];    // speed / radar
let rareWorms = [];    // invincibility

function spawnFood(list, n, kinds, extra = {}) {
  for (let i = 0; i < n; i++) {
    list.push({
      id: crypto.randomBytes(6).toString('hex'),
      x: rand(0, WORLD_SIZE),
      y: rand(0, WORLD_SIZE),
      kind: pick(kinds),
      ...extra
    });
  }
}
function topUpFood() {
  if (food.length < FOOD_TARGET) spawnFood(food, FOOD_TARGET - food.length, FOOD_KINDS, { type: 'common' });
  if (specialFood.length < SPECIAL_FOOD_TARGET) spawnFood(specialFood, SPECIAL_FOOD_TARGET - specialFood.length, SPECIAL_FOOD_KINDS, { type: 'special' });
  if (powerFood.length < POWER_FOOD_TARGET) spawnFood(powerFood, POWER_FOOD_TARGET - powerFood.length, ['speed', 'radar'], { type: 'power' });
  if (rareWorms.length < RARE_WORM_TARGET) spawnFood(rareWorms, RARE_WORM_TARGET - rareWorms.length, ['worm'], { type: 'worm' });
}
topUpFood();

function newPlayer(id, name, appearance, isBot, userKey) {
  const x = rand(WORLD_SIZE * 0.2, WORLD_SIZE * 0.8);
  const y = rand(WORLD_SIZE * 0.2, WORLD_SIZE * 0.8);
  const angle = rand(0, Math.PI * 2);
  const segments = [];
  for (let i = 0; i < START_LENGTH; i++) {
    segments.push({ x: x - Math.cos(angle) * i * SEGMENT_SPACING, y: y - Math.sin(angle) * i * SEGMENT_SPACING });
  }
  return {
    id,
    name: (name || 'Chicken').slice(0, 16),
    color: pick(CHICKEN_COLORS),
    appearance: clampAppearance(appearance),
    angle, targetAngle: angle,
    speed: BASE_SPEED,
    boosting: false,
    boostTick: 0,
    segments,
    alive: true,
    score: START_LENGTH,
    isBot: !!isBot,
    userKey: userKey || null,
    power: { type: null, expiresAt: 0 },
    botState: isBot ? { wanderTarget: null } : null
  };
}

function newPredator(id) {
  const type = pick(PREDATOR_TYPES);
  return {
    id,
    type,
    x: rand(0, WORLD_SIZE),
    y: rand(0, WORLD_SIZE),
    angle: rand(0, Math.PI * 2),
    speed: PREDATOR_SPEED[type],
    state: 'wander',
    wanderTarget: null,
    targetPlayerId: null
  };
}

function ensureBotsAndPredators() {
  const botCount = Object.values(players).filter((p) => p.isBot).length;
  for (let i = botCount; i < BOT_CHICKEN_TARGET; i++) {
    const id = 'bot_' + crypto.randomBytes(6).toString('hex');
    players[id] = newPlayer(id, botChickenName(), randomAppearance(), true, null);
  }
  const predCount = Object.keys(predators).length;
  for (let i = predCount; i < PREDATOR_TARGET; i++) {
    const id = 'pred_' + crypto.randomBytes(6).toString('hex');
    predators[id] = newPredator(id);
  }
}
const BOT_NAME_PARTS = ['Nugget', 'Clucky', 'Pecky', 'Henrietta', 'Drumstick', 'Feather', 'Yolko', 'Cluck', 'Biscuit', 'Wingman', 'Roo', 'Eggbert'];
function botChickenName() { return pick(BOT_NAME_PARTS) + Math.floor(rand(10, 99)); }
function randomAppearance() {
  return {
    nose: pick(FACE_OPTIONS.nose),
    lips: pick(FACE_OPTIONS.lips),
    hair: pick(FACE_OPTIONS.hair),
    smile: pick(FACE_OPTIONS.smile),
    flag: pick(FLAG_OPTIONS)
  };
}
ensureBotsAndPredators();

io.on('connection', (socket) => {
  const userKey = getSessionUser(socket.request);

  socket.on('join', (payload) => {
    const name = typeof payload === 'string' ? payload : payload && payload.name;
    const appearance = typeof payload === 'object' ? payload.appearance : null;
    players[socket.id] = newPlayer(socket.id, name, appearance, false, userKey);
  });

  socket.on('input', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    if (typeof data.angle === 'number' && !Number.isNaN(data.angle)) p.targetAngle = data.angle;
    p.boosting = !!data.boosting;
  });

  socket.on('respawn', (payload) => {
    const name = typeof payload === 'string' ? payload : payload && payload.name;
    const appearance = typeof payload === 'object' ? payload.appearance : null;
    players[socket.id] = newPlayer(socket.id, name, appearance, false, userKey);
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function steerToward(p, tx, ty) {
  p.targetAngle = Math.atan2(ty - p.y, tx - p.x);
}

function updateBotChicken(p) {
  // Flee nearest predator if close, else wander toward food
  let nearestPredDist2 = Infinity, nearestPred = null;
  for (const key in predators) {
    const pr = predators[key];
    const d2 = dist2(p.segments[0].x, p.segments[0].y, pr.x, pr.y);
    if (d2 < nearestPredDist2) { nearestPredDist2 = d2; nearestPred = pr; }
  }
  if (nearestPred && nearestPredDist2 < PREDATOR_DETECT_RADIUS * PREDATOR_DETECT_RADIUS) {
    const head = p.segments[0];
    const fleeAngle = Math.atan2(head.y - nearestPred.y, head.x - nearestPred.x);
    p.targetAngle = fleeAngle;
    return;
  }
  if (!p.botState.wanderTarget || dist2(p.segments[0].x, p.segments[0].y, p.botState.wanderTarget.x, p.botState.wanderTarget.y) < 4000) {
    p.botState.wanderTarget = { x: rand(200, WORLD_SIZE - 200), y: rand(200, WORLD_SIZE - 200) };
  }
  steerToward(p, p.botState.wanderTarget.x, p.botState.wanderTarget.y);
}

function updatePredator(pr) {
  // Look for a nearby, non-invincible chicken to chase
  if (pr.state === 'chase') {
    const target = players[pr.targetPlayerId];
    if (!target || !target.alive || target.power.type === 'invincible') {
      pr.state = 'wander'; pr.targetPlayerId = null;
    } else {
      const d2 = dist2(pr.x, pr.y, target.segments[0].x, target.segments[0].y);
      if (d2 > PREDATOR_GIVEUP_RADIUS * PREDATOR_GIVEUP_RADIUS) {
        pr.state = 'wander'; pr.targetPlayerId = null;
      } else {
        steerToward(pr, target.segments[0].x, target.segments[0].y);
      }
    }
  }
  if (pr.state === 'wander') {
    let best = null, bestD2 = PREDATOR_DETECT_RADIUS * PREDATOR_DETECT_RADIUS;
    for (const id in players) {
      const p = players[id];
      if (!p.alive || p.power.type === 'invincible') continue;
      const d2 = dist2(pr.x, pr.y, p.segments[0].x, p.segments[0].y);
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    if (best) { pr.state = 'chase'; pr.targetPlayerId = best.id; }
    else {
      if (!pr.wanderTarget || dist2(pr.x, pr.y, pr.wanderTarget.x, pr.wanderTarget.y) < 4000) {
        pr.wanderTarget = { x: rand(100, WORLD_SIZE - 100), y: rand(100, WORLD_SIZE - 100) };
      }
      steerToward(pr, pr.wanderTarget.x, pr.wanderTarget.y);
    }
  }

  const diff = angleDiff(pr.angle, pr.targetAngle || pr.angle);
  const clamped = Math.max(-0.14, Math.min(0.14, diff));
  pr.angle += clamped;
  let nx = pr.x + Math.cos(pr.angle) * pr.speed;
  let ny = pr.y + Math.sin(pr.angle) * pr.speed;
  nx = Math.max(20, Math.min(WORLD_SIZE - 20, nx));
  ny = Math.max(20, Math.min(WORLD_SIZE - 20, ny));
  pr.x = nx; pr.y = ny;
}

function tick() {
  ensureBotsAndPredators();
  const now = Date.now();
  const ids = Object.keys(players);

  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;
    if (p.isBot) updateBotChicken(p);

    // expire power
    if (p.power.type && now > p.power.expiresAt) p.power.type = null;

    const diff = angleDiff(p.angle, p.targetAngle);
    const clamped = Math.max(-TURN_RATE, Math.min(TURN_RATE, diff));
    p.angle += clamped;

    const canBoost = p.boosting && p.segments.length > START_LENGTH;
    let speed = canBoost ? BOOST_SPEED : BASE_SPEED;
    if (p.power.type === 'speed') speed *= POWER_SPEED_MULT;
    p.speed = speed;

    if (canBoost) {
      p.boostTick++;
      if (p.boostTick >= BOOST_DRAIN_EVERY) {
        p.boostTick = 0;
        if (p.segments.length > START_LENGTH) {
          p.segments.pop();
          spawnFood(food, 1, FOOD_KINDS, { type: 'common' });
        }
      }
    }

    const head = p.segments[0];
    const nx = head.x + Math.cos(p.angle) * p.speed;
    const ny = head.y + Math.sin(p.angle) * p.speed;

    if (nx < 0 || nx > WORLD_SIZE || ny < 0 || ny > WORLD_SIZE) {
      killPlayer(p, null);
      continue;
    }
    p.segments.unshift({ x: nx, y: ny });
    p.segments.pop();
  }

  for (const key in predators) updatePredator(predators[key]);

  // Food collisions
  for (const id of ids) {
    const p = players[id];
    if (!p || !p.alive) continue;
    const head = p.segments[0];

    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i];
      if (dist2(head.x, head.y, f.x, f.y) < (HEAD_RADIUS + FOOD_RADIUS) ** 2) {
        food.splice(i, 1);
        growPlayer(p, GROW_PER_FOOD);
      }
    }
    for (let i = specialFood.length - 1; i >= 0; i--) {
      const f = specialFood[i];
      if (dist2(head.x, head.y, f.x, f.y) < (HEAD_RADIUS + SPECIAL_FOOD_RADIUS) ** 2) {
        specialFood.splice(i, 1);
        growPlayer(p, GROW_PER_SPECIAL_FOOD);
      }
    }
    for (let i = powerFood.length - 1; i >= 0; i--) {
      const f = powerFood[i];
      if (dist2(head.x, head.y, f.x, f.y) < (HEAD_RADIUS + POWER_FOOD_RADIUS) ** 2) {
        powerFood.splice(i, 1);
        growPlayer(p, 1);
        // no doubling: a new power effect always replaces whatever is active
        p.power = { type: f.kind, expiresAt: now + (f.kind === 'speed' ? SPEED_POWER_MS : RADAR_POWER_MS) };
      }
    }
    for (let i = rareWorms.length - 1; i >= 0; i--) {
      const f = rareWorms[i];
      if (dist2(head.x, head.y, f.x, f.y) < (HEAD_RADIUS + POWER_FOOD_RADIUS) ** 2) {
        rareWorms.splice(i, 1);
        growPlayer(p, 3);
        p.power = { type: 'invincible', expiresAt: now + INVINCIBLE_MS };
      }
    }
  }
  topUpFood();

  // Predator vs chicken
  for (const id of ids) {
    const p = players[id];
    if (!p || !p.alive || p.power.type === 'invincible') continue;
    const head = p.segments[0];
    for (const key in predators) {
      const pr = predators[key];
      if (dist2(head.x, head.y, pr.x, pr.y) < (HEAD_RADIUS + 13) ** 2) {
        killPlayer(p, pr.type);
        break;
      }
    }
  }

  broadcast();
}

function growPlayer(p, amount) {
  for (let g = 0; g < amount; g++) {
    const tail = p.segments[p.segments.length - 1];
    p.segments.push({ x: tail.x, y: tail.y });
  }
  p.score = p.segments.length;
}

function killPlayer(p, killedBy) {
  if (!p.alive) return;
  p.alive = false;
  for (let i = 0; i < p.segments.length; i += 2) {
    food.push({ id: crypto.randomBytes(6).toString('hex'), x: p.segments[i].x + rand(-10, 10), y: p.segments[i].y + rand(-10, 10), kind: pick(FOOD_KINDS), type: 'common' });
  }
  if (p.userKey) recordScoreIfHigher(p.userKey, p.score);
  if (!p.isBot) io.to(p.id).emit('dead', { score: p.score, killedBy });
  if (p.isBot) delete players[p.id]; // bots just get replaced by ensureBotsAndPredators()
}

function broadcast() {
  const ids = Object.keys(players);
  const alivePlayers = ids.filter((id) => players[id].alive);

  const state = {
    world: WORLD_SIZE,
    players: alivePlayers.map((id) => {
      const p = players[id];
      return {
        id, name: p.name, color: p.color, appearance: p.appearance,
        segments: p.segments, score: p.score, power: p.power.type
      };
    }),
    predators: Object.values(predators).map((pr) => ({ id: pr.id, type: pr.type, x: pr.x, y: pr.y, angle: pr.angle })),
    food, specialFood, powerFood, rareWorms,
    leaderboard: alivePlayers
      .sort((a, b) => players[b].score - players[a].score)
      .slice(0, 10)
      .map((id) => ({ name: players[id].name, score: players[id].score, isBot: players[id].isBot }))
  };
  io.emit('state', state);
}

setInterval(tick, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chicken.io server running on port ${PORT}`));

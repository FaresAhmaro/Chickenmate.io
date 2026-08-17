const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ----- Game config -----
const WORLD_SIZE = 3000;          // world is WORLD_SIZE x WORLD_SIZE
const FOOD_COUNT = 400;           // pellets kept on the map at all times
const TICK_RATE = 30;             // server ticks per second
const BASE_SPEED = 3.2;           // px per tick
const BOOST_SPEED = 5.5;
const TURN_RATE = 0.18;           // max radians the head can turn per tick
const SEGMENT_SPACING = 10;       // px between body segments
const START_LENGTH = 8;           // starting number of segments
const FOOD_RADIUS = 6;
const HEAD_RADIUS = 12;
const SEGMENT_RADIUS = 10;
const GROW_PER_FOOD = 2;          // segments added per pellet eaten
const BOOST_DRAIN_EVERY = 8;      // ticks between losing a segment while boosting

const CHICKEN_COLORS = [
  '#FFFFFF', '#F4E04D', '#D2691E', '#8B4513',
  '#000000', '#FFD1DC', '#C0C0C0', '#FF8C00'
];

function rand(min, max) { return Math.random() * (max - min) + min; }
function dist2(x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy; }

// ----- Game state -----
const players = {};   // socket.id -> player object
let food = [];

function spawnFood(n) {
  for (let i = 0; i < n; i++) {
    food.push({
      id: Math.random().toString(36).slice(2),
      x: rand(0, WORLD_SIZE),
      y: rand(0, WORLD_SIZE),
      color: CHICKEN_COLORS[Math.floor(rand(0, CHICKEN_COLORS.length))]
    });
  }
}
spawnFood(FOOD_COUNT);

function newPlayer(id, name) {
  const x = rand(WORLD_SIZE * 0.25, WORLD_SIZE * 0.75);
  const y = rand(WORLD_SIZE * 0.25, WORLD_SIZE * 0.75);
  const angle = rand(0, Math.PI * 2);
  const segments = [];
  for (let i = 0; i < START_LENGTH; i++) {
    segments.push({ x: x - Math.cos(angle) * i * SEGMENT_SPACING, y: y - Math.sin(angle) * i * SEGMENT_SPACING });
  }
  return {
    id,
    name: (name || 'Chicken').slice(0, 16),
    color: CHICKEN_COLORS[Math.floor(rand(0, CHICKEN_COLORS.length))],
    angle,
    targetAngle: angle,
    speed: BASE_SPEED,
    boosting: false,
    boostTick: 0,
    segments,
    alive: true,
    score: START_LENGTH
  };
}

io.on('connection', (socket) => {
  socket.on('join', (name) => {
    players[socket.id] = newPlayer(socket.id, name);
  });

  socket.on('input', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    if (typeof data.angle === 'number' && !Number.isNaN(data.angle)) {
      p.targetAngle = data.angle;
    }
    p.boosting = !!data.boosting;
  });

  socket.on('respawn', (name) => {
    players[socket.id] = newPlayer(socket.id, name);
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

function tick() {
  const ids = Object.keys(players);

  // Move
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;

    const diff = angleDiff(p.angle, p.targetAngle);
    const clamped = Math.max(-TURN_RATE, Math.min(TURN_RATE, diff));
    p.angle += clamped;

    const canBoost = p.boosting && p.segments.length > START_LENGTH;
    p.speed = canBoost ? BOOST_SPEED : BASE_SPEED;

    if (canBoost) {
      p.boostTick++;
      if (p.boostTick >= BOOST_DRAIN_EVERY) {
        p.boostTick = 0;
        if (p.segments.length > START_LENGTH) {
          p.segments.pop();
          spawnFood(1);
        }
      }
    }

    const head = p.segments[0];
    const nx = head.x + Math.cos(p.angle) * p.speed;
    const ny = head.y + Math.sin(p.angle) * p.speed;

    // World boundary = death
    if (nx < 0 || nx > WORLD_SIZE || ny < 0 || ny > WORLD_SIZE) {
      killPlayer(p);
      continue;
    }

    // Move forward: add new head, drop tail (length only changes when food/boost explicitly add/remove segments)
    p.segments.unshift({ x: nx, y: ny });
    p.segments.pop();
  }

  // Food collisions
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;
    const head = p.segments[0];
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i];
      if (dist2(head.x, head.y, f.x, f.y) < (HEAD_RADIUS + FOOD_RADIUS) ** 2) {
        food.splice(i, 1);
        for (let g = 0; g < GROW_PER_FOOD; g++) {
          const tail = p.segments[p.segments.length - 1];
          p.segments.push({ x: tail.x, y: tail.y });
        }
        p.score = p.segments.length;
        spawnFood(1);
      }
    }
  }

  // Player-vs-player collisions (head hits any other body segment)
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;
    const head = p.segments[0];
    for (const otherId of ids) {
      const o = players[otherId];
      if (!o.alive) continue;
      const startIdx = otherId === id ? 6 : 0; // avoid instant self-collision near head
      for (let i = startIdx; i < o.segments.length; i++) {
        const s = o.segments[i];
        if (dist2(head.x, head.y, s.x, s.y) < (HEAD_RADIUS + SEGMENT_RADIUS) ** 2) {
          killPlayer(p);
          break;
        }
      }
      if (!p.alive) break;
    }
  }

  broadcast();
}

function killPlayer(p) {
  if (!p.alive) return;
  p.alive = false;
  // turn body into food
  for (let i = 0; i < p.segments.length; i += 2) {
    food.push({
      id: Math.random().toString(36).slice(2),
      x: p.segments[i].x + rand(-10, 10),
      y: p.segments[i].y + rand(-10, 10),
      color: p.color
    });
  }
  io.to(p.id).emit('dead', { score: p.score });
}

function broadcast() {
  const ids = Object.keys(players);
  const state = {
    world: WORLD_SIZE,
    players: ids.map((id) => {
      const p = players[id];
      return {
        id,
        name: p.name,
        color: p.color,
        alive: p.alive,
        segments: p.segments,
        score: p.score
      };
    }),
    food,
    leaderboard: ids
      .filter((id) => players[id].alive)
      .sort((a, b) => players[b].score - players[a].score)
      .slice(0, 10)
      .map((id) => ({ name: players[id].name, score: players[id].score }))
  };
  io.emit('state', state);
}

setInterval(tick, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chicken.io server running on port ${PORT}`));

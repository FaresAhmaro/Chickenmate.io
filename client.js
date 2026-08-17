const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W, H;
function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

const socket = io();

const menu = document.getElementById('menu');
const deathScreen = document.getElementById('death-screen');
const nameInput = document.getElementById('name-input');
const playBtn = document.getElementById('play-btn');
const respawnBtn = document.getElementById('respawn-btn');
const finalScoreEl = document.getElementById('final-score');
const scoreEl = document.getElementById('score');
const leaderboardList = document.getElementById('leaderboard-list');

let latestState = null;
let myId = null;
let mouse = { x: 0, y: 0 };
let boosting = false;
let playing = false;

playBtn.addEventListener('click', () => {
  socket.emit('join', nameInput.value || 'Chicken');
  menu.classList.add('hidden');
  playing = true;
});

respawnBtn.addEventListener('click', () => {
  socket.emit('respawn', nameInput.value || 'Chicken');
  deathScreen.classList.add('hidden');
  playing = true;
});

canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', () => { boosting = true; });
canvas.addEventListener('mouseup', () => { boosting = false; });
window.addEventListener('keydown', (e) => { if (e.code === 'Space') boosting = true; });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') boosting = false; });

socket.on('connect', () => { myId = socket.id; });

socket.on('state', (state) => {
  latestState = state;
  updateLeaderboard(state.leaderboard);
  const me = state.players.find((p) => p.id === myId);
  if (me) scoreEl.textContent = `Length: ${me.score}`;
});

socket.on('dead', ({ score }) => {
  playing = false;
  finalScoreEl.textContent = `Final length: ${score}`;
  deathScreen.classList.remove('hidden');
});

function updateLeaderboard(list) {
  leaderboardList.innerHTML = '';
  list.forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.name} — ${entry.score}`;
    leaderboardList.appendChild(li);
  });
}

// Send steering input at a steady rate
setInterval(() => {
  if (!playing || !latestState) return;
  const me = latestState.players.find((p) => p.id === myId);
  if (!me) return;
  const head = me.segments[0];
  const cam = getCamera();
  const worldMouseX = mouse.x - W / 2 + cam.x;
  const worldMouseY = mouse.y - H / 2 + cam.y;
  const angle = Math.atan2(worldMouseY - head.y, worldMouseX - head.x);
  socket.emit('input', { angle, boosting });
}, 1000 / 30);

function getCamera() {
  if (!latestState) return { x: 0, y: 0 };
  const me = latestState.players.find((p) => p.id === myId);
  if (!me) return { x: latestState.world / 2, y: latestState.world / 2 };
  return { x: me.segments[0].x, y: me.segments[0].y };
}

function drawChicken(p, cam, isMe) {
  const segs = p.segments;
  // body segments (rounded, chicken-white with slight shading), skip drawing every point for perf
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    const sx = s.x - cam.x + W / 2;
    const sy = s.y - cam.y + H / 2;
    if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
    const r = i === 0 ? 12 : Math.max(6, 10 - i * 0.02);
    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    if (i % 6 === 0 && i !== 0) {
      // little wing flick
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, r * 0.7, r * 0.4, Math.sin(Date.now() / 200 + i) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // head extras: beak, comb, eye
  const head = segs[0];
  const hx = head.x - cam.x + W / 2;
  const hy = head.y - cam.y + H / 2;
  let angle = 0;
  if (segs.length > 1) {
    angle = Math.atan2(head.y - segs[1].y, head.x - segs[1].x);
  }

  // comb (red)
  ctx.fillStyle = '#e63946';
  ctx.beginPath();
  ctx.arc(hx - Math.cos(angle) * 4, hy - Math.sin(angle) * 4 - 10, 4, 0, Math.PI * 2);
  ctx.fill();

  // beak (orange triangle)
  ctx.fillStyle = '#f4a300';
  ctx.beginPath();
  const bx = hx + Math.cos(angle) * 14;
  const by = hy + Math.sin(angle) * 14;
  const perp = angle + Math.PI / 2;
  ctx.moveTo(bx, by);
  ctx.lineTo(hx + Math.cos(angle) * 8 + Math.cos(perp) * 4, hy + Math.sin(angle) * 8 + Math.sin(perp) * 4);
  ctx.lineTo(hx + Math.cos(angle) * 8 - Math.cos(perp) * 4, hy + Math.sin(angle) * 8 - Math.sin(perp) * 4);
  ctx.closePath();
  ctx.fill();

  // eye
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(hx + Math.cos(perp) * 5, hy + Math.sin(perp) * 5, 2, 0, Math.PI * 2);
  ctx.fill();

  // name tag
  ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.85)';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(p.name, hx, hy - 22);
}

function drawFood(f, cam) {
  const fx = f.x - cam.x + W / 2;
  const fy = f.y - cam.y + H / 2;
  if (fx < -20 || fx > W + 20 || fy < -20 || fy > H + 20) return;
  ctx.beginPath();
  ctx.fillStyle = f.color;
  ctx.arc(fx, fy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.stroke();
}

function drawGrid(cam, worldSize) {
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 1;
  const spacing = 60;
  const offsetX = ((W / 2 - cam.x) % spacing + spacing) % spacing;
  const offsetY = ((H / 2 - cam.y) % spacing + spacing) % spacing;
  for (let x = offsetX; x < W; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = offsetY; y < H; y += spacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // world border
  const left = -cam.x + W / 2;
  const top = -cam.y + H / 2;
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = 4;
  ctx.strokeRect(left, top, worldSize, worldSize);
}

function render() {
  ctx.clearRect(0, 0, W, H);
  if (latestState) {
    const cam = getCamera();
    drawGrid(cam, latestState.world);
    latestState.food.forEach((f) => drawFood(f, cam));
    latestState.players.forEach((p) => {
      if (!p.alive) return;
      drawChicken(p, cam, p.id === myId);
    });
  }
  requestAnimationFrame(render);
}
render();

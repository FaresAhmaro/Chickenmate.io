const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W, H, DPR;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const socket = io();

// ---------- DOM ----------
const menu = document.getElementById('menu');
const deathScreen = document.getElementById('death-screen');
const nameInput = document.getElementById('name-input');
const playBtn = document.getElementById('play-btn');
const respawnBtn = document.getElementById('respawn-btn');
const finalScoreEl = document.getElementById('final-score');
const killedByEl = document.getElementById('killed-by');
const scoreEl = document.getElementById('score');
const leaderboardList = document.getElementById('leaderboard-list');
const powerBadge = document.getElementById('power-badge');
const radarWrap = document.getElementById('radar');
const radarCanvas = document.getElementById('radar-canvas');
const radarCtx = radarCanvas.getContext('2d');

const authForm = document.getElementById('auth-form');
const authUser = document.getElementById('auth-username');
const authPass = document.getElementById('auth-password');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const authStatus = document.getElementById('auth-status');
const accountBar = document.getElementById('account-bar');
const accountName = document.getElementById('account-name');
const accountHigh = document.getElementById('account-high');
const logoutBtn = document.getElementById('logout-btn');

const custPreview = document.getElementById('cust-preview');
const custPreviewCtx = custPreview.getContext('2d');

// ---------- Account state ----------
let account = null; // { username, highScore } or null (guest)

async function refreshAccount() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.loggedIn) {
      account = { username: data.username, highScore: data.highScore };
      showAccountBar();
    } else {
      account = null;
      hideAccountBar();
    }
  } catch (e) { /* offline / no server auth available - guest play still works */ }
}
function showAccountBar() {
  accountBar.classList.remove('hidden');
  authForm.classList.add('hidden');
  accountName.textContent = account.username;
  accountHigh.textContent = account.highScore;
  nameInput.value = account.username;
}
function hideAccountBar() {
  accountBar.classList.add('hidden');
  authForm.classList.remove('hidden');
}
async function authRequest(url) {
  authStatus.textContent = '';
  const username = authUser.value.trim();
  const password = authPass.value;
  if (!username || !password) { authStatus.textContent = 'Enter a username and password.'; return; }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { authStatus.textContent = data.error || 'Something went wrong.'; return; }
    account = { username: data.username, highScore: data.highScore };
    showAccountBar();
    // The server only reads the login cookie once, when the socket first
    // connects - reconnect now so this session actually gets tied to the
    // account (only safe to do this while still on the menu, not mid-run).
    if (!playing) { socket.disconnect(); socket.connect(); }
  } catch (e) {
    authStatus.textContent = 'Could not reach the server.';
  }
}
loginBtn.addEventListener('click', () => authRequest('/api/login'));
registerBtn.addEventListener('click', () => authRequest('/api/register'));
logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  account = null;
  hideAccountBar();
  if (!playing) { socket.disconnect(); socket.connect(); }
});
refreshAccount();

// ---------- Appearance customization (no emoji - all vector shapes) ----------
const FACE_OPTIONS = {
  nose: ['classic', 'button', 'long', 'stub'],
  lips: ['none', 'grin', 'smirk', 'pucker'],
  hair: ['none', 'mohawk', 'quiff', 'curl'],
  smile: ['neutral', 'happy', 'sly', 'derp']
};
const FLAG_OPTIONS = ['none', 'cape-red', 'cape-blue', 'cape-gold', 'cape-stripes'];

let appearance = { nose: 'classic', lips: 'none', hair: 'none', smile: 'happy', flag: 'none' };
const savedAppearance = localStorage.getItem('chickenAppearance');
if (savedAppearance) { try { appearance = JSON.parse(savedAppearance); } catch (e) {} }

function cycle(list, current, dir) {
  const i = list.indexOf(current);
  return list[(i + dir + list.length) % list.length];
}
document.querySelectorAll('.cust-row').forEach((row) => {
  const trait = row.dataset.trait;
  const options = trait === 'flag' ? FLAG_OPTIONS : FACE_OPTIONS[trait];
  row.querySelector('.next').addEventListener('click', () => {
    appearance[trait] = cycle(options, appearance[trait], 1);
    saveAppearance();
  });
  row.querySelector('.prev').addEventListener('click', () => {
    appearance[trait] = cycle(options, appearance[trait], -1);
    saveAppearance();
  });
});
function saveAppearance() {
  localStorage.setItem('chickenAppearance', JSON.stringify(appearance));
  document.querySelectorAll('.cust-row').forEach((row) => {
    row.querySelector('.trait-value').textContent = appearance[row.dataset.trait];
  });
  drawCustomPreview();
}
function drawCustomPreview() {
  custPreviewCtx.clearRect(0, 0, custPreview.width, custPreview.height);
  const fakePlayer = {
    color: '#FFFFFF',
    appearance,
    segments: [{ x: 60, y: 60 }, { x: 40, y: 60 }, { x: 24, y: 60 }],
    name: ''
  };
  drawChicken(custPreviewCtx, fakePlayer, { x: 60, y: 60 }, true, 60, 60, 1.4);
}
saveAppearance();

// ---------- Menu / play flow ----------
let latestState = null;
let myId = null;
let mouse = { x: 0, y: 0 };
let boosting = false;
let playing = false;
let camZoom = 1;
let shakeUntil = 0, shakeMag = 0;
let ghosts = []; // { x, y, bornAt }

playBtn.addEventListener('click', () => {
  socket.emit('join', { name: nameInput.value || 'Chicken', appearance });
  menu.classList.add('hidden');
  playing = true;
});
respawnBtn.addEventListener('click', () => {
  socket.emit('respawn', { name: nameInput.value || 'Chicken', appearance });
  deathScreen.classList.add('hidden');
  playing = true;
});

canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', () => { boosting = true; });
canvas.addEventListener('mouseup', () => { boosting = false; });
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { boosting = true; e.preventDefault(); } });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') boosting = false; });
// touch controls (wormate-style: drag direction from finger to screen center-ish, tap-hold to boost)
let touchId = null;
canvas.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchId = t.identifier;
  mouse.x = t.clientX; mouse.y = t.clientY;
  boosting = true;
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === touchId) { mouse.x = t.clientX; mouse.y = t.clientY; }
  }
}, { passive: true });
canvas.addEventListener('touchend', () => { boosting = false; touchId = null; }, { passive: true });

socket.on('connect', () => { myId = socket.id; });

socket.on('state', (state) => {
  latestState = state;
  updateLeaderboard(state.leaderboard);
  const me = state.players.find((p) => p.id === myId);
  if (me) {
    scoreEl.textContent = `Length: ${me.score}`;
    updatePowerBadge(me.power);
    if (me.power === 'radar') { radarWrap.classList.remove('hidden'); drawRadar(me, state.predators); }
    else radarWrap.classList.add('hidden');
    const targetZoom = Math.max(0.55, Math.min(1, 22 / Math.sqrt(me.score)));
    camZoom += (targetZoom - camZoom) * 0.05;
  }
});

socket.on('dead', ({ score, killedBy }) => {
  playing = false;
  const cam = getCamera();
  ghosts.push({ x: mouse._lastHeadX || 0, y: mouse._lastHeadY || 0, bornAt: performance.now() });
  triggerShake(18, 700);
  playSquawk();
  finalScoreEl.textContent = `Final length: ${score}`;
  killedByEl.textContent = killedBy ? `Caught by a ${killedBy}!` : 'Flew into the fence!';
  setTimeout(() => { deathScreen.classList.remove('hidden'); }, 900);
});

function updatePowerBadge(power) {
  if (!power) { powerBadge.classList.add('hidden'); return; }
  powerBadge.classList.remove('hidden');
  const labels = { speed: '⚡ Speed boost', radar: '📡 Radar active', invincible: '✨ Invincible!' };
  powerBadge.textContent = labels[power] || power;
  powerBadge.className = 'power-badge power-' + power;
}

function drawRadar(me, predators) {
  radarCtx.clearRect(0, 0, radarCanvas.width, radarCanvas.height);
  const R = radarCanvas.width / 2;
  radarCtx.strokeStyle = 'rgba(255,255,255,0.4)';
  radarCtx.beginPath(); radarCtx.arc(R, R, R - 2, 0, Math.PI * 2); radarCtx.stroke();
  const head = me.segments[0];
  const range = 900;
  predators.forEach((pr) => {
    const dx = pr.x - head.x, dy = pr.y - head.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > range) return;
    const rx = R + (dx / range) * R;
    const ry = R + (dy / range) * R;
    radarCtx.fillStyle = '#ff4d4d';
    radarCtx.beginPath(); radarCtx.arc(rx, ry, 3.5, 0, Math.PI * 2); radarCtx.fill();
  });
  radarCtx.fillStyle = '#fff';
  radarCtx.beginPath(); radarCtx.arc(R, R, 3, 0, Math.PI * 2); radarCtx.fill();
}

function updateLeaderboard(list) {
  leaderboardList.innerHTML = '';
  list.forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.name} — ${entry.score}`;
    leaderboardList.appendChild(li);
  });
}

// ---------- Sound: procedural "squawk" (no audio files needed) ----------
let audioCtx = null;
function playSquawk() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.35;
    master.connect(audioCtx.destination);

    // "ba-keeee" - a wobbling squawk made of a few overlapping tone bursts
    const bursts = [
      { start: 0, dur: 0.09, f0: 380, f1: 620 },
      { start: 0.07, dur: 0.32, f0: 700, f1: 520 },
      { start: 0.35, dur: 0.28, f0: 560, f1: 300 },
      { start: 0.58, dur: 0.18, f0: 340, f1: 160 }
    ];
    bursts.forEach((b) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      const g = audioCtx.createGain();
      osc.frequency.setValueAtTime(b.f0, now + b.start);
      osc.frequency.linearRampToValueAtTime(b.f1, now + b.start + b.dur);
      g.gain.setValueAtTime(0.0001, now + b.start);
      g.gain.linearRampToValueAtTime(0.9, now + b.start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + b.start + b.dur);
      osc.connect(g); g.connect(master);
      osc.start(now + b.start); osc.stop(now + b.start + b.dur + 0.02);
    });

    // final "kkk" - short noise burst
    const bufferSize = audioCtx.sampleRate * 0.12;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const ng = audioCtx.createGain();
    ng.gain.value = 0.5;
    noise.connect(ng); ng.connect(master);
    noise.start(now + 0.74);
  } catch (e) { /* audio not available - fail silently */ }
}

function triggerShake(mag, ms) { shakeMag = mag; shakeUntil = performance.now() + ms; }

// ---------- Camera / rendering ----------
function getCamera() {
  if (!latestState) return { x: 0, y: 0 };
  const me = latestState.players.find((p) => p.id === myId);
  if (!me) return { x: latestState.world / 2, y: latestState.world / 2 };
  return { x: me.segments[0].x, y: me.segments[0].y };
}

setInterval(() => {
  if (!playing || !latestState) return;
  const me = latestState.players.find((p) => p.id === myId);
  if (!me) return;
  const head = me.segments[0];
  mouse._lastHeadX = head.x; mouse._lastHeadY = head.y;
  const cam = getCamera();
  const worldMouseX = (mouse.x - W / 2) / camZoom + cam.x;
  const worldMouseY = (mouse.y - H / 2) / camZoom + cam.y;
  const angle = Math.atan2(worldMouseY - head.y, worldMouseX - head.x);
  socket.emit('input', { angle, boosting });
}, 1000 / 30);

const NOSE_COLOR = '#f4a300';
function drawBeak(g, hx, hy, angle, kind) {
  const perp = angle + Math.PI / 2;
  g.fillStyle = NOSE_COLOR;
  g.beginPath();
  if (kind === 'button') {
    g.arc(hx + Math.cos(angle) * 10, hy + Math.sin(angle) * 10, 4, 0, Math.PI * 2);
  } else if (kind === 'long') {
    const bx = hx + Math.cos(angle) * 20, by = hy + Math.sin(angle) * 20;
    g.moveTo(bx, by);
    g.lineTo(hx + Math.cos(angle) * 6 + Math.cos(perp) * 3, hy + Math.sin(angle) * 6 + Math.sin(perp) * 3);
    g.lineTo(hx + Math.cos(angle) * 6 - Math.cos(perp) * 3, hy + Math.sin(angle) * 6 - Math.sin(perp) * 3);
    g.closePath();
  } else if (kind === 'stub') {
    const bx = hx + Math.cos(angle) * 9, by = hy + Math.sin(angle) * 9;
    g.moveTo(bx, by);
    g.lineTo(hx + Math.cos(angle) * 5 + Math.cos(perp) * 5, hy + Math.sin(angle) * 5 + Math.sin(perp) * 5);
    g.lineTo(hx + Math.cos(angle) * 5 - Math.cos(perp) * 5, hy + Math.sin(angle) * 5 - Math.sin(perp) * 5);
    g.closePath();
  } else { // classic
    const bx = hx + Math.cos(angle) * 14, by = hy + Math.sin(angle) * 14;
    g.moveTo(bx, by);
    g.lineTo(hx + Math.cos(angle) * 8 + Math.cos(perp) * 4, hy + Math.sin(angle) * 8 + Math.sin(perp) * 4);
    g.lineTo(hx + Math.cos(angle) * 8 - Math.cos(perp) * 4, hy + Math.sin(angle) * 8 - Math.sin(perp) * 4);
    g.closePath();
  }
  g.fill();
}
function drawLips(g, hx, hy, angle, kind) {
  if (kind === 'none') return;
  const perp = angle + Math.PI / 2;
  const cx = hx + Math.cos(angle) * 6, cy = hy + Math.sin(angle) * 6;
  g.strokeStyle = '#c0392b'; g.lineWidth = 2; g.beginPath();
  if (kind === 'grin') {
    g.moveTo(cx + Math.cos(perp) * 6, cy + Math.sin(perp) * 6);
    g.quadraticCurveTo(cx + Math.cos(angle) * 6, cy + Math.sin(angle) * 6, cx - Math.cos(perp) * 6, cy - Math.sin(perp) * 6);
  } else if (kind === 'smirk') {
    g.moveTo(cx + Math.cos(perp) * 5, cy + Math.sin(perp) * 5);
    g.quadraticCurveTo(cx, cy, cx - Math.cos(perp) * 3 + Math.cos(angle) * 4, cy - Math.sin(perp) * 3 + Math.sin(angle) * 4);
  } else if (kind === 'pucker') {
    g.arc(cx, cy, 2.5, 0, Math.PI * 2);
  }
  g.stroke();
}
function drawHair(g, hx, hy, angle, kind) {
  if (kind === 'none') return;
  g.fillStyle = '#3b2a1a';
  const up = angle - Math.PI / 2;
  if (kind === 'mohawk') {
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      const bx = hx + Math.cos(angle) * (i * 4);
      const by = hy + Math.sin(angle) * (i * 4);
      g.moveTo(bx, by);
      g.lineTo(bx + Math.cos(up) * 12, by + Math.sin(up) * 12);
      g.lineTo(bx + Math.cos(angle) * 3, by + Math.sin(angle) * 3);
      g.closePath(); g.fill();
    }
  } else if (kind === 'quiff') {
    g.beginPath();
    g.moveTo(hx, hy);
    g.quadraticCurveTo(hx + Math.cos(up) * 14 + Math.cos(angle) * 8, hy + Math.sin(up) * 14 + Math.sin(angle) * 8, hx + Math.cos(angle) * 6, hy + Math.sin(angle) * 6);
    g.closePath(); g.fill();
  } else if (kind === 'curl') {
    g.beginPath();
    g.arc(hx + Math.cos(up) * 9, hy + Math.sin(up) * 9, 4, 0, Math.PI * 2);
    g.fill();
  }
}
function drawCape(g, segs, cam, cx, cy, colorKind) {
  if (colorKind === 'none' || segs.length < 3) return;
  const colors = { 'cape-red': '#e63946', 'cape-blue': '#3a6fe6', 'cape-gold': '#f4c430', 'cape-stripes': '#e63946' };
  g.fillStyle = colors[colorKind] || '#e63946';
  const s1 = segs[1], s2 = segs[Math.min(4, segs.length - 1)];
  const x1 = s1.x - cam.x + cx, y1 = s1.y - cam.y + cy;
  const x2 = s2.x - cam.x + cx, y2 = s2.y - cam.y + cy;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const perp = angle + Math.PI / 2;
  g.beginPath();
  g.moveTo(x1 + Math.cos(perp) * 7, y1 + Math.sin(perp) * 7);
  g.lineTo(x1 - Math.cos(perp) * 7, y1 - Math.sin(perp) * 7);
  g.lineTo(x2 - Math.cos(perp) * 4, y2 - Math.sin(perp) * 4 + 10);
  g.lineTo(x2 + Math.cos(perp) * 4, y2 + Math.sin(perp) * 4 + 10);
  g.closePath(); g.fill();
  if (colorKind === 'cape-stripes') {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(x1 + Math.cos(perp) * 3, y1 + Math.sin(perp) * 3);
    g.lineTo(x1 - Math.cos(perp) * 3, y1 - Math.sin(perp) * 3);
    g.lineTo(x2 - Math.cos(perp) * 1.5, y2 - Math.sin(perp) * 1.5 + 10);
    g.lineTo(x2 + Math.cos(perp) * 1.5, y2 + Math.sin(perp) * 1.5 + 10);
    g.closePath(); g.fill();
  }
}

function drawChicken(g, p, cam, isMe, cx, cy, scale = 1, glow = null) {
  const segs = p.segments;
  drawCape(g, segs, cam, cx, cy, p.appearance ? p.appearance.flag : 'none');

  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    const sx = (s.x - cam.x) * scale + cx;
    const sy = (s.y - cam.y) * scale + cy;
    if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
    const r = (i === 0 ? 12 : Math.max(6, 10 - i * 0.02)) * scale;
    g.beginPath();
    g.fillStyle = p.color;
    if (glow) { g.shadowColor = glow; g.shadowBlur = 14; }
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    if (i % 6 === 0 && i !== 0) {
      g.fillStyle = 'rgba(0,0,0,0.08)';
      g.beginPath();
      g.ellipse(sx, sy, r * 0.7, r * 0.4, Math.sin(Date.now() / 200 + i) * 0.3, 0, Math.PI * 2);
      g.fill();
    }
  }

  const head = segs[0];
  const hx = (head.x - cam.x) * scale + cx;
  const hy = (head.y - cam.y) * scale + cy;
  let angle = 0;
  if (segs.length > 1) angle = Math.atan2(head.y - segs[1].y, head.x - segs[1].x);

  const app = p.appearance || { nose: 'classic', lips: 'none', hair: 'none', smile: 'happy', flag: 'none' };

  // comb
  g.fillStyle = '#e63946';
  g.beginPath();
  g.arc(hx - Math.cos(angle) * 4 * scale, hy - Math.sin(angle) * 4 * scale - 10 * scale, 4 * scale, 0, Math.PI * 2);
  g.fill();

  g.save();
  g.translate(hx, hy); g.scale(scale, scale); g.translate(-hx, -hy);
  drawBeak(g, hx, hy, angle, app.nose);
  drawLips(g, hx, hy, angle, app.lips);
  drawHair(g, hx, hy, angle, app.hair);
  g.restore();

  // eye + expression
  const perp = angle + Math.PI / 2;
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(hx + Math.cos(perp) * 5 * scale, hy + Math.sin(perp) * 5 * scale, 2 * scale, 0, Math.PI * 2);
  g.fill();
  if (app.smile === 'happy' || app.smile === 'sly') {
    g.strokeStyle = '#000'; g.lineWidth = 1.2 * scale;
    g.beginPath();
    const ex = hx + Math.cos(perp) * 5 * scale, ey = hy + Math.sin(perp) * 5 * scale;
    g.arc(ex, ey - 2 * scale, 2.5 * scale, app.smile === 'sly' ? 0.2 : 0.1, Math.PI - 0.1);
    g.stroke();
  } else if (app.smile === 'derp') {
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(hx - Math.cos(perp) * 6 * scale, hy - Math.sin(perp) * 6 * scale, 2.6 * scale, 0, Math.PI * 2);
    g.fill();
  }

  if (p.name) {
    g.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.85)';
    g.font = `${12 * scale}px 'Nunito', Arial`;
    g.textAlign = 'center';
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 3;
    g.fillText(p.name, hx, hy - 24 * scale);
    g.shadowBlur = 0;
  }
}

function drawFood(f, cam, scale = 1) {
  const fx = (f.x - cam.x) * scale + W / 2, fy = (f.y - cam.y) * scale + H / 2;
  if (fx < -20 || fx > W + 20 || fy < -20 || fy > H + 20) return;
  ctx.save();
  ctx.translate(fx, fy);
  ctx.scale(scale, scale);
  if (f.kind === 'corn') {
    ctx.fillStyle = '#f4c430';
    ctx.beginPath(); ctx.ellipse(0, 0, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.stroke();
  } else if (f.kind === 'seed') {
    ctx.fillStyle = '#8a6d4b';
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  } else if (f.kind === 'sushi') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.roundRect(-7, -5, 14, 10, 3); ctx.fill();
    ctx.fillStyle = '#2f9e44';
    ctx.fillRect(-7, -5, 14, 3);
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath(); ctx.arc(0, 1, 2.5, 0, Math.PI * 2); ctx.fill();
  } else if (f.kind === 'burger') {
    ctx.fillStyle = '#d2a24c';
    ctx.beginPath(); ctx.arc(0, -3, 7, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#6b8f3f';
    ctx.fillRect(-7, -2, 14, 2);
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(-7, 0, 14, 3);
    ctx.fillStyle = '#d2a24c';
    ctx.beginPath(); ctx.arc(0, 5, 7, 0, Math.PI); ctx.fill();
  } else if (f.kind === 'speed') {
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.moveTo(-2, -8); ctx.lineTo(4, -1); ctx.lineTo(0, -1); ctx.lineTo(2, 8); ctx.lineTo(-4, 1); ctx.lineTo(0, 1);
    ctx.closePath(); ctx.fill();
  } else if (f.kind === 'radar') {
    ctx.strokeStyle = '#4dd0ff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 2, 6, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 2, 3, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#4dd0ff';
    ctx.beginPath(); ctx.arc(0, 2, 1.5, 0, Math.PI * 2); ctx.fill();
  } else if (f.kind === 'worm') {
    const t = Date.now() / 150;
    ctx.strokeStyle = `hsl(${(Date.now() / 5) % 360},80%,60%)`;
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, Math.sin(t) * 2);
    ctx.quadraticCurveTo(0, Math.sin(t + 1) * 4, 6, Math.sin(t + 2) * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPredator(pr, cam, scale = 1) {
  const px = (pr.x - cam.x) * scale + W / 2, py = (pr.y - cam.y) * scale + H / 2;
  if (px < -40 || px > W + 40 || py < -40 || py > H + 40) return;
  ctx.save();
  ctx.translate(px, py); ctx.scale(scale, scale); ctx.rotate(pr.angle);
  const colors = { cat: '#ff8c42', dog: '#a67c52', wolf: '#6b6b6b', snake: '#4a9d4a' };
  ctx.fillStyle = colors[pr.type] || '#888';
  ctx.beginPath(); ctx.ellipse(0, 0, 15, 10, 0, 0, Math.PI * 2); ctx.fill();
  // head
  ctx.beginPath(); ctx.ellipse(14, 0, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
  if (pr.type === 'cat' || pr.type === 'wolf') {
    ctx.beginPath(); ctx.moveTo(11, -5); ctx.lineTo(9, -11); ctx.lineTo(15, -6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(17, -5); ctx.lineTo(20, -11); ctx.lineTo(19, -5); ctx.closePath(); ctx.fill();
  } else if (pr.type === 'dog') {
    ctx.fillStyle = '#7a5c3a';
    ctx.beginPath(); ctx.ellipse(10, 3, 3, 7, 0.3, 0, Math.PI * 2); ctx.fill();
  } else if (pr.type === 'snake') {
    ctx.beginPath(); ctx.ellipse(-16, Math.sin(Date.now() / 150) * 3, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(17, -2, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawGrid(cam, worldSize, scale) {
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  const spacing = 70;
  const startWorldX = cam.x - (W / 2) / scale;
  const endWorldX = cam.x + (W / 2) / scale;
  const startWorldY = cam.y - (H / 2) / scale;
  const endWorldY = cam.y + (H / 2) / scale;
  const gx0 = Math.floor(startWorldX / spacing) * spacing;
  const gy0 = Math.floor(startWorldY / spacing) * spacing;
  for (let x = gx0; x < endWorldX; x += spacing) {
    const sx = (x - cam.x) * scale + W / 2;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
  }
  for (let y = gy0; y < endWorldY; y += spacing) {
    const sy = (y - cam.y) * scale + H / 2;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
  }
  // world border, in screen space
  const left = (0 - cam.x) * scale + W / 2;
  const top = (0 - cam.y) * scale + H / 2;
  ctx.strokeStyle = '#ff9d5c'; ctx.lineWidth = 6;
  ctx.strokeRect(left, top, worldSize * scale, worldSize * scale);
}

function render() {
  ctx.clearRect(0, 0, W, H);

  // sky-dusk backdrop
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#241634'); grad.addColorStop(1, '#4d3a63');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  let shakeX = 0, shakeY = 0;
  const now = performance.now();
  if (now < shakeUntil) {
    const t = (shakeUntil - now) / 700;
    shakeX = (Math.random() - 0.5) * shakeMag * t;
    shakeY = (Math.random() - 0.5) * shakeMag * t;
  }
  ctx.save();
  ctx.translate(shakeX, shakeY);

  if (latestState) {
    const cam = getCamera();
    drawGrid(cam, latestState.world, camZoom);

    latestState.food.forEach((f) => drawFood(f, cam, camZoom));
    latestState.specialFood.forEach((f) => drawFood(f, cam, camZoom));
    latestState.powerFood.forEach((f) => drawFood(f, cam, camZoom));
    latestState.rareWorms.forEach((f) => drawFood(f, cam, camZoom));
    latestState.predators.forEach((pr) => drawPredator(pr, cam, camZoom));
    latestState.players.forEach((p) => {
      const glow = p.power === 'invincible' ? '#ffe066' : (p.power === 'speed' ? '#4dd0ff' : null);
      drawChicken(ctx, p, cam, p.id === myId, W / 2, H / 2, camZoom, glow);
    });
  }

  // ghosts (spirit leaving on death) - drawn in screen space at fixed spot
  ghosts = ghosts.filter((gst) => performance.now() - gst.bornAt < 1400);
  ghosts.forEach((gst) => {
    const t = (performance.now() - gst.bornAt) / 1400;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.translate(W / 2, H / 2 - t * 90);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(0, 0, 16 * (1 + t * 0.3), 20 * (1 + t * 0.3), 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(-5, -3, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(5, -3, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });

  ctx.restore();
  requestAnimationFrame(render);
}
render();

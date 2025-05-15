import { db } from "./firebase-config.js";
import {
  ref, get, set, update, onValue,
  onDisconnect, remove, runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

// ─── Music Setup ────────────────────────────────────────────
const bgMusic = new Howl({
  src: ['Sounds/bg_music.mp3'],
  loop: true,
  volume: 0.3,
  rate: 0.5
});
bgMusic.stop();  // at the top of your script
let musicId = null;

// ─── Constants ───────────────────────────────────────────────
let ROUND_MS = 60000 + Math.floor(Math.random() * 60000);
const PUNISHMENT_MS = 5000;
const STEP_MS = 16.667;
const PASS_COOLDOWN_MS = 300;

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const msg = document.getElementById("message");
const returnBtn = document.getElementById("returnBtn");

const lobbyId = new URLSearchParams(window.location.search).get("code");
const playerId = localStorage.getItem("playerId");

const gameRef = ref(db, `games/${lobbyId}`);
const lobbyRef = ref(db, `lobbies/${lobbyId}`);
const presenceRef = ref(db, `presence/${lobbyId}/${playerId}`);
const presenceRoot = ref(db, `presence/${lobbyId}`);

let serverOffset = 0;
onValue(ref(db, ".info/serverTimeOffset"), snap => {
  serverOffset = snap.val() || 0;
});
const serverNow = () => Date.now() + serverOffset;

set(presenceRef, true);
onDisconnect(presenceRef).remove();

let cleanupTimer = null;
onValue(presenceRoot, snap => {
  const active = snap.exists() ? Object.keys(snap.val()).length : 0;
  if (active === 0 && !cleanupTimer) {
    cleanupTimer = setTimeout(async () => {
      const verify = await get(presenceRoot);
      if (!verify.exists()) {
        await remove(gameRef);
        await update(lobbyRef, { gameStarted: false });
      }
      cleanupTimer = null;
    }, 10000);
  }
  if (active > 0 && cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
});

// ─── Game State ──────────────────────────────────────────────
let isHost, isCurrentPlayer, currentPlayerId;
let players = {}, seats = {}, seatingOrder = [];

let startTime = null;
let gameOver = false;
let localResetTime = 0;
let punishmentShown = false;
let messageTimeout;
let lastPassTime = 0;
let roundEndInterval = null;

const paddle = { x: 120, y: 470, width: 60, height: 10, prevX: 120 };
const ball = { x: 150, y: 100, radius: 8, dx: 0, dy: 5 };
const gapSize = 50;

// ─── Input ───────────────────────────────────────────────────
let keyPressed = {};
let lastInputX = null;
document.addEventListener("keydown", e => keyPressed[e.key.toLowerCase()] = true);
document.addEventListener("keyup", e => keyPressed[e.key.toLowerCase()] = false);
canvas.addEventListener("mousemove", e => {
  const r = canvas.getBoundingClientRect();
  lastInputX = e.clientX - r.left;
});
canvas.addEventListener("touchmove", e => {
  const r = canvas.getBoundingClientRect();
  lastInputX = e.touches[0].clientX - r.left;
});

// ─── UI ──────────────────────────────────────────────────────
const showMessage = t => { msg.textContent = t; };
function setTemporaryMessage(t, fb) {
  clearTimeout(messageTimeout);
  showMessage(t);
  messageTimeout = setTimeout(() => showMessage(fb), 2500);
}

function handleMusic() {
  if (!isCurrentPlayer || !startTime || !ROUND_MS) {
    if (musicId !== null) {
      bgMusic.stop(musicId);
      musicId = null;
    }
    return;
  }

  const elapsed = (serverNow() - startTime) / 1000;
  const offset = elapsed % bgMusic.duration();
  const rate = 0.5 + Math.min(1, elapsed / ROUND_MS) * 0.75;

  if (musicId === null) {
    musicId = bgMusic.play();
    bgMusic.seek(offset, musicId);
    bgMusic.rate(rate, musicId);
  } else {
    bgMusic.rate(rate, musicId);
  }
}


function tryStartGame() {
  if (!seatingOrder.length) return;
  const now = serverNow();
  runTransaction(gameRef, cur => {
    if (!cur || cur.gameOver) {
      startTime = now;
      return {
        currentPlayer: seatingOrder[0],
        ballResetTime: now,
        startTime: now,
        roundDuration: ROUND_MS,
        gameOver: false
      };
    }
    return;
  });
  setTimeout(handleMusic, 300);

}

// ─── Game Listener ───────────────────────────────────────────
onValue(gameRef, snap => {
  const g = snap.val(); if (!g) return;

  currentPlayerId = g.currentPlayer;
  isCurrentPlayer = currentPlayerId === playerId;
  if (g.startTime) startTime = g.startTime;
  if (g.roundDuration) ROUND_MS = g.roundDuration;

  if (isHost && g.startTime && !g.gameOver && !roundEndInterval) {
    roundEndInterval = setInterval(() => {
      if (serverNow() - g.startTime >= ROUND_MS) {
        clearInterval(roundEndInterval);
        roundEndInterval = null;
        update(gameRef, { gameOver: true });
      }
    }, 200);
  }

  handleMusic();

  if (g.gameOver && !gameOver) {
    gameOver = true;
    if (roundEndInterval) {
      clearInterval(roundEndInterval);
      roundEndInterval = null;
    }
    returnBtn.style.display = "block";
    const loser = players[currentPlayerId]?.name || "Someone";
    showMessage(isCurrentPlayer
      ? "💀 Time's up! You lost the game!"
      : `🎉 ${loser} lost the game!`);
  }

  if (!gameOver) {
    const n = players[currentPlayerId]?.name;
    showMessage(isCurrentPlayer
      ? "🎯 Your turn!"
      : n ? `⏳ ${n} is playing...` : "⏳ A player is playing...");
  }

  if (g.ballResetTime && g.ballResetTime !== localResetTime) {
    localResetTime = g.ballResetTime;
    resetBall(g.ballState || null);
  }
});

// ─── Lobby Listener ──────────────────────────────────────────
onValue(lobbyRef, async snap => {
  const d = snap.val(); if (!d || !d.players || !d.seats) return;
  players = d.players;
  seats = d.seats;
  isHost = d.hostId === playerId;

  seatingOrder = Object.entries(seats)
    .filter(([_, pid]) => pid && pid !== 0)
    .sort(([a],[b]) => +a - +b)
    .map(([_, pid]) => pid);

  tryStartGame();

  const seatedIds = Object.values(seats).filter(id => id && id !== 0);
  const allDone = seatedIds.every(pid => players[pid]?.done);
  if (allDone && seatedIds.length) {
    await remove(gameRef);
    await update(lobbyRef, { gameStarted: false });
    for (const pid of Object.keys(players)) {
      await update(ref(db, `lobbies/${lobbyId}/players/${pid}`), { done: null });
    }
  }
});

// ─── Paddle ──────────────────────────────────────────────────
function updatePaddle(dt) {
  if (gameOver) return;
  paddle.prevX = paddle.x;
  const speed = 5 * dt / STEP_MS;
  if (keyPressed["arrowleft"] || keyPressed["a"]) paddle.x -= speed;
  if (keyPressed["arrowright"] || keyPressed["d"]) paddle.x += speed;
  if (lastInputX !== null) paddle.x = lastInputX - paddle.width / 2;
  paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, paddle.x));
}

// ─── Drawing ─────────────────────────────────────────────────
function drawPaddle() { ctx.fillStyle = "#fff"; ctx.fillRect(paddle.x,paddle.y,paddle.width,paddle.height); }
function drawBall()   { ctx.beginPath(); ctx.arc(ball.x,ball.y,ball.radius,0,Math.PI*2); ctx.fillStyle="cyan"; ctx.fill(); }
function drawGaps()   {
  ctx.fillStyle="lime";
  ctx.fillRect(0,0,gapSize,10);
  ctx.fillRect(canvas.width-gapSize,0,gapSize,10);
  ctx.fillStyle="#fff";
  ctx.fillRect(gapSize,0,canvas.width-2*gapSize,10);
}

// ─── Ball Logic ──────────────────────────────────────────────
function resetBall(state = null) {
  const isPass = !!state;
  if (!isPass) punishmentShown = true;

  const apply = () => {
    if (state && isCurrentPlayer) {
      ball.x  = state.entrySide === "left" ? canvas.width - gapSize / 2 : gapSize / 2;
      ball.y  = 20;
      ball.dx = state.dx || 0;
      ball.dy = 5;
    } else {
      ball.x = 150; ball.y = 100; ball.dx = 0;
      ball.dy = isCurrentPlayer ? 5 : 0;
    }
    punishmentShown = false;
  };

  isPass ? apply() : setTimeout(apply, PUNISHMENT_MS);
}

function getNextPlayer(dir) {
  const idx = seatingOrder.indexOf(playerId);
  if (idx === -1) return playerId;
  return seatingOrder[
    (dir === "left" ? idx + 1 : idx - 1 + seatingOrder.length) % seatingOrder.length
  ];
}

function triggerNextTurn(dir, msg) {
  const now = serverNow();
  if (now - lastPassTime < PASS_COOLDOWN_MS) return;
  lastPassTime = now;

  const next = getNextPlayer(dir);
  const fb = players[next]?.name
    ? `⏳ ${players[next].name} is playing...`
    : "⏳ A player is playing...";
  setTemporaryMessage(msg, fb);

  localResetTime = now;
  update(gameRef, {
    currentPlayer: next,
    ballResetTime: localResetTime,
    ballState: { dx: ball.dx, entrySide: dir }
  });
}

// ─── Game Loop ───────────────────────────────────────────────
function updateGame(dt) {
  if (gameOver || punishmentShown || !isCurrentPlayer) return;

  const step = dt / STEP_MS;
  ball.x += ball.dx * step;
  ball.y += ball.dy * step;

  if (ball.x - ball.radius < 0 || ball.x + ball.radius > canvas.width) {
    ball.dx *= -1;
    ball.x = Math.max(ball.radius, Math.min(canvas.width - ball.radius, ball.x));
  }

  if (ball.y - ball.radius <= 10) {
    if (ball.x > gapSize && ball.x < canvas.width - gapSize) {
      ball.dy *= -1;
      ball.y = 10 + ball.radius;
    } else if (ball.x < gapSize) {
      triggerNextTurn("left",  "⬅️ Passed to the left!");
    } else {
      triggerNextTurn("right", "➡️ Passed to the right!");
    }
  }

  const move = paddle.x - paddle.prevX;
  if (
    ball.y + ball.radius >= paddle.y &&
    ball.x > paddle.x && ball.x < paddle.x + paddle.width &&
    ball.dy > 0
  ) {
    ball.dy *= -1;
    ball.y = paddle.y - ball.radius;
    ball.dx = Math.max(-5, Math.min(5, ball.dx + move * 0.3));
  }

  if (ball.y - ball.radius > canvas.height) {
    setTemporaryMessage("💥 You missed! Try again soon!", "🎯 Your turn!");
    resetBall();
  }
}

function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawGaps(); drawPaddle(); if (isCurrentPlayer) drawBall();
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(32, now - last); last = now;
  updatePaddle(dt);
  if (isCurrentPlayer) updateGame(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

returnBtn.onclick = async () => {
  await update(ref(db, `lobbies/${lobbyId}/players/${playerId}`), { done: true });
  window.location.href = `lobby.html?code=${lobbyId}`;
};

// ─── Music Speed Sync ────────────────────────────────────────
setInterval(() => {
  if (!isCurrentPlayer || !startTime || !ROUND_MS) return;
  const t = serverNow() - startTime;
  const progress = Math.min(1, t / ROUND_MS);
  const rate = 0.5 + progress * 1;
  bgMusic.rate(rate);
}, 500);

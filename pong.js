import { db } from "./firebase-config.js";
import {
  ref, get, set, update, onValue, onDisconnect, remove, runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

/* ─── constants ───────────────────────────────────────────────────────── */
const ROUND_MS        = 60_000;     // 60 s
const PUNISHMENT_MS   = 5_000;      // 5 s
const STEP_MS         = 16.667;     // 60 fps frame
const PASS_COOLDOWN_MS = 300;       // debounce fast passes

/* ─── DOM handles ─────────────────────────────────────────────────────── */
const canvas    = document.getElementById("gameCanvas");
const ctx       = canvas.getContext("2d");
const msg       = document.getElementById("message");
const returnBtn = document.getElementById("returnBtn");

/* ─── IDs & DB refs ───────────────────────────────────────────────────── */
const lobbyId  = new URLSearchParams(window.location.search).get("code");
const playerId = localStorage.getItem("playerId");

const gameRef      = ref(db, `games/${lobbyId}`);
const lobbyRef     = ref(db, `lobbies/${lobbyId}`);
const playersRef   = ref(db, `lobbies/${lobbyId}/players`);
const presenceRef  = ref(db, `presence/${lobbyId}/${playerId}`);
const presenceRoot = ref(db, `presence/${lobbyId}`);

/* ─── server‑time offset — one listener globally ──────────────────────── */
let serverOffset = 0;
onValue(ref(db, ".info/serverTimeOffset"), s => { serverOffset = s.val() || 0; });
const serverNow = () => Date.now() + serverOffset;

/* ─── presence (for autoclean) ────────────────────────────────────────── */
set(presenceRef, true);
onDisconnect(presenceRef).remove();

let cleanupTimer = null;
const CLEANUP_DELAY_MS = 10_000;

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
    }, CLEANUP_DELAY_MS);
  }
  if (active > 0 && cleanupTimer) {
    clearTimeout(cleanupTimer); cleanupTimer = null;
  }
});

/* ─── local state ─────────────────────────────────────────────────────── */
let isHost          = false;
let isCurrentPlayer = false;
let currentPlayerId = null;
let seatingOrder    = [];
let players         = {};
let seats           = {};

let startTime       = null;
let gameOver        = false;
let localResetTime  = 0;
let punishmentShown = false;
let messageTimeout;
let lastPassTime    = 0;

/* ─── paddle & ball ───────────────────────────────────────────────────── */
const paddle = { x: 120, y: 470, width: 60, height: 10, prevX: 120 };
const ball   = { x: 150, y: 100, radius: 8, dx: 0, dy: 5 };
const gapSize = 50;

/* ─── input helpers ───────────────────────────────────────────────────── */
let keyPressed = {};
let lastInputX = null;

document.addEventListener("keydown", e => keyPressed[e.key.toLowerCase()] = true);
document.addEventListener("keyup",   e => keyPressed[e.key.toLowerCase()] = false);
canvas.addEventListener("mousemove", e => {
  const r = canvas.getBoundingClientRect();
  lastInputX = e.clientX - r.left;
});
canvas.addEventListener("touchmove", e => {
  const r = canvas.getBoundingClientRect();
  lastInputX = e.touches[0].clientX - r.left;
});

/* ─── UI helpers ──────────────────────────────────────────────────────── */
const showMessage = t => { msg.textContent = t; };
function setTemporaryMessage(t, fallback) {
  clearTimeout(messageTimeout);
  showMessage(t);
  messageTimeout = setTimeout(() => showMessage(fallback), 2500);
}

/* ─── initialise / start a round ──────────────────────────────────────── */
function tryStartGame() {
  if (seatingOrder.length === 0) return;

  const now = serverNow();
  runTransaction(gameRef, cur => {
    if (!cur || cur.gameOver) {
      startTime = now;
      return {
        currentPlayer: seatingOrder[0],
        ballResetTime: now,
        startTime:     now,
        gameOver:      false
      };
    }
    return;   // already running
  });
}

/* ─── Firebase listeners ──────────────────────────────────────────────── */
onValue(gameRef, snap => {
  const g = snap.val(); if (!g) return;

  currentPlayerId = g.currentPlayer;
  isCurrentPlayer = currentPlayerId === playerId;
  if (g.startTime) startTime = g.startTime;

  /* round end */
  if (g.gameOver && !gameOver) {
    gameOver = true;
    returnBtn.style.display = "block";
    const loser = players[currentPlayerId]?.name || "Someone";
    showMessage(isCurrentPlayer ?
      "💀 Time's up! You lost the game!" :
      `🎉 ${loser} lost the game!`);
  }

  /* status */
  if (!gameOver) {
    const name = players[currentPlayerId]?.name;
    showMessage(isCurrentPlayer ?
      "🎯 Your turn!" :
      name ? `⏳ ${name} is playing...` : "⏳ A player is playing...");
  }

  /* ball reset broadcast */
  if (g.ballResetTime && g.ballResetTime !== localResetTime) {
    localResetTime = g.ballResetTime;
    resetBall(g.ballState || null);
  }
});

onValue(lobbyRef, async snap => {
  const d = snap.val(); if (!d || !d.players || !d.seats) return;

  players  = d.players;
  seats    = d.seats;
  isHost   = d.hostId === playerId;

  seatingOrder = Object.entries(seats)
    .filter(([_, pid]) => pid && pid !== 0)
    .sort(([a],[b]) => +a - +b)
    .map(([_, pid]) => pid);

  tryStartGame();

  /* post‑game cleanup: wait until EVERY seated player set done=true */
  const seated = Object.values(seats).filter(id => id && id !== 0);
  const allDone = seated.every(pid => players[pid]?.done);
  if (allDone && seated.length) {
    await remove(gameRef);
    await update(lobbyRef, { gameStarted: false });
    for (const pid of Object.keys(players)) {
      await update(ref(db, `lobbies/${lobbyId}/players/${pid}`), { done: null });
    }
  }
});

/* ─── paddle update (frame‑rate independent) ──────────────────────────── */
function updatePaddle(dt) {
  if (gameOver) return;
  paddle.prevX = paddle.x;
  const speed = 5 * dt / STEP_MS;
  if (keyPressed["arrowleft"] || keyPressed["a"]) paddle.x -= speed;
  if (keyPressed["arrowright"] || keyPressed["d"]) paddle.x += speed;
  if (lastInputX !== null) paddle.x = lastInputX - paddle.width / 2;
  paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, paddle.x));
}

/* ─── drawing helpers ─────────────────────────────────────────────────── */
function drawPaddle() { ctx.fillStyle="#fff"; ctx.fillRect(paddle.x,paddle.y,paddle.width,paddle.height); }
function drawBall()   { ctx.beginPath(); ctx.arc(ball.x,ball.y,ball.radius,0,Math.PI*2); ctx.fillStyle="cyan"; ctx.fill(); }
function drawGaps()   {
  ctx.fillStyle="lime"; ctx.fillRect(0,0,gapSize,10); ctx.fillRect(canvas.width-gapSize,0,gapSize,10);
  ctx.fillStyle="#fff"; ctx.fillRect(gapSize,0,canvas.width-2*gapSize,10);
}

/* ─── ball reset / passing ────────────────────────────────────────────── */
function resetBall(state=null){
  const isPass = !!state;
  if(!isPass) punishmentShown = true;

  const apply = ()=>{
    if(state && isCurrentPlayer){
      ball.x  = state.entrySide==="left" ? canvas.width-gapSize/2 : gapSize/2;
      ball.y  = 20;
      ball.dx = state.dx||0;
      ball.dy = 5;
    }else{
      ball.x=150; ball.y=100; ball.dx=0; ball.dy=isCurrentPlayer?5:0;
    }
    punishmentShown = false;
  };
  isPass ? apply() : setTimeout(apply,PUNISHMENT_MS);
}

function getNextPlayer(dir){
  const idx = seatingOrder.indexOf(playerId);
  if(idx===-1) return playerId;
  return seatingOrder[(dir==="left"?idx+1:idx-1+seatingOrder.length)%seatingOrder.length];
}

function triggerNextTurn(dir,msg){
  const now = serverNow();
  if(now-lastPassTime < PASS_COOLDOWN_MS) return;
  lastPassTime = now;

  const next = getNextPlayer(dir);
  const fb   = players[next]?.name ? `⏳ ${players[next].name} is playing...` : "⏳ A player is playing...";
  setTemporaryMessage(msg,fb);

  localResetTime = now;
  update(gameRef,{
    currentPlayer : next,
    ballResetTime : localResetTime,
    ballState     : { dx:ball.dx, entrySide:dir }
  });
  resetBall();
}

/* ─── main game update ────────────────────────────────────────────────── */
function updateGame(dt){
  if(gameOver||punishmentShown||!isCurrentPlayer) return;

  /* server‑time based round timer (host enforces) */
  if(isHost && startTime && serverNow()-startTime >= ROUND_MS){ endGame(); return; }

  const step = dt / STEP_MS;
  ball.x += ball.dx*step; ball.y += ball.dy*step;

  if(ball.x-ball.radius<0||ball.x+ball.radius>canvas.width){
    ball.dx*=-1; ball.x=Math.max(ball.radius,Math.min(canvas.width-ball.radius,ball.x));
  }

  if(ball.y-ball.radius<=10){
    if(ball.x>gapSize && ball.x<canvas.width-gapSize){
      ball.dy*=-1; ball.y=10+ball.radius;
    }else if(ball.x<gapSize){
      triggerNextTurn("left","⬅️ Passed to the left!");
    }else{
      triggerNextTurn("right","➡️ Passed to the right!");
    }
  }

  const paddleMove = paddle.x-paddle.prevX;
  if(ball.y+ball.radius>=paddle.y && ball.x>paddle.x && ball.x<paddle.x+paddle.width && ball.dy>0){
    ball.dy*=-1; ball.y=paddle.y-ball.radius;
    ball.dx=Math.max(-5,Math.min(5,ball.dx+paddleMove*0.3));
  }

  if(ball.y-ball.radius > canvas.height){
    setTemporaryMessage("💥 You missed! Try again soon!","🎯 Your turn!");
    resetBall();
  }
}

function endGame(){
  gameOver=true; update(gameRef,{gameOver:true});
  returnBtn.style.display="block";
  const loser = players[currentPlayerId]?.name || "Someone";
  showMessage(isCurrentPlayer?"💀 Time's up! You lost the game!":`🎉 ${loser} lost the game!`);
}

/* ─── render loop ─────────────────────────────────────────────────────── */
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawGaps(); drawPaddle(); if(isCurrentPlayer) drawBall();
}
let last=performance.now();
function loop(now){
  const dt=Math.min(32,now-last); last=now;
  updatePaddle(dt);
  if(isCurrentPlayer) updateGame(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ─── navigation ──────────────────────────────────────────────────────── */
returnBtn.onclick = async ()=>{
  await update(ref(db, `lobbies/${lobbyId}/players/${playerId}`), { done:true });
  window.location.href = `lobby.html?code=${lobbyId}`;
};

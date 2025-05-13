import { db } from "./firebase-config.js";
import {
  ref, set, get, update, onValue, remove, onDisconnect
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

/* ─── persistent identity ─────────────────────────── */
const localPlayerId = localStorage.getItem("playerId") || crypto.randomUUID();
localStorage.setItem("playerId", localPlayerId);

/* ─── DOM handles ─────────────────────────────────── */
const lobbyCodeInput  = document.getElementById("lobbyCodeInput");
const tableDiv        = document.getElementById("table");
const unseatedDiv     = document.getElementById("unseatedPlayers");
const hostControls    = document.getElementById("hostControls");
const startGameButton = document.getElementById("startGameButton");
const leaveBtn        = document.getElementById("leaveLobbyButton");

/* ─── globals ─────────────────────────────────────── */
let lobbyId  = null;
let isHost   = false;
let leftLobby = false;

/* ─── helpers ─────────────────────────────────────── */
const generateCode = () => Math.random().toString(36).slice(2,8).toUpperCase();
const serverNow    = () => Date.now();  // lobby does not need strict sync

function addPresence(){
  const pres = ref(db, `presence/${lobbyId}/${localPlayerId}`);
  set(pres,true); onDisconnect(pres).remove();
}

/* ─── create / join ───────────────────────────────── */
window.createLobby = async function(){
  lobbyId = generateCode(); isHost = true;

  const players = { [localPlayerId]: { name:"Host", joinedAt:serverNow(), seat:null }};
  const seats = {}; for(let i=1;i<=5;i++) seats[i]=0;

  await set(ref(db, `lobbies/${lobbyId}`), {
    hostId: localPlayerId, players, seats, gameStarted:false
  });

  addPresence(); enterUI(); listen();
};

window.joinLobby = async function(){
  const code = lobbyCodeInput.value.trim().toUpperCase();
  if(!code) return;
  const lobbySnap = await get(ref(db, `lobbies/${code}`));
  if(!lobbySnap.exists()){ alert("Lobby not found"); return; }

  lobbyId = code; const data = lobbySnap.val(); isHost = data.hostId === localPlayerId;

  if(!data.players?.[localPlayerId]){
    await set(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), {
      name:"Player", joinedAt:serverNow(), seat:null
    });
  }
  addPresence(); enterUI(); listen();
};

/* ─── UI setup ────────────────────────────────────── */
function enterUI(){
  document.getElementById("createJoin").style.display="none";
  document.getElementById("lobbyView").style.display="block";
  document.getElementById("lobbyCodeDisplay").textContent = lobbyId;

  leaveBtn.onclick = async ()=>{
    leftLobby=true;
    await remove(ref(db,`lobbies/${lobbyId}/players/${localPlayerId}`));
    location.reload();
  };
}

/* ─── realtime listener ──────────────────────────── */
function listen(){
  const lobbyRef = ref(db, `lobbies/${lobbyId}`);
  onValue(lobbyRef, async snap=>{
    const d = snap.val(); if(!d) { location.reload(); return; }

    const players = d.players || {};
    const seats   = d.seats || {};

    /* redirect into game ONLY if this player hasn't pressed Return */
    if(d.gameStarted && !players[localPlayerId]?.done){
      window.location.href = `pong.html?code=${lobbyId}`; return;
    }

    /* kicked? */
    if(!players[localPlayerId] && !leftLobby){
      alert("You were removed from the lobby."); location.reload(); return;
    }

    renderTable(players,seats);
    renderUnseated(players,seats);
    renderButtons(d,seats);
  });
}

/* ─── seat/table rendering (unchanged except condensed) ──────────────── */
function renderTable(players,seats){
  tableDiv.innerHTML="";
  const entries=Object.entries(seats); const n=entries.length;
  const R=120,CX=140,CY=140;
  entries.forEach(([num,pid],i)=>{
    const a=i/n*2*Math.PI; const x=CX+R*Math.cos(a); const y=CY+R*Math.sin(a);
    const div=document.createElement("div"); div.className="seat";
    div.style.left=`${x}px`; div.style.top=`${y}px`; div.dataset.seat=num;

    if(String(pid)!=="0"){
      div.textContent=players[pid]?.name||"Taken"; div.classList.add("taken");
      if(pid===localPlayerId) div.classList.add("self");
      if(isHost){ div.style.cursor="pointer";
        div.onclick=async()=>{ await update(ref(db,`lobbies/${lobbyId}`),{[`seats/${num}`]:0});
          await update(ref(db,`lobbies/${lobbyId}/players/${pid}`), { seat:null, blockedUntil:serverNow()+3000 }); };
      }
    }else{
      div.textContent=`Seat ${num}`; div.style.cursor="pointer";
      div.onclick=async()=>trySit(num,players,seats);
    }
    tableDiv.appendChild(div);
  });
}
async function trySit(num,players,seats){
  if(players[localPlayerId]?.blockedUntil > serverNow()) return;
  const upd={};
  for(const [n,id] of Object.entries(seats)) if(String(id)===localPlayerId) upd[`seats/${n}`]=0;
  upd[`seats/${num}`]=localPlayerId;
  await update(ref(db,`lobbies/${lobbyId}`),upd);
  await update(ref(db,`lobbies/${lobbyId}/players/${localPlayerId}`),{ seat:+num });
}
function renderUnseated(players,seats){
  unseatedDiv.innerHTML="";
  const seatedIds=new Set(Object.values(seats).filter(id=>id&&id!=="0"));
  for(const [id,p] of Object.entries(players)){
    if(seatedIds.has(id)) continue;
    const d=document.createElement("div"); d.className="player"; d.textContent=p.name;
    if(isHost && id!==localPlayerId){ d.style.cursor="pointer";
      d.onclick=async()=>{ await remove(ref(db,`lobbies/${lobbyId}/players/${id}`)); }; }
    unseatedDiv.appendChild(d);
  }
}

/* ─── buttons / start logic ───────────────────────── */
function renderButtons(d,seats){
  /* start */
  const allFilled = Object.values(seats).every(id=>id&&id!=="0");
  const canStart = isHost && allFilled && !d.gameStarted;
  startGameButton.style.display = canStart?"inline-block":"none";
  startGameButton.disabled = !canStart;
  if(canStart) startGameButton.onclick = ()=> update(ref(db,`lobbies/${lobbyId}`),{gameStarted:true});
}

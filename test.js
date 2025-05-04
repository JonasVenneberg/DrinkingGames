import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase, ref, set, onValue, update } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAs2ZRuQDUHvZGh3FH7hWvqD4lV2lw52Qw",
    authDomain: "drinking-game-33a06.firebaseapp.com",
    databaseURL: "https://drinking-game-33a06-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "drinking-game-33a06",
    storageBucket: "drinking-game-33a06.appspot.com",
    messagingSenderId: "257194045108",
    appId: "1:257194045108:web:9e8ad287cde8ddc4b431e1"
  };

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const tableDiv = document.getElementById("table");
const playerId = crypto.randomUUID();

window.createLobby = async function () {
  const seats = {};
  for (let i = 1; i <= 4; i++) seats[i] = 0;

  await set(ref(db, "lobbies/test"), {
    players: { [playerId]: { name: "You" } },
    seats
  });

  listen();
};

function listen() {
  onValue(ref(db, "lobbies/test"), snapshot => {
    const data = snapshot.val();
    const seats = data?.seats || {};
    const players = data?.players || {};
    tableDiv.innerHTML = "";

    Object.entries(seats).forEach(([num, val]) => {
      const div = document.createElement("div");
      div.className = "seat";
      if (val !== 0) {
        div.textContent = players[val]?.name || "Taken";
        div.classList.add("taken");
        if (val === playerId) div.classList.add("self");
      } else {
        div.textContent = `Seat ${num}`;
        div.onclick = async () => {
          const updates = {};
          for (const [s, pid] of Object.entries(seats)) {
            if (pid === playerId) updates[`seats/${s}`] = 0;
          }
          updates[`seats/${num}`] = playerId;
          await update(ref(db, "lobbies/test"), updates);
        };
      }
      tableDiv.appendChild(div);
    });
  });
}

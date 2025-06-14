// firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAs2ZRuQDUHvZGh3FH7hWvqD4lV2lw52Qw",
  authDomain: "drinking-game-33a06.firebaseapp.com",
  databaseURL: "https://drinking-game-33a06-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "drinking-game-33a06",
  storageBucket: "drinking-game-33a06.appspot.com",
  messagingSenderId: "257194045108",
  appId: "1:257194045108:web:9e8ad287cde8ddc4b431e1"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBq5m_SSK7pbPiMvU96HRhPgRbza8JuLLc",
  authDomain: "musibot-d75e6.firebaseapp.com",
  projectId: "musibot-d75e6",
  storageBucket: "musibot-d75e6.firebasestorage.app",
  messagingSenderId: "68110795748",
  appId: "1:68110795748:web:ed7312655333e032cc3df1"
};

const app = initializeApp(firebaseConfig, "musibot-lector");
export const db = getFirestore(app);
export const auth = getAuth(app);

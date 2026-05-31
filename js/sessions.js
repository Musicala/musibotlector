import { db } from "./firebase.js";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

export function subscribeSessions(onChange, onError, maxResults = 500) {
  const q = query(
    collection(db, "sessions"),
    orderBy("updated_at", "desc"),
    limit(maxResults)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const sessions = [];
      snapshot.forEach((doc) => sessions.push({ id: doc.id, ...doc.data() }));
      onChange(sessions);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function getSessionEvents(sessionId) {
  const q = query(
    collection(db, "sessions", sessionId, "events"),
    orderBy("ts", "asc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

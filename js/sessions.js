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

// Lee eventos sin lanzar excepción (devuelve [] ante cualquier fallo).
export async function getEventsSafe(sessionId) {
  try {
    return await getSessionEvents(sessionId);
  } catch (err) {
    return [];
  }
}

// Adjunta los eventos a cada sesión. Mantiene el volumen actual razonable
// limitando la concurrencia por tandas.
export async function getSessionsWithEvents(sessions, batchSize = 25) {
  const out = [];
  for (let i = 0; i < sessions.length; i += batchSize) {
    const slice = sessions.slice(i, i + batchSize);
    const withEv = await Promise.all(
      slice.map(async (s) => ({ ...s, events: await getEventsSafe(s.id) }))
    );
    out.push(...withEv);
  }
  return out;
}

export async function getAllSessions() {
  const q = query(
    collection(db, "sessions"),
    orderBy("updated_at", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

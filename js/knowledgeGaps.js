import { db } from "./firebase.js";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

export function subscribeKnowledgeGaps(onChange, onError, maxResults = 500) {
  const q = query(
    collection(db, "knowledge_gaps"),
    orderBy("ts", "desc"),
    limit(maxResults)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const gaps = [];
      snapshot.forEach((d) => gaps.push({ id: d.id, ...d.data() }));
      onChange(gaps);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function markGapReviewed(gapId) {
  const ref = doc(db, "knowledge_gaps", gapId);
  await updateDoc(ref, { reviewed: true, status: "reviewed" });
}

// Crea un knowledge gap registrado (p.ej. desde un candidate gap detectado).
export async function createKnowledgeGap(data) {
  const payload = {
    text: String(data.text || "").slice(0, 1190),
    ts: serverTimestamp(),
    client_ts: data.client_ts || null,
    session_id: data.session_id || "",
    node_name: data.node_name || "",
    node_id: data.node_id || "",
    source: data.source || "",
    lang: data.lang || "es",
    last_bot_text: data.last_bot_text || "",
    nombre: data.nombre || "",
    cel: data.cel || "",
    servicio: data.servicio || "",
    arte: data.arte || "",
    modalidad: data.modalidad || "",
    status: "new",
    reviewed: false,
    created_from: "candidate_gap"
  };
  const ref = await addDoc(collection(db, "knowledge_gaps"), payload);
  return ref.id;
}

export async function getAllKnowledgeGaps() {
  const q = query(
    collection(db, "knowledge_gaps"),
    orderBy("ts", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

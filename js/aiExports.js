import { db } from "./firebase.js";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const COL = "ai_exports";

// Última exportación registrada (cualquier estado).
export async function getLastAiExport() {
  const q = query(collection(db, COL), orderBy("exported_at", "desc"), limit(1));
  const snap = await getDocs(q);
  const d = snap.docs[0];
  return d ? { id: d.id, ...d.data() } : null;
}

// Última exportación que ya fue marcada como implementada.
export async function getLastImplementedAiExport() {
  // Traemos un puñado y filtramos en cliente para no exigir índices compuestos.
  const q = query(collection(db, COL), orderBy("exported_at", "desc"), limit(50));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const data = d.data();
    if (data.status === "implemented") return { id: d.id, ...data };
  }
  return null;
}

// Historial de las últimas N exportaciones.
export async function getAiExportsHistory(limitNumber = 10) {
  const q = query(collection(db, COL), orderBy("exported_at", "desc"), limit(limitNumber));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Crea el documento de exportación. exported_at se fija con serverTimestamp.
export async function createAiExport(data) {
  const payload = {
    exported_at: serverTimestamp(),
    exported_by: data.exported_by || "",
    range_type: data.range_type || "all",
    from: data.from || null,
    to: data.to || null,
    filters_snapshot: data.filters_snapshot || {},
    sessions_count: Number(data.sessions_count || 0),
    gaps_count: Number(data.gaps_count || 0),
    candidate_gaps_count: Number(data.candidate_gaps_count || 0),
    session_ids: Array.isArray(data.session_ids) ? data.session_ids : [],
    gap_ids: Array.isArray(data.gap_ids) ? data.gap_ids : [],
    status: "pending",
    implemented_at: null,
    implemented_by: null,
    note: data.note || ""
  };
  const ref = await addDoc(collection(db, COL), payload);
  return ref.id;
}

// Marca una exportación como implementada.
export async function markAiExportImplemented(exportId, userEmail) {
  const ref = doc(db, COL, exportId);
  await updateDoc(ref, {
    status: "implemented",
    implemented_at: serverTimestamp(),
    implemented_by: userEmail || ""
  });
}

import { db } from "./firebase.js";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc
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

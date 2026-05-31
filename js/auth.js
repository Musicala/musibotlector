import { auth } from "./firebase.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const AUTHORIZED_EMAILS = new Set([
  "alekcaballeromusic@gmail.com",
  "catalina.medinal.leal@gmail.com",
  "imusicala@gmail.com",
  "musicalaasesor@gmail.com",
]);

export function isAuthorized(email) {
  return AUTHORIZED_EMAILS.has((email || "").toLowerCase().trim());
}

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  if (!isAuthorized(result.user.email)) {
    await signOut(auth);
    throw Object.assign(new Error("unauthorized"), { code: "auth/unauthorized-email" });
  }
  return result;
}

export function logout() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

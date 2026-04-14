/**
 * Email/password sign-in. If already authenticated, go to dashboard.
 */

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "../shared/firebase.js";

const form = document.getElementById("loginForm");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const errorEl = document.getElementById("loginError");

onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.replace(new URL("index.html", import.meta.url));
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  try {
    await signInWithEmailAndPassword(
      auth,
      emailEl.value.trim(),
      passwordEl.value
    );
    window.location.replace(new URL("index.html", import.meta.url));
  } catch (err) {
    errorEl.textContent = err.message || String(err);
  }
});

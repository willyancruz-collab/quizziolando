import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCUWeazsDi86MRBZ07s6DlTs6_zpVwp8UU",
  authDomain: "quizziolando-20261104-rio.firebaseapp.com",
  projectId: "quizziolando-20261104-rio",
  storageBucket: "quizziolando-20261104-rio.firebasestorage.app",
  messagingSenderId: "731121284077",
  appId: "1:731121284077:web:7f7720e794acaadc7e2de4"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

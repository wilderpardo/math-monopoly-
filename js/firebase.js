import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAbciwwMFJaoVz7vNRvoyjOMSrmnDymWx4",
  authDomain: "trivia-monopoly.firebaseapp.com",
  projectId: "trivia-monopoly",
  storageBucket: "trivia-monopoly.firebasestorage.app",
  messagingSenderId: "756565156538",
  appId: "1:756565156538:web:0641fc8756a67ae32a5883"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
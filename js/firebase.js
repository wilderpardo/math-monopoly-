import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

// Esta configuración es pública por diseño. La seguridad real está en
// firestore.rules y en restringir la API key a tu dominio (ver LEEME.md).
const firebaseConfig = {
  apiKey: "AIzaSyCFqtpYZ5tdI0XW5sM3eymJfLOvYb6LWg0",
  authDomain: "juegocalculo-9077f.firebaseapp.com",
  projectId: "juegocalculo-9077f",
  storageBucket: "juegocalculo-9077f.firebasestorage.app",
  messagingSenderId: "1020125922330",
  appId: "1:1020125922330:web:c819fd83b33ec508f97da3"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Los estudiantes juegan sin cuenta: se les da una sesión anónima (persistente en
// el navegador). Devuelve el usuario (uid = identificador del jugador).
// Solo la usan las páginas del juego, nunca el panel de administración.
export function ensurePlayerAuth() {
    return new Promise((resolve, reject) => {
        const stop = onAuthStateChanged(auth, async user => {
            stop();
            if (user) return resolve(user);
            try { resolve((await signInAnonymously(auth)).user); } catch (e) { reject(e); }
        });
    });
}

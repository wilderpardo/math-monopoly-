import { loadAdminHints } from './admin-hints.js';
import { listenRoundState } from './admin-rounds.js';
import { db, auth } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { collection, addDoc, getDocs, deleteDoc, doc, onSnapshot, setDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// 🆕 AJUSTE #1: debe coincidir SIEMPRE con BOARD_SIZE definido en js/game.js,
// ya que ahí vive la fuente de verdad del tamaño del tablero.
const BOARD_SIZE = 32;

const loginScreen = document.getElementById("loginScreen");
const adminPanel = document.getElementById("adminPanel");

// --- AUTENTICACIÓN ADMIN ---
document.getElementById("btnLogin").addEventListener("click", () => {
    const email = document.getElementById("adminEmail").value;
    const pass = document.getElementById("adminPass").value;
    signInWithEmailAndPassword(auth, email, pass).catch(e => alert("Error de acceso: " + e.message));
});

onAuthStateChanged(auth, user => {
    if (user && !user.isAnonymous) { // las sesiones anónimas son de estudiantes, nunca del admin
        loginScreen.classList.remove("active");
        adminPanel.classList.add("active");
        loadQuestions();
        loadSurprises();
        listenPlayers();
        loadAdminHints().catch(() => {}); // El apartado de pistas muestra el motivo y permite recargar.
        listenRoundState();
    } else {
        loginScreen.classList.add("active");
        adminPanel.classList.remove("active");
    }
});

// --- GUARDAR PREGUNTAS DE TEXTO SIMPLE ---
document.getElementById("btnAddQuestion").addEventListener("click", async () => {
    const order = parseInt(document.getElementById("newQOrder").value) || 1;
    const text = document.getElementById("newQText").value.trim();
    const o1 = document.getElementById("newOpt1").value.trim();
    const o2 = document.getElementById("newOpt2").value.trim();
    const o3 = document.getElementById("newOpt3").value.trim();
    const o4 = document.getElementById("newOpt4").value.trim();
    const correct = parseInt(document.getElementById("newCorrect").value);

    if(!text || !o1 || !o2) return alert("Completa la pregunta y al menos dos opciones.");

    const options = [o1, o2, o3, o4].filter(x => x);

    await addDoc(collection(db, "questions"), {
        order, text, options, correctIndex: correct, type: "text", topic: document.getElementById("newQTopic").value.trim()
    });
    
    alert("Pregunta de texto guardada.");
    loadQuestions();
});

// --- LISTADO Y BORRADO DE PREGUNTAS ---
async function loadQuestions() {
    const qList = document.getElementById("questionsList");
    qList.innerHTML = "";
    const qQuery = query(collection(db, "questions"), orderBy("order", "asc"));
    const snapshot = await getDocs(qQuery);
    
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const li = document.createElement("li");
        let badge = data.type === "img_opts" ? "🖼️ Gráficas" : (data.mainImg ? "📈 Imagen" : "📝 Texto");
        const span = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = `[#${data.order}]`;
        span.append(strong, ` (${badge}) ${data.text}`);
        const del = document.createElement("button");
        del.className = "btn-delete"; del.dataset.id = docSnap.id; del.textContent = "Borrar";
        li.append(span, del);
        qList.appendChild(li);
    });
    
    document.querySelectorAll("#questionsList .btn-delete").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            if(confirm("¿Eliminar pregunta?")) {
                await deleteDoc(doc(db, "questions", e.target.getAttribute("data-id")));
                loadQuestions();
            }
        });
    });
}

// --- CARTAS SORPRESA ---
document.getElementById("btnAddSurprise").addEventListener("click", async () => {
    const text = document.getElementById("newSurpriseText").value.trim();
    if(!text) return alert("Escribe el texto de la sorpresa.");

    await addDoc(collection(db, "surprises"), { text });
    document.getElementById("newSurpriseText").value = "";
    loadSurprises();
});

async function loadSurprises() {
    const sList = document.getElementById("surprisesList");
    sList.innerHTML = "";
    const snapshot = await getDocs(collection(db, "surprises"));
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.textContent = `🎁 ${data.text}`;
        const del = document.createElement("button");
        del.className = "btn-delete"; del.dataset.id = docSnap.id; del.textContent = "Borrar";
        li.append(span, del);
        sList.appendChild(li);
    });
    
    document.querySelectorAll("#surprisesList .btn-delete").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            if(confirm("¿Eliminar sorpresa?")) {
                await deleteDoc(doc(db, "surprises", e.target.getAttribute("data-id")));
                loadSurprises();
            }
        });
    });
}

// --- MONITOREO DE POSICIONES EN TIEMPO REAL ---
function listenPlayers() {
    const list = document.getElementById("leaderboard");
    // 🆕 Ya no se ordena directamente en la consulta de Firestore: el orden final
    // combina dos criterios (orden de llegada + avance en el tablero), así que
    // se trae la lista completa y se ordena en JavaScript (ver más abajo).
    const q = collection(db, "players");
    
    onSnapshot(q, (snapshot) => {
        // Convierte el snapshot en un arreglo normal para poder ordenarlo
        const players = [];
        snapshot.forEach(docSnap => players.push(docSnap.data()));

        // ==========================================================================
        // 🆕 AJUSTE #4: ORDEN DE LA TABLA (ganadores arriba, en orden real de llegada;
        // el resto abajo, ordenado por cuánto han avanzado en el tablero)
        // ==========================================================================
        players.sort((a, b) => {
            const aFinished = a.status === "finished";
            const bFinished = b.status === "finished";
            if (aFinished && bFinished) {
                // Ambos ya llegaron: gana el que tenga el endTime más antiguo (llegó primero)
                return (a.endTime || 0) - (b.endTime || 0);
            }
            if (aFinished) return -1; // Los que ya llegaron siempre van antes que los que siguen jugando
            if (bFinished) return 1;
            // Ninguno ha llegado todavía: se ordenan por casilla actual (mayor avance primero)
            return (b.position || 0) - (a.position || 0);
        });

        list.innerHTML = "";
        let rankCounter = 0; // Cuenta solo a los jugadores que ya llegaron, para numerar 1º, 2º, 3º...
        const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };

        players.forEach(p => {
            const li = document.createElement("li");
            let posText;

            if (p.status === "finished") {
                // 🆕 En vez de un genérico "🏆 GANADOR" para todos, ahora se numera
                // el puesto real de llegada (1º, 2º, 3º...) con medalla para el podio
                rankCounter++;
                const medal = medals[rankCounter] || "🏅";
                posText = `${medal} Puesto #${rankCounter}`;
            } else if (p.position >= BOARD_SIZE) {
                posText = "🏁 EN LA META (pregunta final pendiente)";
            } else {
                posText = `Casilla: ${p.position}/${BOARD_SIZE}`;
            }
            
            const info = document.createElement("div");
            const nameEl = document.createElement("strong");
            nameEl.textContent = p.name; // el nickname lo escribe el estudiante: siempre como texto, nunca como HTML
            const ok = document.createElement("small"); ok.style.color = "var(--neon-green)"; ok.textContent = `✅ ${p.correctCount || 0}`;
            const bad = document.createElement("small"); bad.style.color = "var(--danger-red)"; bad.textContent = `❌ ${p.incorrectCount || 0}`;
            info.append(nameEl, document.createElement("br"), ok, " | ", bad);
            const pos = document.createElement("span");
            pos.style.cssText = "font-weight:bold; color:var(--primary-blue);";
            pos.textContent = posText;
            li.append(info, pos);
            list.appendChild(li);
        });
    });
}


import { db, auth } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { collection, addDoc, getDocs, deleteDoc, doc, onSnapshot, setDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// --- PARÁMETROS DE CONEXIÓN A CLOUDINARY ---
const CLOUD_NAME = "dzjcidzup"; 
const UPLOAD_PRESET = "math_game_preset";

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
    if (user) {
        loginScreen.classList.remove("active");
        adminPanel.classList.add("active");
        loadQuestions();
        loadSurprises();
        listenPlayers();
    } else {
        loginScreen.classList.add("active");
        adminPanel.classList.remove("active");
    }
});

// --- CONTROLES DE ESTADO DE LA PARTIDA ---
document.getElementById("btnStartGame").addEventListener("click", async () => {
    await setDoc(doc(db, "gameState", "main"), { status: "playing" });
    alert("¡Partida Iniciada!");
});

document.getElementById("btnResetGame").addEventListener("click", async () => {
    if(confirm("¿Reiniciar partida actual? Esto borrará el progreso de los jugadores.")) {
        await setDoc(doc(db, "gameState", "main"), { status: "waiting" });
        const snap = await getDocs(collection(db, "players"));
        snap.forEach(d => deleteDoc(doc(db, "players", d.id)));
        alert("Partida reiniciada correctamente.");
    }
});

// --- CONMUTAR VISTAS SEGÚN EL TIPO DE PREGUNTA SELECCIONADO ---
const gTypeSelect = document.getElementById("gType");
const wrapperMainImg = document.getElementById("wrapperMainImg");
const wrapperOptFiles = document.getElementById("wrapperOptFiles");
const wrapperOptText = document.getElementById("wrapperOptText");

gTypeSelect.addEventListener("change", () => {
    if (gTypeSelect.value === "img_opts") {
        wrapperMainImg.style.display = "none";
        wrapperOptFiles.style.display = "block";
        wrapperOptText.style.display = "none";
    } else {
        wrapperMainImg.style.display = "block";
        wrapperOptFiles.style.display = "none";
        wrapperOptText.style.display = "block";
    }
});

// --- FUNCIÓN PARA SUBIR UN ARCHIVO DIRECTO A CLOUDINARY ---
async function uploadToCloudinary(fileInput) {
    if (!fileInput.files || fileInput.files.length === 0) return null;
    
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append("upload_preset", UPLOAD_PRESET);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
        method: "POST",
        body: formData
    });
    
    if (!res.ok) throw new Error("Falló la subida de una imagen a Cloudinary");
    const data = await res.json();

    // 🆕 FIX: fuerza a Cloudinary a entregar la imagen en un formato compatible
    // con CUALQUIER celular (por ejemplo, convierte automáticamente fotos HEIC
    // de iPhone a JPG/PNG según lo que mejor soporte cada navegador). Antes,
    // si alguien subía una foto en HEIC, se veía bien en iPhone pero en Android
    // aparecía solo el texto "Gráfica" porque la imagen no cargaba.
    return data.secure_url.replace("/upload/", "/upload/f_auto,q_auto/");
}

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
        order, text, options, correctIndex: correct, type: "text"
    });
    
    alert("Pregunta de texto guardada.");
    loadQuestions();
});

// --- GUARDAR PREGUNTA DE GRÁFICA CON SUBIDA AUTOMÁTICA DE IMÁGENES ---
document.getElementById("btnAddGraphQ").addEventListener("click", async () => {
    const btn = document.getElementById("btnAddGraphQ");
    btn.disabled = true;
    btn.innerText = "Subiendo imágenes a Cloudinary...";

    try {
        const order = parseInt(document.getElementById("gOrder").value) || 1;
        const text = document.getElementById("gText").value.trim();
        const type = gTypeSelect.value;
        const correct = parseInt(document.getElementById("gCorrect").value);

        if (!text) throw new Error("Ingresa el enunciado de la pregunta.");

        let mainImgUrl = null;
        let options = [];

        if (type === "text_opts") {
            // Modo A: Sube la imagen principal y toma los textos
            mainImgUrl = await uploadToCloudinary(document.getElementById("gMainImgFile"));
            options = [
                document.getElementById("gOpt1").value.trim(),
                document.getElementById("gOpt2").value.trim(),
                document.getElementById("gOpt3").value.trim(),
                document.getElementById("gOpt4").value.trim()
            ].filter(x => x);
        } else {
            // Modo B: Sube las 4 imágenes seleccionadas en los inputs independientes
            const file1 = await uploadToCloudinary(document.getElementById("gOptFile1"));
            const file2 = await uploadToCloudinary(document.getElementById("gOptFile2"));
            const file3 = await uploadToCloudinary(document.getElementById("gOptFile3"));
            const file4 = await uploadToCloudinary(document.getElementById("gOptFile4"));

            options = [file1, file2, file3, file4].filter(x => x !== null);
            if (options.length < 2) throw new Error("Debes subir al menos 2 imágenes para las opciones.");
        }

        await addDoc(collection(db, "questions"), {
            order, text, type, mainImg: mainImgUrl, options, correctIndex: correct
        });

        alert("¡Pregunta e imágenes procesadas y guardadas!");
        loadQuestions();
    } catch (err) {
        alert("Atención: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "Subir a Cloudinary y Guardar Pregunta";
    }
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
        li.innerHTML = `<span><strong>[#${data.order}]</strong> (${badge}) ${data.text}</span> <button class="btn-delete" data-id="${docSnap.id}">Borrar</button>`;
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
        li.innerHTML = `<span>🎁 ${data.text}</span> <button class="btn-delete" data-id="${docSnap.id}">Borrar</button>`;
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
            
            li.innerHTML = `
                <div>
                    <strong>${p.name}</strong><br>
                    <small style="color:var(--neon-green)">✅ ${p.correctCount || 0}</small> | 
                    <small style="color:var(--danger-red)">❌ ${p.incorrectCount || 0}</small>
                </div>
                <span style="font-weight:bold; color:var(--primary-blue);">${posText}</span>
            `;
            list.appendChild(li);
        });
    });
}
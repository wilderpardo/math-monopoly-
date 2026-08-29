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
    return data.secure_url; // Obtiene el link HTTPS asignado por Cloudinary
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
    const q = query(collection(db, "players"), orderBy("position", "desc"));
    
    onSnapshot(q, (snapshot) => {
        list.innerHTML = "";
        snapshot.forEach(doc => {
            const p = doc.data();
            const li = document.createElement("li");
            // 🆕 AJUSTE #2/#3: llegar a la última casilla ya no es victoria automática
            // (el jugador debe responder primero la pregunta final), por eso ahora
            // se distingue "en la meta, pendiente de la pregunta final" de "ganador confirmado"
            // usando el campo status, en vez de asumir victoria solo por la posición.
            let posText;
            if (p.status === "finished") {
                posText = "🏆 GANADOR";
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
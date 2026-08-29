import { db } from "./firebase.js";
import { doc, setDoc, onSnapshot, getDocs, collection, updateDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// --- IDENTIFICADOR DEL JUGADOR EN LOCALSTORAGE ---
let playerId = localStorage.getItem("playerId") || "p_" + Math.random().toString(36).substr(2, 9);
localStorage.setItem("playerId", playerId);

let playerName = "";
let currentPos = 0;
let previousPos = 0; // Guardará la posición exacta antes del lanzamiento
let questions = [];
let surprises = [];
let playerQIndex = 0;
let correctCount = 0;
let incorrectCount = 0;

// ==========================================================================
// 🆕 AJUSTE #1: TABLERO AMPLIADO
// ==========================================================================
// BOARD_SIZE define el total de casillas del recorrido (antes era fijo en 24).
// Debe ser múltiplo de 4 para poder repartirse en 4 lados iguales de un
// tablero cuadrado perimetral. Puedes cambiar este único valor (28, 32, etc.)
// y todo el tablero (grid, esquinas, casillas sorpresa) se recalcula solo.
const BOARD_SIZE = 32;

// GRID_N = dimensión (N x N) de la cuadrícula CSS necesaria para que el
// perímetro tenga BOARD_SIZE casillas: perímetro = 4 * (N - 1) => N = BOARD_SIZE/4 + 1
const GRID_N = BOARD_SIZE / 4 + 1;

// Longitud de cada uno de los 4 lados del recorrido
const SIDE_LENGTH = GRID_N - 1;

// Las 4 esquinas del recorrido (posiciones 0, lado, 2*lado, 3*lado)
const CORNER_CELLS = [0, SIDE_LENGTH, 2 * SIDE_LENGTH, 3 * SIDE_LENGTH];

// Las 4 casillas "sorpresa" (🎁): se ubican 2 casillas antes de cada esquina
// (esquina_siguiente - 2, con acomodo circular), igual proporción que el original
const SPECIAL_CELLS = [1, 2, 3, 4].map(i => (i * SIDE_LENGTH - 2 + BOARD_SIZE) % BOARD_SIZE);

// 🏁 Bandera: indica si la pregunta actualmente mostrada es la PREGUNTA FINAL de la meta
let isFinalQuestion = false;

// --- ELEMENTOS DEL DOM ---
const screenLobby = document.getElementById("lobby");
const screenWaiting = document.getElementById("waiting");
const screenGame = document.getElementById("game");

const board = document.getElementById("board");
const btnJoin = document.getElementById("btnJoin");
const btnRoll = document.getElementById("btnRoll");
const cube = document.getElementById("cube");

const modalQuestion = document.getElementById("modalQuestion");
const qOptions = document.getElementById("qOptions");
const qText = document.getElementById("qText");
const qMainImg = document.getElementById("qMainImg");

const modalSurprise = document.getElementById("modalSurprise");
const surpriseText = document.getElementById("surpriseText");
const btnSurpriseContinue = document.getElementById("btnSurpriseContinue");

const modalResult = document.getElementById("modalResult");
const resultText = document.getElementById("resultText");
const btnContinue = document.getElementById("btnContinue");
const modalWinner = document.getElementById("modalWinner");

const cellMap = []; 

// --- 🆕 GENERADOR GENÉRICO DEL RECORRIDO PERIMETRAL (antes hardcodeado a 7x7/24) ---
// Recorre el perímetro de una cuadrícula N x N en sentido horario, empezando
// en la esquina superior izquierda. Funciona para cualquier GRID_N, por lo
// que el tablero se adapta automáticamente al nuevo BOARD_SIZE.
function getPerimeterOrder(n) {
    const order = [];
    // Lado superior: izquierda -> derecha (incluye ambas esquinas superiores)
    for (let col = 0; col < n; col++) order.push(0 * n + col);
    // Lado derecho: de arriba hacia abajo (sin repetir la esquina ya contada)
    for (let row = 1; row < n; row++) order.push(row * n + (n - 1));
    // Lado inferior: de derecha a izquierda (sin repetir la esquina ya contada)
    for (let col = n - 2; col >= 0; col--) order.push((n - 1) * n + col);
    // Lado izquierdo: de abajo hacia arriba (sin repetir ninguna esquina)
    for (let row = n - 2; row >= 1; row--) order.push(row * n + 0);
    return order;
}

// --- RUTA Y DIBUJO DEL TABLERO PERIMETRAL (dimensión GRID_N x GRID_N) ---
function buildBoard() {
    // 🆕 Se expone GRID_N como variable CSS para que style.css dibuje una
    // cuadrícula del tamaño correcto sin tener que tocar el CSS a mano.
    board.style.setProperty("--grid-n", GRID_N);

    for (let i = 0; i < GRID_N * GRID_N; i++) {
        let div = document.createElement("div");
        div.style.visibility = "hidden";
        board.appendChild(div);
    }
    const order = getPerimeterOrder(GRID_N);
    order.forEach((gridIndex, pos) => {
        let cell = board.children[gridIndex];
        cell.style.visibility = "visible";
        cell.className = "cell";
        
        if (CORNER_CELLS.includes(pos)) {
            cell.classList.add("corner");
        }
        if (SPECIAL_CELLS.includes(pos)) {
            cell.classList.add("special");
            cell.innerText = "🎁";
        } else {
            cell.innerText = pos;
        }
        cellMap[pos] = cell;
    });

    // 🆕 Refleja el total real de casillas en el encabezado (antes decía "/24" fijo)
    const displayTotalEl = document.getElementById("displayTotal");
    if (displayTotalEl) displayTotalEl.innerText = BOARD_SIZE;
}

// --- CONEXIÓN DE JUGADOR ---
btnJoin.addEventListener("click", async () => {
    playerName = document.getElementById("playerName").value.trim();
    if(!playerName) return alert("Ingresa tu nickname");
    
    await setDoc(doc(db, "players", playerId), {
        name: playerName,
        position: 0,
        correctCount: 0,
        incorrectCount: 0,
        status: "waiting",
        timestamp: Date.now()
    });
    
    screenLobby.classList.remove("active");
    screenWaiting.classList.add("active");
    
    // Transición automática al iniciar la partida desde el panel Admin
    onSnapshot(doc(db, "gameState", "main"), (docSnap) => {
        if (docSnap.exists() && docSnap.data().status === "playing") {
            screenWaiting.classList.remove("active");
            screenGame.classList.add("active");
            document.getElementById("displayName").innerText = playerName;
            btnRoll.disabled = false;
            loadGameData();
        } else {
            screenGame.classList.remove("active");
            screenWaiting.classList.add("active");
        }
    });
    
    setTimeout(() => updateTokenPosition(0), 100);
});

// --- CARGA DE DATOS ORDENADOS ---
async function loadGameData() {
    const qQuery = query(collection(db, "questions"), orderBy("order", "asc"));
    const qSnap = await getDocs(qQuery);
    questions = [];
    qSnap.forEach((doc) => questions.push(doc.data()));

    const sSnap = await getDocs(collection(db, "surprises"));
    surprises = [];
    sSnap.forEach((doc) => surprises.push(doc.data()));
}

// --- ACTUALIZACIÓN DE FICHA DE JUGADOR ---
let tokenEl = null;
function updateTokenPosition(pos) {
    // 🆕 24/23 -> BOARD_SIZE (límite dinámico según el tamaño real del tablero)
    if(pos > BOARD_SIZE - 1) pos = BOARD_SIZE;
    document.getElementById("displayPos").innerText = pos;
    
    if (!tokenEl) {
        tokenEl = document.createElement("div");
        tokenEl.className = "token";
        document.body.appendChild(tokenEl);
    }
    if(pos < BOARD_SIZE) {
        const rect = cellMap[pos].getBoundingClientRect();
        tokenEl.style.left = (rect.left + rect.width / 2) + "px";
        tokenEl.style.top = (rect.top + rect.height / 2) + "px";
    }
}

// --- LANZAMIENTO DE UN SOLO DADO 3D ---
btnRoll.addEventListener("click", async () => {
    btnRoll.disabled = true;
    previousPos = currentPos; // Almacena la posición origen antes de rodar
    
    let roll = Math.floor(Math.random() * 6) + 1; // 🎲 1 SOLO DADO
    
    const rotations = {
        1: "rotateX(0deg) rotateY(0deg)",
        2: "rotateX(0deg) rotateY(-90deg)",
        3: "rotateX(0deg) rotateY(-180deg)",
        4: "rotateX(0deg) rotateY(90deg)",
        5: "rotateX(-90deg) rotateY(0deg)",
        6: "rotateX(90deg) rotateY(0deg)"
    };
    
    let extraX = (Math.floor(Math.random() * 3) + 2) * 360;
    let extraY = (Math.floor(Math.random() * 3) + 2) * 360;
    
    cube.style.transform = `rotateX(${extraX}deg) rotateY(${extraY}deg)`;
    
    setTimeout(() => {
        cube.style.transform = rotations[roll];
        setTimeout(() => movePlayer(roll), 1200);
    }, 100);
});

// --- DESPLAZAMIENTO Y REGLAS DE CASILLA ---
async function movePlayer(roll) {
    currentPos += roll;
    // 🆕 "won" -> "reachedGoal": llegar a la última casilla ya NO es victoria automática,
    // ahora solo significa que el jugador debe responder la pregunta final obligatoria.
    let reachedGoal = false;
    if (currentPos >= BOARD_SIZE) {
        currentPos = BOARD_SIZE;
        reachedGoal = true;
    }
    updateTokenPosition(currentPos);
    await updateDoc(doc(db, "players", playerId), { position: currentPos });
    
    if (reachedGoal) {
        // 🆕 AJUSTE #2: en vez de mostrar el modal de victoria de inmediato,
        // se dispara la pregunta final dinámica. La victoria solo se declara
        // si esa pregunta se responde correctamente (ver verifyAnswer).
        showFinalQuestion();
    } else {
        if (SPECIAL_CELLS.includes(currentPos)) { // 🆕 antes: [4,10,16,22] fijos
            triggerSurprise();
        } else {
            showNextQuestion();
        }
    }
}

// ==========================================================================
// 🆕 AJUSTE #2: PREGUNTA FINAL DINÁMICA EN LA META
// ==========================================================================
// La pregunta que se exige en la meta corresponde al "contador de preguntas
// respondidas correctamente + 1": si el jugador ya avanzó respondiendo bien
// N preguntas (playerQIndex === N), la meta le exige la pregunta N+1, que es
// justamente questions[playerQIndex] (índice base 0 = pregunta N+1 en el
// conteo humano). Por eso basta con reutilizar showNextQuestion(), que ya
// selecciona la pregunta según playerQIndex; solo marcamos que es la final.
function showFinalQuestion() {
    isFinalQuestion = true;
    showNextQuestion();
}

// ==========================================================================
// 🆕 AJUSTE #4: PUESTO DE LLEGADA (1º, 2º, 3º...)
// ==========================================================================
// Calcula en qué puesto llegó ESTE jugador comparando su hora de finalización
// (myEndTime) contra la de todos los demás jugadores que ya terminaron.
// Como cada jugador guarda su propio "endTime" al ganar, el orden de llegada
// real es simplemente ordenar esas horas de menor a mayor.
async function getFinishRank(myEndTime) {
    const snap = await getDocs(collection(db, "players"));
    const finishedTimes = [];
    snap.forEach((d) => {
        const p = d.data();
        if (p.status === "finished" && p.endTime) finishedTimes.push(p.endTime);
    });
    finishedTimes.sort((a, b) => a - b); // De más antiguo (llegó primero) a más reciente
    return finishedTimes.indexOf(myEndTime) + 1; // +1 porque el array empieza en índice 0
}

// Traduce el número de puesto a un texto amigable con medalla
function getRankLabel(rank) {
    const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
    const medal = medals[rank] || "🏅";
    return `${medal} ¡Llegaste en el puesto #${rank}!`;
}

function triggerSurprise() {
    if (surprises.length === 0) {
        showNextQuestion();
        return;
    }
    const randomSurprise = surprises[Math.floor(Math.random() * surprises.length)];
    surpriseText.innerText = randomSurprise.text;
    modalSurprise.classList.add("active");
}

btnSurpriseContinue.addEventListener("click", () => {
    modalSurprise.classList.remove("active");
    btnRoll.disabled = false;
});

// --- VISTA DE TARJETA DE PREGUNTA ---
function showNextQuestion() {
    if(questions.length === 0) {
        btnRoll.disabled = false;
        return;
    }
    // Mantiene asignada la pregunta en playerQIndex
    const q = questions[playerQIndex % questions.length];

    // 🆕 Indicador visual cuando esta es la pregunta final obligatoria de la meta
    qText.innerText = (isFinalQuestion ? "🏁 PREGUNTA FINAL: " : "") + q.text;
    qOptions.innerHTML = "";
    
    if(q.mainImg) {
        qMainImg.src = q.mainImg;
        qMainImg.style.display = "block";
    } else {
        qMainImg.style.display = "none";
    }

    if(q.type === "img_opts") {
        qOptions.className = "options-grid";
        q.options.forEach((optImgUrl, index) => {
            const btn = document.createElement("button");
            btn.className = "img-option-btn";
            btn.innerHTML = `<img src="${optImgUrl}" alt="Opción ${index+1}"><span>Opción ${index+1}</span>`;
            btn.onclick = () => verifyAnswer(index === q.correctIndex);
            qOptions.appendChild(btn);
        });
    } else {
        qOptions.className = "options-container";
        q.options.forEach((opt, index) => {
            const btn = document.createElement("button");
            btn.innerText = opt;
            btn.onclick = () => verifyAnswer(index === q.correctIndex);
            qOptions.appendChild(btn);
        });
    }
    
    modalQuestion.classList.add("active");
}

// --- EVALUACIÓN DE RESPUESTA Y LÓGICA DE REPETICIÓN POR ERROR ---
async function verifyAnswer(isCorrect) {
    modalQuestion.classList.remove("active");

    // ==========================================================================
    // 🆕 AJUSTE #3: LÓGICA DE RESPUESTA EN LA META (pregunta final)
    // ==========================================================================
    if (isFinalQuestion) {
        isFinalQuestion = false; // Se resuelve el estado especial tanto si acierta como si falla

        if (isCorrect) {
            correctCount++;
            playerQIndex++; // Mantiene consistente el conteo de preguntas avanzadas

            // 🆕 Se guarda la hora exacta de finalización en una variable propia
            // (myEndTime) para poder identificarla luego al calcular el puesto.
            const myEndTime = Date.now();

            await updateDoc(doc(db, "players", playerId), {
                position: currentPos,
                correctCount,
                incorrectCount,
                status: "finished",
                endTime: myEndTime
            });

            // 🆕 AJUSTE #4: calcula el puesto de llegada y lo muestra en el modal de victoria
            const rank = await getFinishRank(myEndTime);
            const rankTextEl = document.getElementById("rankText");
            if (rankTextEl) rankTextEl.innerText = getRankLabel(rank);

            // ✅ Solo AHORA, tras responder correctamente la pregunta final, se declara la victoria
            modalWinner.classList.add("active");
        } else {
            incorrectCount++;

            // Se ejecuta la MISMA lógica existente de respuesta incorrecta:
            // retrocede a la casilla origen anterior y deberá volver a llegar a la meta
            currentPos = previousPos;
            updateTokenPosition(currentPos);

            resultText.innerText = `¡INCORRECTO! ❌\nRegresas a la casilla ${currentPos}. Deberás volver a llegar a la meta y responder la pregunta final nuevamente.`;
            resultText.style.color = "var(--danger-red)";

            await updateDoc(doc(db, "players", playerId), {
                position: currentPos,
                correctCount,
                incorrectCount
            });

            modalResult.classList.add("active");
        }
        return; // Se corta aquí: no debe ejecutarse la lógica de preguntas normales de abajo
    }

    // --- LÓGICA ORIGINAL PARA PREGUNTAS NORMALES (sin cambios) ---
    if (isCorrect) {
        correctCount++;
        resultText.innerText = "¡RESPUESTA CORRECTA! 🎯";
        resultText.style.color = "var(--neon-green)";
        
        // 🎯 SOLO AVANZA A LA SIGUIENTE PREGUNTA SI LA RESPUESTA ES CORRECTA
        playerQIndex++;
    } else {
        incorrectCount++;
        
        // Retrocede en el tablero a la casilla origen anterior
        currentPos = previousPos;
        updateTokenPosition(currentPos);
        
        // 🚨 EL ÍNDICE playerQIndex NO INCREMENTA -> REPETIRÁ LA PREGUNTA EN EL SIGUIENTE TURNO
        resultText.innerText = `¡INCORRECTO! ❌\nRegresas a la casilla ${currentPos}. Tendrás que responder esta pregunta nuevamente en tu próximo turno.`;
        resultText.style.color = "var(--danger-red)";
    }

    await updateDoc(doc(db, "players", playerId), {
        position: currentPos,
        correctCount,
        incorrectCount
    });

    modalResult.classList.add("active");
}

btnContinue.addEventListener("click", () => {
    modalResult.classList.remove("active");
    btnRoll.disabled = false;
});

window.addEventListener("resize", () => {
    // 🆕 23 -> BOARD_SIZE - 1
    if(screenGame.classList.contains("active")) updateTokenPosition(Math.min(currentPos, BOARD_SIZE - 1));
});

buildBoard();
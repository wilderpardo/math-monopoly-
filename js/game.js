import { db, ensurePlayerAuth } from "./firebase.js";
import { track, ctxInfo, flushTracking } from "./analytics.js";
import { hintAccessMessage } from './hint-access.js';
import { doc, setDoc, getDoc, deleteDoc, onSnapshot, getDocs, collection, updateDoc, query, orderBy, where, runTransaction } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// ==========================================================================
// FONDOS Y DADOS (uno por estudiante, se elige en el lobby)
// ==========================================================================
// Cada fondo trae su propio dado: cambia la FORMA y el RANGO (sides), no solo el
// aspecto. Para ajustar el ritmo del juego basta con cambiar "sides" aquí.
//   classic : cubo 3D, d6  (1-6)  -> ritmo original
//   volcano : cristal de obsidiana, d8 (1-8) -> más rápido y más arriesgado
//   nature  : hoja, d4 (1-4) -> más lento y seguro
const THEMES = {
    classic: { label: "Clásico", sides: 6 },
    volcano: { label: "Volcán", sides: 8 },
    nature:  { label: "Naturaleza", sides: 4 }
};
let theme = localStorage.getItem("theme");
if (!THEMES[theme]) theme = "classic";
function applyTheme(t) {
    theme = THEMES[t] ? t : "classic";
    localStorage.setItem("theme", theme);
    document.body.dataset.theme = theme;
    const worldTitle=document.getElementById('gameWorld');if(worldTitle)worldTitle.textContent=theme==='volcano'?'Mesa de obsidiana':theme==='nature'?'El claro del bosque':'La mesa clásica';
    ctxInfo.theme = theme;
    ctxInfo.sides = THEMES[theme].sides;
    const cubeScene = document.querySelector(".scene-dice"), shapeDie = document.getElementById("shapeDie");
    if (cubeScene && shapeDie) { cubeScene.style.display = THEMES[theme].sides === 6 ? "" : "none"; shapeDie.style.display = THEMES[theme].sides === 6 ? "none" : "flex"; shapeDie.dataset.sides = THEMES[theme].sides; buildPolyhedron(shapeDie, THEMES[theme].sides); shapeDie.firstElementChild.textContent = "?"; }
    document.querySelectorAll("[data-theme-pick]").forEach(b => b.classList.toggle("active", b.dataset.themePick === theme));
    const txt = document.getElementById("btnRoll");
    if (txt) txt.textContent = `Lanzar dado (d${THEMES[theme].sides})`;
}

// --- IDENTIFICADOR DEL JUGADOR: sesión anónima de Firebase (sin cuenta, sin datos personales) ---
let playerId = null;
let authReady = false, joined = false;
let presentationId=null,answerLocked=false,hintsUsedNow=0,hintStep=0,currentHint=null;
let questionShownAt = 0, playStartAt = null, currentQ = null;
const attempts = {};

let roundActive = false;
let roundEpoch = 0;
let activeEnrollment = Promise.resolve();
let retryClose = null;
const gameWrites = new Set();
async function savePlayer(data) {
    if(data.attempts){try{localStorage.setItem('math-attempts:'+playerId+':'+ctxInfo.roundId,JSON.stringify(data.attempts));}catch{} }
    const {attempts:localAttempts,...fields}=data;
    const job = updateDoc(doc(db, "players", playerId), fields);
    gameWrites.add(job);
    try { await job; } finally { gameWrites.delete(job); }
}
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
            cell.innerText = "✦"; cell.setAttribute("aria-label", "Casilla sorpresa");
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
    if(!authReady) return alert("Todavía se está conectando. Espera un momento e inténtalo de nuevo.");
    if(joined) return;
    playerName = document.getElementById("playerName").value.trim().slice(0, 20);
    if(!playerName) return alert("Ingresa tu nickname");
    joined = true;
    ctxInfo.name = playerName;

    
    try {
        const existing = await getDoc(doc(db, 'players', playerId));
        if (existing.exists()) await updateDoc(doc(db, 'players', playerId), { name:playerName, theme });
        else await setDoc(doc(db, "players", playerId), {
            name: playerName,
            position: 0,
            correctCount: 0,
            incorrectCount: 0,
            status: "waiting",
            timestamp: Date.now(),
            roundId: null,
            theme
        });
    } catch (e) {
        joined = false;
        return alert("No se pudo registrar tu nickname. Recarga la página e inténtalo de nuevo.");
    }
    
    track('join');
    screenLobby.classList.remove("active");
    screenWaiting.classList.add("active");
    
    // Transición automática al iniciar la partida desde el panel Admin
    onSnapshot(doc(db, "gameState", "main"), (docSnap) => {
        if (docSnap.exists() && docSnap.data().status === "playing") {
            const nextRound=docSnap.data().roundId || null;
            if(ctxInfo.roundId===nextRound)return;
            ctxInfo.roundId=nextRound;ctxInfo.roundLabel=String(docSnap.data().label||'').slice(0,40);
            const epoch=++roundEpoch;
            btnRoll.disabled=true;
            activeEnrollment=(async()=>{
                let p,resume;
                await runTransaction(db,async tx=>{
                    const state=(await tx.get(doc(db,'gameState','main'))).data();
                    const snap=await tx.get(doc(db,'players',playerId));
                    if(state?.status!=='playing' || state.roundId!==nextRound)throw new Error('La partida ya no admite ingresos.');
                    const prior=snap.data()||{};resume=prior.roundId===nextRound;
                    p=resume?{...prior,name:playerName,theme}:{name:playerName,position:0,correctCount:0,incorrectCount:0,status:'playing',timestamp:Date.now(),roundId:nextRound,theme};
                    tx.set(doc(db,'players',playerId),p);
                });
                // These events belong to the round, including players who joined the lobby earlier.
                track('visit',{roundId:nextRound});
                track('join',{roundId:nextRound,code:resume?'rejoin':'join'});
                if(epoch!==roundEpoch)return;
                currentPos=p.position||0;previousPos=currentPos;correctCount=p.correctCount||0;incorrectCount=p.incorrectCount||0;playerQIndex=correctCount;playStartAt=p.timestamp||Date.now();
                Object.keys(attempts).forEach(k=>delete attempts[k]);
                try{Object.assign(attempts,JSON.parse(localStorage.getItem('math-attempts:'+playerId+':'+nextRound)||'{}'));}catch{}
                isFinalQuestion=false;currentQ=null;
                document.querySelectorAll('.modal').forEach(el=>el.classList.remove('active'));
                await loadGameData();if(epoch!==roundEpoch)return;
                roundActive=true;
                screenWaiting.classList.remove('active');screenGame.classList.add('active');
                updateTokenPosition(currentPos);document.getElementById('displayName').textContent=playerName;
                btnRoll.disabled=p.status==='finished';
                if(p.status==='finished')modalWinner.classList.add('active');
            })();
            activeEnrollment.catch(e=>{ctxInfo.roundId=null;roundActive=false;document.querySelector('#waiting h2').textContent='No se pudo ingresar a la partida: '+e.message;});
        } else {
            roundActive = false;
            roundEpoch++;
            btnRoll.disabled = true;
            document.querySelectorAll('.modal').forEach(el => el.classList.remove('active'));
            if (tokenEl) tokenEl.style.display = 'none';
            const state = docSnap.data() || {};
            if (state.status === 'closing') {
                const closedRound=state.roundId;
                document.querySelector('#waiting h2').textContent='Partida detenida. Guardando tus datos…';
                retryClose=async()=>{
                  try {
                    await activeEnrollment;
                    const player=(await getDoc(doc(db,'players',playerId))).data();
                    if(player?.roundId!==closedRound)return;
                    await Promise.all([...gameWrites]);
                    await flushTracking();
                    await track('visibility',{state:'round_closed',roundId:closedRound,roundLabel:state.label||'',pos:player.position||0});
                    document.querySelector('#waiting h2').textContent='Tus datos se guardaron correctamente.';
                    document.getElementById('btnRetrySave').hidden=true;
                  } catch(e) {document.querySelector('#waiting h2').textContent='Hay datos pendientes: '+e.message;document.getElementById('btnRetrySave').hidden=false;}
                };
                retryClose();
            } else {retryClose=null;document.getElementById('btnRetrySave').hidden=true;document.querySelector('#waiting h2').textContent=state.status==='ended'?'Partida finalizada.':'Esperando al profesor…';}
            if (state.status !== "closing") { ctxInfo.roundId=null;ctxInfo.roundLabel="";playStartAt=null; }
            screenGame.classList.remove("active");
            screenWaiting.classList.add("active");
        }
    });

    

});

// --- CARGA DE DATOS ORDENADOS ---
async function loadGameData() {
    const qQuery = query(collection(db, "questions"), orderBy("order", "asc"));
    const qSnap = await getDocs(qQuery);
    questions = [];
    qSnap.forEach((d) => questions.push({ id: d.id, ...d.data() }));

    const sSnap = await getDocs(collection(db, "surprises"));
    surprises = [];
    sSnap.forEach((doc) => surprises.push(doc.data()));
}

// --- ACTUALIZACIÓN DE FICHA DE JUGADOR ---
let tokenEl = null;
function updateTokenPosition(pos) {
    if (tokenEl) tokenEl.style.display = roundActive ? "" : "none";
    // 🆕 24/23 -> BOARD_SIZE (límite dinámico según el tamaño real del tablero)
    if(pos > BOARD_SIZE - 1) pos = BOARD_SIZE;
    document.getElementById("displayPos").innerText = pos;
    cellMap.forEach((cell,index)=>cell.classList.toggle('cell-current',index===pos));
    
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

// --- LANZAMIENTO DEL DADO DEL FONDO ELEGIDO (d6 cubo 3D / d8 obsidiana / d4 hoja) ---
btnRoll.addEventListener("click", async () => {
    if (!roundActive) return;
    const epoch = roundEpoch;
    btnRoll.disabled = true;
    previousPos = currentPos; // Almacena la posición origen antes de rodar
    
    const sides = THEMES[theme].sides;
    let roll = Math.floor(Math.random() * sides) + 1;
    track("roll", { roll, from: currentPos });

    if (sides !== 6) {
        // Dado de forma distinta: gira y muestra números al azar hasta caer en el resultado
        const die = document.getElementById("shapeDie"), num = die.firstElementChild;
        die.classList.remove('rolling');void die.offsetWidth;
        die.style.setProperty('--spin-x', (720+Math.floor(Math.random()*3)*360)+'deg');
        die.style.setProperty('--spin-y', (1080+Math.floor(Math.random()*3)*360)+'deg');
        die.style.setProperty('--start-y', die.dataset.lastAngle || '0deg');
        die.style.setProperty('--start-x',die.dataset.lastPitch || '-54.7356deg');
        const landedY=(-((roll-1)%4)*90)+'deg';
        die.style.setProperty('--land-y',landedY);die.dataset.lastAngle=landedY;
        const landedX=sides===8 && roll>4?'54.7356deg':'-54.7356deg';
        die.style.setProperty('--land-x',landedX);die.dataset.lastPitch=landedX;
        die.classList.add('rolling');
        const flick = setInterval(() => { num.textContent = Math.floor(Math.random() * sides) + 1; }, 90);
        setTimeout(() => {
            clearInterval(flick);
            num.textContent = roll;
            die.setAttribute('aria-label',`Resultado del dado de ${sides} caras: ${roll}`);
            die.classList.remove("rolling");
            setTimeout(() => { if (roundActive && epoch === roundEpoch) movePlayer(roll); }, 600);
        }, 1900);
        return;
    }
    
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
        setTimeout(() => { if (roundActive && epoch === roundEpoch) movePlayer(roll); }, 1200);
    }, 100);
});

// --- DESPLAZAMIENTO Y REGLAS DE CASILLA ---
async function movePlayer(roll) {
    if (!roundActive) return;
    currentPos += roll;
    // 🆕 "won" -> "reachedGoal": llegar a la última casilla ya NO es victoria automática,
    // ahora solo significa que el jugador debe responder la pregunta final obligatoria.
    let reachedGoal = false;
    if (currentPos >= BOARD_SIZE) {
        currentPos = BOARD_SIZE;
        reachedGoal = true;
    }
    updateTokenPosition(currentPos);
    const epoch = roundEpoch;
    await savePlayer({ position: currentPos });
    if (!roundActive || epoch !== roundEpoch) return;
    
    if (reachedGoal) {
        // 🆕 AJUSTE #2: en vez de mostrar el modal de victoria de inmediato,
        // se dispara la pregunta final dinámica. La victoria solo se declara
        // si esa pregunta se responde correctamente (ver verifyAnswer).
        track("reached_goal");
        showFinalQuestion();
    } else {
        if (SPECIAL_CELLS.includes(currentPos)) { // 🆕 antes: [4,10,16,22] fijos
            track("surprise", { pos: currentPos });
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
    // Solo cuentan los jugadores que terminaron EN ESTA PARTIDA
    const snap = await getDocs(query(collection(db, "players"), where("roundId", "==", ctxInfo.roundId)));
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
    btnRoll.disabled = !roundActive;
});

// --- VISTA DE TARJETA DE PREGUNTA ---
function showNextQuestion() {
    if (!roundActive) return;
    if(questions.length === 0) {
        btnRoll.disabled = false;
        return;
    }
    // Mantiene asignada la pregunta en playerQIndex
    const q = questions[playerQIndex % questions.length];
    currentQ=q;questionShownAt=Date.now();answerLocked=false;presentationId=crypto.randomUUID();
    hintsUsedNow=0;hintStep=0;currentHint=null;resetHintUI();
    track('question_shown',{qid:q.id,order:q.order??null,topic:q.topic||'',qType:q.type||'text',presentationId,pos:currentPos,isFinal:isFinalQuestion});

    // 🆕 Indicador visual cuando esta es la pregunta final obligatoria de la meta
    qText.textContent = (isFinalQuestion ? "🏁 PREGUNTA FINAL: " : "") + q.text;
    qOptions.innerHTML = "";
    
    if(safeImgUrl(q.mainImg)) {
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
            const img = document.createElement("img");
            if (safeImgUrl(optImgUrl)) img.src = optImgUrl;
            img.alt = `Opción ${index+1}`;
            const label = document.createElement("span");
            label.textContent = `Opción ${index+1}`;
            btn.append(img, label);
            btn.onclick = () => verifyAnswer(index === q.correctIndex, index);
            qOptions.appendChild(btn);
        });
    } else {
        qOptions.className = "options-container";
        q.options.forEach((opt, index) => {
            const btn = document.createElement("button");
            btn.textContent = opt;
            btn.onclick = () => verifyAnswer(index === q.correctIndex, index);
            qOptions.appendChild(btn);
        });
    }
    
    modalQuestion.classList.add("active");
}

// Solo se aceptan imágenes https o data:image (evita javascript: y otros esquemas)
function safeImgUrl(u) {
    return typeof u === "string" && /^(https:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(u);
}

// ==========================================================================
// 💡 PISTAS (las escriben los estudiantes; sin penalización; se registra cada petición)
// ==========================================================================
const btnHint = document.getElementById("btnHint"), hintBox = document.getElementById("hintBox");
function resetHintUI() {
    hintBox.textContent = "";
    hintBox.style.display = "none";
    btnHint.disabled = false;
    btnHint.textContent = "💡 Pedir una pista";
}
btnHint.addEventListener("click", async () => {
    if (!roundActive) return;
    if (!currentQ || answerLocked) return;
    btnHint.disabled = true;
    const requestedQuestion = currentQ, epoch = roundEpoch;
    try {
        if (!currentHint) {
            const snap = await getDocs(collection(db, "hints"));
            if (!roundActive || epoch !== roundEpoch || currentQ !== requestedQuestion) return;
            const all = [];
            snap.forEach(d => { const h = d.data(); if (Array.isArray(h.steps) && h.steps.length) all.push({ id: d.id, ...h }); });
            if (!all.length) {
                track("hint_none", { qid: currentQ.id, order: currentQ.order ?? null, topic: currentQ.topic || "" });
                hintBox.style.display = "block";
                hintBox.textContent = "El administrador aún no ha publicado pistas en el banco general.";
                btnHint.textContent = "Sin pistas disponibles";
                return;
            }
            currentHint = all[Math.floor(Math.random() * all.length)];
            hintStep = 0;
        }
        hintStep++;
        hintsUsedNow++;
        track("hint_used", { qid: currentQ.id, order: currentQ.order ?? null, topic: currentQ.topic || "", hintId: String(currentHint.id).slice(0, 100), step: hintStep, stepsTotal: currentHint.steps.length });
        hintBox.style.display = "block";
        hintBox.replaceChildren();
        const title = document.createElement("strong");
        title.textContent = `Pista de ${String(currentHint.authorName || "Administrador").slice(0, 30)}:`;
        const ol = document.createElement("ol");
        currentHint.steps.slice(0, hintStep).forEach(s => { const li = document.createElement("li"); li.textContent = String(s).slice(0, 200); ol.appendChild(li); });
        hintBox.append(title, ol);
        if (hintStep < currentHint.steps.length) {
            btnHint.disabled = false;
            btnHint.textContent = `💡 Siguiente paso (${hintStep}/${currentHint.steps.length})`;
        } else {
            btnHint.textContent = "Ya viste todos los pasos";
        }
    } catch (e) {
        track("technical_error", { code: "hint_load" });
        hintBox.style.display='block';
        hintBox.textContent=hintAccessMessage(e);
        btnHint.disabled = false;
    }
});

// --- EVALUACIÓN DE RESPUESTA Y LÓGICA DE REPETICIÓN POR ERROR ---
async function verifyAnswer(isCorrect, optionIndex) {
    if (!roundActive) return;
    if(answerLocked||!currentQ)return;answerLocked=true;
    modalQuestion.classList.remove("active");
    const epoch = roundEpoch;
    const cq = currentQ;
    attempts[cq.id] = (attempts[cq.id] || 0) + 1;
    track("answer", { presentationId,qid: cq.id, order: cq.order ?? null, qType: cq.mainImg && cq.type !== "img_opts" ? "img_main" : (cq.type || "text"), topic: cq.topic || "", correct: isCorrect, optionIndex, timeMs: Date.now() - questionShownAt, attempt: attempts[cq.id], isFinal: isFinalQuestion, pos: currentPos, lost: isCorrect ? 0 : currentPos - previousPos, hintCount: hintsUsedNow });

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
            track('finish',{totalTimeMs:myEndTime-(playStartAt||myEndTime),pos:currentPos});

            await savePlayer({
                position: currentPos,
                correctCount,
                incorrectCount,
                attempts,
                status: "finished",
                endTime: myEndTime
            });

            // 🆕 AJUSTE #4: calcula el puesto de llegada y lo muestra en el modal de victoria
            const rank = await getFinishRank(myEndTime);
            if (!roundActive || epoch !== roundEpoch) return;
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

            await savePlayer({
                position: currentPos,
                correctCount,
                incorrectCount,
        attempts
            });

            if (roundActive && epoch === roundEpoch) modalResult.classList.add("active");
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

    await savePlayer({
        position: currentPos,
        correctCount,
        incorrectCount,
        attempts
    });

    if (roundActive && epoch === roundEpoch) modalResult.classList.add("active");
}

btnContinue.addEventListener("click", () => {
    modalResult.classList.remove("active");
    btnRoll.disabled = !roundActive;
});
document.getElementById('btnRetrySave').addEventListener('click',()=>retryClose?.());
window.addEventListener('online',()=>retryClose?.());

window.addEventListener("resize", () => {
    // 🆕 23 -> BOARD_SIZE - 1
    if(screenGame.classList.contains("active")) updateTokenPosition(Math.min(currentPos, BOARD_SIZE - 1));
});

window.addEventListener('scroll',()=>{if(roundActive)updateTokenPosition(currentPos);},{passive:true});
document.addEventListener('visibilitychange',()=>{if(ctxInfo.roundId)track('visibility',{state:document.visibilityState});});
window.addEventListener('unhandledrejection',()=>{if(ctxInfo.roundId)track('technical_error',{code:'unhandled_rejection'});});
function buildPolyhedron(die, sides) {
    const solid = die.querySelector('.polyhedron');
    solid.replaceChildren();
    const count = sides === 8 ? 8 : 4;
    for (let i = 0; i < count; i++) {
        const face = document.createElement('i');
        face.className = 'poly-face';
        face.textContent = String(i+1);
        const upper = i < 4;
        face.style.transform = sides === 8
            ? 'rotateY(' + (i % 4 * 90) + 'deg) translateZ(38px) rotateX(' + (upper ? 35.264 : -35.264) + 'deg)' + (upper ? '' : ' rotateZ(180deg)')
            : (i < 3 ? 'rotateY(' + i * 120 + 'deg) translateY(26px) translateZ(21.939px) rotateX(19.471deg)' : 'translateY(26px) translateZ(21.939px) rotateX(-90deg) rotateZ(180deg)');
        solid.appendChild(face);
    }
}
// --- ARRANQUE: fondo elegido + sesión anónima ---
document.querySelectorAll("[data-theme-pick]").forEach(b => b.addEventListener("click", () => { if (!joined) applyTheme(b.dataset.themePick); }));
applyTheme(theme);
btnJoin.disabled = true;
ensurePlayerAuth().then(user => {
    playerId = user.uid;
    ctxInfo.playerId = playerId;
    authReady = true;
    btnJoin.disabled = false;
    track("visit");
    flushTracking().catch(()=>{});
}).catch(() => {
    // Sin sesión anónima disponible: se usa el identificador local de siempre (el juego funciona igual).
    playerId = localStorage.getItem("playerId") || "p_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("playerId", playerId);
    ctxInfo.playerId = playerId;
    authReady = true;
    btnJoin.disabled = false;
    track("visit");
});

buildBoard();

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInAnonymously, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where,
  orderBy, onSnapshot, serverTimestamp, runTransaction, increment, writeBatch, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (selector) => document.querySelector(selector);
const views = ["auth", "teacher", "join", "room"];
let db;
let firebaseAuth;
let user = null;
let authFlowInProgress = false;
let authMode = "login";
let joinStep = "pin";
let room = null;
let roomUnsubscribers = [];
let questionUnsubscribers = [];
let quizUnsubscribe = null;
let currentQuestion = null;
let currentAnswer = null;
let toastTimer = 0;
let timerInterval = 0;
let installPrompt = null;
const scoring = new Set();

function showView(name) {
  for (const view of views) $(`#${view}-view`).hidden = view !== name;
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function clearError(element) {
  element.textContent = "";
  element.hidden = true;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function readableError(error) {
  const messages = {
    "auth/email-already-in-use": "Este e-mail já possui uma conta.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/invalid-email": "Informe um e-mail válido.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/popup-closed-by-user": "A janela do Google foi fechada antes de concluir o login.",
    "permission-denied": "Acesso negado. Verifique as regras do Firestore.",
    "unavailable": "Não foi possível conectar ao Firebase. Confira sua conexão."
  };
  return messages[error.code] || error.message || "Ocorreu um erro. Tente novamente.";
}

function validateInep(value) {
  return /^\d{8}$/.test(value);
}

async function saveTeacherProfile(account, name, inep) {
  if (!validateInep(inep)) throw new Error("O código INEP deve conter exatamente 8 números.");
  await setDoc(doc(db, "profiles", account.uid), {
    name: name.trim() || account.displayName || "Professor(a)",
    inep,
    email: account.email || "",
    createdAt: serverTimestamp()
  }, { merge: true });
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  $("#auth-title").textContent = registering ? "Crie sua conta" : "Boas-vindas!";
  $("#auth-description").textContent = registering ? "Cadastre sua escola para começar." : "Entre para preparar sua próxima atividade.";
  $("#name-field").hidden = !registering;
  $("#inep-field").hidden = !registering;
  $("#teacher-password").autocomplete = registering ? "new-password" : "current-password";
  $("#auth-submit").textContent = registering ? "Criar conta" : "Entrar";
  $("#switch-copy").textContent = registering ? "Já tem uma conta?" : "Ainda não tem uma conta?";
  $("#switch-auth").textContent = registering ? "Entrar" : "Criar conta";
  clearError($("#auth-error"));
}

function cleanupRoom() {
  roomUnsubscribers.forEach((unsubscribe) => unsubscribe());
  questionUnsubscribers.forEach((unsubscribe) => unsubscribe());
  roomUnsubscribers = [];
  questionUnsubscribers = [];
  window.clearInterval(timerInterval);
  room = null;
  currentQuestion = null;
  currentAnswer = null;
  scoring.clear();
}

function backFromJoin() {
  if (user && !user.isAnonymous) showView("teacher");
  else showView("auth");
}

function enterJoin(pin = "") {
  joinStep = "pin";
  $("#room-pin").value = pin.replace(/\D/g, "").slice(0, 6);
  $("#nickname-field").hidden = true;
  $("#join-title").textContent = "Entre na sala";
  $("#join-description").textContent = "Peça o PIN de seis números ao seu professor.";
  $("#join-submit").textContent = "Continuar";
  $("#room-pin").disabled = false;
  clearError($("#join-error"));
  showView("join");
}

function setConnectionStatus() {
  const status = $("#connection-status");
  status.classList.toggle("online", navigator.onLine);
  status.classList.toggle("offline", !navigator.onLine);
  status.textContent = navigator.onLine ? "Conectado" : "Sem conexão";
}

function renderQuestion(question, index, game) {
  currentQuestion = question;
  currentAnswer = null;
  $("#lobby-panel").hidden = true;
  $("#finished-panel").hidden = true;
  $("#question-panel").hidden = false;
  $("#question-number").textContent = `PERGUNTA ${index + 1}`;
  window.clearInterval(timerInterval);
  const updateTimer = () => {
    if (game.revealed) {
      $("#question-timer").textContent = "Respostas reveladas";
      window.clearInterval(timerInterval);
      return;
    }
    const startedAt = game.questionStartedAt?.toMillis?.() || Date.now();
    const remaining = Math.max(0, question.durationSec - Math.floor((Date.now() - startedAt) / 1000));
    $("#question-timer").textContent = `${remaining} s restantes`;
    if (remaining === 0 && room.role === "player") {
      [...$("#answer-options").children].forEach((button) => { button.disabled = true; });
      if (!currentAnswer) {
        $("#answer-feedback").textContent = "O tempo acabou! Aguarde a revelação.";
        $("#answer-feedback").className = "answer-feedback failure";
        $("#answer-feedback").hidden = false;
      }
      window.clearInterval(timerInterval);
    }
  };
  $("#question-text").textContent = question.text;
  const options = $("#answer-options");
  options.replaceChildren();
  question.options.forEach((option, optionIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-option";
    button.textContent = `${String.fromCharCode(65 + optionIndex)}. ${option}`;
    button.disabled = Boolean(game.revealed) || room.role === "teacher";
    button.addEventListener("click", () => submitAnswer(optionIndex, button));
    options.append(button);
  });
  updateTimer();
  if (!game.revealed) timerInterval = window.setInterval(updateTimer, 1000);
  $("#teacher-controls").hidden = room.role !== "teacher";
  $("#answer-feedback").hidden = true;
  $("#response-count").textContent = "Aguardando respostas…";
  $("#advance-question").textContent = game.revealed ? "Próxima pergunta" : "Revelar respostas";
}

function renderAnswer(result, question, game) {
  const feedback = $("#answer-feedback");
  if (!game.revealed) {
    feedback.hidden = true;
    return;
  }
  if (!result) {
    feedback.textContent = `Você não respondeu. A resposta correta era ${question.options[question.revealedCorrectIndex]}.`;
    feedback.className = "answer-feedback failure";
    feedback.hidden = false;
    [...$("#answer-options").children].forEach((button, index) => {
      button.disabled = true;
      if (index === question.revealedCorrectIndex) button.classList.add("correct");
    });
    return;
  }
  const correct = result.isCorrect ?? (result.optionIndex === question.revealedCorrectIndex);
  feedback.textContent = correct
    ? result.scored ? `Resposta correta! +${result.earnedPoints} pontos` : "Resposta correta! Calculando sua pontuação…"
    : `Resposta incorreta. A certa era ${question.options[question.revealedCorrectIndex]}.`;
  feedback.className = `answer-feedback ${correct ? "success" : "failure"}`;
  feedback.hidden = false;
  [...$("#answer-options").children].forEach((button, index) => {
    button.disabled = true;
    if (index === question.revealedCorrectIndex) button.classList.add("correct");
    else if (index === result.optionIndex) button.classList.add("incorrect");
  });
}

function updateLeaderboard(players) {
  const leaderboard = $("#leaderboard");
  leaderboard.replaceChildren();
  $("#lobby-count").textContent = `${players.length} ${players.length === 1 ? "participante" : "participantes"}`;
  $("#players-subtitle").textContent = `${players.length} ${players.length === 1 ? "jogador" : "jogadores"}`;
  players.sort((left, right) => (right.score || 0) - (left.score || 0) || (left.nickname || "").localeCompare(right.nickname || ""));
  players.forEach((player, index) => {
    const row = document.createElement("li");
    const rank = document.createElement("span");
    rank.className = `rank${index === 0 && (player.score || 0) > 0 ? " gold" : ""}`;
    rank.textContent = index === 0 && (player.score || 0) > 0 ? "★" : `${index + 1}`;
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.nickname;
    const score = document.createElement("span");
    score.className = "player-score";
    score.textContent = `${player.score || 0} pts`;
    row.append(rank, name, score);
    leaderboard.append(row);
  });
  if (!players.length) leaderboard.innerHTML = '<li class="empty-state">Ninguém entrou ainda.</li>';
}

async function processAnswers(gameId, questionIndex, question) {
  const responsesRef = collection(db, "games", gameId, "responses", String(questionIndex), "answers");
  const snapshot = await getDocs(responsesRef);
  await Promise.all(snapshot.docs.map(async (responseDoc) => {
    const response = responseDoc.data();
    if (response.scored || !response.answeredAt) return;
    const key = `${questionIndex}:${responseDoc.id}`;
    if (scoring.has(key)) return;
    scoring.add(key);
    try {
      const keySnapshot = await getDoc(doc(db, "games", gameId, "answerKeys", String(questionIndex)));
      const secret = keySnapshot.data();
      if (!secret) return;
      const correct = response.optionIndex === secret.correctIndex;
      const startedAt = room.game.questionStartedAt?.toMillis?.() || Date.now();
      const answeredAt = response.answeredAt.toMillis();
      const elapsed = Math.max(0, Math.floor((answeredAt - startedAt) / 1000));
      const points = correct ? Math.max(0, question.points - elapsed) : 0;
      await runTransaction(db, async (transaction) => {
        const freshResponse = await transaction.get(responseDoc.ref);
        if (!freshResponse.exists() || freshResponse.data().scored) return;
        const playerRef = doc(db, "games", gameId, "players", responseDoc.id);
        transaction.update(playerRef, { score: increment(points) });
        transaction.update(responseDoc.ref, { scored: true, isCorrect: correct, earnedPoints: points });
      });
    } finally {
      scoring.delete(key);
    }
  }));
}

async function watchCurrentQuestion(game) {
  if (game.status !== "live" || game.currentQuestion < 0) {
    $("#question-panel").hidden = true;
    $("#lobby-panel").hidden = game.status !== "lobby";
    $("#finished-panel").hidden = game.status !== "finished";
    return;
  }
  const questionRef = doc(db, "games", room.id, "questions", String(game.currentQuestion));
  const question = await getDoc(questionRef);
  if (!question.exists()) throw new Error("A pergunta atual não foi encontrada.");
  const data = question.data();
  renderQuestion(data, game.currentQuestion, game);
  if (room.role === "teacher") {
    const answersRef = collection(db, "games", room.id, "responses", String(game.currentQuestion), "answers");
    const answerUnsubscribe = onSnapshot(answersRef, (snapshot) => {
      $("#response-count").textContent = `${snapshot.size} ${snapshot.size === 1 ? "resposta recebida" : "respostas recebidas"}`;
      processAnswers(room.id, game.currentQuestion, data).catch((error) => showToast(readableError(error)));
    }, (error) => showToast(readableError(error)));
    questionUnsubscribers.push(answerUnsubscribe);
  } else {
    const responseRef = doc(db, "games", room.id, "responses", String(game.currentQuestion), "answers", user.uid);
    const responseUnsubscribe = onSnapshot(responseRef, (snapshot) => {
      currentAnswer = snapshot.exists() ? snapshot.data() : null;
      if (currentAnswer && !game.revealed) {
        $("#answer-feedback").textContent = "Resposta enviada! Aguarde a próxima etapa.";
        $("#answer-feedback").className = "answer-feedback success";
        $("#answer-feedback").hidden = false;
        [...$("#answer-options").children].forEach((button) => { button.disabled = true; });
      }
      renderAnswer(currentAnswer, data, room.game);
    }, (error) => showToast(readableError(error)));
    questionUnsubscribers.push(responseUnsubscribe);
  }
}

async function handleGameSnapshot(snapshot) {
  if (!snapshot.exists()) {
    showToast("Esta sala não existe mais.");
    cleanupRoom();
    sessionStorage.removeItem("quizziolando:room");
    backFromJoin();
    return;
  }
  const game = snapshot.data();
  room.game = game;
  $("#room-title").textContent = game.title;
  $("#room-state").textContent = game.status === "lobby" ? "SALA DE ESPERA" : game.status === "finished" ? "QUIZ ENCERRADO" : game.revealed ? "RESPOSTAS REVELADAS" : "QUIZ AO VIVO";
  $("#room-subtitle").textContent = room.role === "teacher" ? "Sua turma acompanha as respostas em tempo real." : `Você entrou como ${room.nickname || "participante"}.`;
  $("#pin-display").hidden = room.role !== "teacher" || game.status !== "lobby";
  $("#room-pin-display").textContent = game.pin;
  $("#start-game").hidden = room.role !== "teacher" || game.status !== "lobby";
  $("#start-game").disabled = false;
  $("#advance-question").disabled = false;
  $("#leave-room").disabled = false;
  $("#teacher-controls").hidden = room.role !== "teacher";
  $("#players-title").textContent = game.status === "lobby" ? "Participantes" : "Placar";
  if (room.questionIndex !== game.currentQuestion || room.questionStatus !== `${game.status}:${game.revealed}`) {
    room.questionIndex = game.currentQuestion;
    room.questionStatus = `${game.status}:${game.revealed}`;
    questionUnsubscribers.forEach((unsubscribe) => unsubscribe());
    questionUnsubscribers = [];
    await watchCurrentQuestion(game);
  } else if (game.status === "live" && game.revealed && room.role !== "teacher" && currentQuestion) {
    const publicQuestion = await getDoc(doc(db, "games", room.id, "questions", String(game.currentQuestion)));
    if (publicQuestion.exists()) {
      currentQuestion = publicQuestion.data();
      renderAnswer(currentAnswer, currentQuestion, game);
    }
  }
}

async function openRoom(gameId, role, nickname = "") {
  cleanupRoom();
  room = { id: gameId, role, nickname, game: null, questionIndex: null, questionStatus: null };
  sessionStorage.setItem("quizziolando:room", JSON.stringify({ id: gameId, role, nickname }));
  $("#leave-room").textContent = role === "teacher" ? "Encerrar e sair da sala" : "Sair da sala";
  $("#leave-room").disabled = true;
  $("#signout-button").hidden = role === "player";
  showView("room");
  room.playerUnsubscribe = onSnapshot(collection(db, "games", gameId, "players"), (snapshot) => {
    const players = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    updateLeaderboard(players);
  }, (error) => showToast(readableError(error)));
  roomUnsubscribers.push(room.playerUnsubscribe);
  room.gameUnsubscribe = onSnapshot(doc(db, "games", gameId), (snapshot) => {
    handleGameSnapshot(snapshot).catch((error) => showToast(readableError(error)));
  }, (error) => showToast(readableError(error)));
  roomUnsubscribers.push(room.gameUnsubscribe);
}

async function submitAnswer(optionIndex, button) {
  if (!room || room.role !== "player" || !currentQuestion || currentAnswer) return;
  const game = room.game;
  if (game.status !== "live" || game.revealed) return;
  const startedAt = game.questionStartedAt?.toMillis?.() || Date.now();
  if (Date.now() - startedAt >= currentQuestion.durationSec * 1000) {
    showToast("O tempo para responder acabou.");
    return;
  }
  button.classList.add("selected");
  [...$("#answer-options").children].forEach((option) => { option.disabled = true; });
  try {
    await setDoc(doc(db, "games", room.id, "responses", String(game.currentQuestion), "answers", user.uid), {
      optionIndex,
      answeredAt: serverTimestamp(),
      scored: false
    });
  } catch (error) {
    [...$("#answer-options").children].forEach((option) => { option.disabled = false; });
    button.classList.remove("selected");
    showToast(readableError(error));
  }
}

async function startGame() {
  if (!room || room.role !== "teacher") return;
  $("#start-game").disabled = true;
  try {
    await updateDoc(doc(db, "games", room.id), {
      status: "live", currentQuestion: 0, revealed: false, questionStartedAt: serverTimestamp()
    });
  } catch (error) {
    $("#start-game").disabled = false;
    showToast(readableError(error));
  }
}

async function advanceQuestion() {
  if (!room || room.role !== "teacher" || !room.game) return;
  $("#advance-question").disabled = true;
  try {
    if (!room.game.revealed) {
      const questionRef = doc(db, "games", room.id, "questions", String(room.game.currentQuestion));
      const answerRef = doc(db, "games", room.id, "answerKeys", String(room.game.currentQuestion));
      const [questionSnapshot, answerSnapshot] = await Promise.all([getDoc(questionRef), getDoc(answerRef)]);
      if (!questionSnapshot.exists() || !answerSnapshot.exists()) throw new Error("Não foi possível carregar o gabarito.");
      const batch = writeBatch(db);
      batch.update(questionRef, { revealedCorrectIndex: answerSnapshot.data().correctIndex });
      batch.update(doc(db, "games", room.id), { revealed: true });
      await batch.commit();
    } else if (room.game.currentQuestion + 1 < room.game.questionCount) {
      await updateDoc(doc(db, "games", room.id), {
        currentQuestion: room.game.currentQuestion + 1, revealed: false, questionStartedAt: serverTimestamp()
      });
    } else {
      await updateDoc(doc(db, "games", room.id), { status: "finished", revealed: true });
      await deleteDoc(doc(db, "roomPins", room.game.pin));
    }
  } catch (error) {
    showToast(readableError(error));
  } finally {
    $("#advance-question").disabled = false;
  }
}

function parseQuestions(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Adicione pelo menos uma pergunta.");
  return lines.map((line, index) => {
    const fields = line.split("|").map((field) => field.trim());
    if (fields.length !== 7 || fields.slice(0, 5).some((field) => !field)) {
      throw new Error(`Linha ${index + 1}: use pergunta|alternativa 1|alternativa 2|alternativa 3|alternativa 4|correta (1-4)|tempo.`);
    }
    const correctIndex = Number(fields[5]) - 1;
    const durationSec = Number(fields[6]);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) throw new Error(`Linha ${index + 1}: a alternativa correta deve ser um número de 1 a 4.`);
    if (!Number.isInteger(durationSec) || durationSec < 5 || durationSec > 60) throw new Error(`Linha ${index + 1}: o tempo deve ser de 5 a 60 segundos.`);
    return { text: fields[0], options: fields.slice(1, 5), correctIndex, durationSec, points: 100 };
  });
}

async function loadQuizzes() {
  if (quizUnsubscribe) quizUnsubscribe();
  const quizzesRef = query(collection(db, "quizzes"), where("ownerId", "==", user.uid), orderBy("createdAt", "desc"));
  quizUnsubscribe = onSnapshot(quizzesRef, (snapshot) => {
    const list = $("#quiz-list");
    list.replaceChildren();
    if (snapshot.empty) {
      list.innerHTML = '<div class="empty-state">Você ainda não criou quizzes.<br>Use o formulário ao lado para começar.</div>';
      return;
    }
    snapshot.docs.forEach((quizDoc) => {
      const quiz = quizDoc.data();
      const article = document.createElement("article");
      article.className = "quiz-item";
      const details = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = quiz.title;
      const meta = document.createElement("p");
      meta.textContent = `${quiz.questions.length} ${quiz.questions.length === 1 ? "pergunta" : "perguntas"}`;
      details.append(title, meta);
      const launch = document.createElement("button");
      launch.type = "button";
      launch.className = "button button-outline";
      launch.textContent = "Criar sala";
      launch.addEventListener("click", () => createRoom(quizDoc.id, quiz));
      article.append(details, launch);
      list.append(article);
    });
  }, (error) => {
    showError($("#quiz-error"), readableError(error));
  });
}

async function createRoom(quizId, quiz) {
  try {
    const gameRef = doc(collection(db, "games"));
    let pin = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const randomValue = new Uint32Array(1);
      crypto.getRandomValues(randomValue);
      const candidate = String(100000 + (randomValue[0] % 900000));
      const reserved = await runTransaction(db, async (transaction) => {
        const pinRef = doc(db, "roomPins", candidate);
        const existing = await transaction.get(pinRef);
        if (existing.exists()) return false;
        transaction.set(gameRef, {
          ownerId: user.uid,
          quizId,
          title: quiz.title,
          pin: candidate,
          status: "lobby",
          currentQuestion: -1,
          questionCount: quiz.questions.length,
          revealed: false,
          createdAt: serverTimestamp()
        });
        transaction.set(pinRef, { gameId: gameRef.id, ownerId: user.uid, createdAt: serverTimestamp() });
        return true;
      });
      if (reserved) { pin = candidate; break; }
    }
    if (!pin) throw new Error("Não foi possível gerar um PIN exclusivo. Tente novamente.");
    await Promise.all(quiz.questions.map((question, index) => Promise.all([
      setDoc(doc(db, "games", gameRef.id, "questions", String(index)), {
        text: question.text, options: question.options, durationSec: question.durationSec, points: question.points
      }),
      setDoc(doc(db, "games", gameRef.id, "answerKeys", String(index)), { correctIndex: question.correctIndex })
    ])));
    await openRoom(gameRef.id, "teacher");
  } catch (error) {
    showToast(readableError(error));
  }
}

async function joinRoom(pin, nickname) {
  const pinSnapshot = await getDoc(doc(db, "roomPins", pin));
  if (!pinSnapshot.exists()) throw new Error("Sala não encontrada ou quiz já encerrado. Confira o PIN.");
  const gameRef = doc(db, "games", pinSnapshot.data().gameId);
  const gameSnapshot = await getDoc(gameRef);
  if (!gameSnapshot.exists() || !["lobby", "live"].includes(gameSnapshot.data().status) || gameSnapshot.data().pin !== pin) {
    throw new Error("Sala não encontrada ou quiz já encerrado. Confira o PIN.");
  }
  const playerRef = doc(db, "games", gameRef.id, "players", user.uid);
  await setDoc(playerRef, { nickname: nickname.trim(), score: 0, joinedAt: serverTimestamp() });
  await openRoom(gameRef.id, "player", nickname.trim());
}

async function initializeTeacher(account) {
  user = account;
  const profile = await getDoc(doc(db, "profiles", account.uid));
  if (!profile.exists()) {
    const inep = window.prompt("Informe o código INEP da sua escola (8 números) para concluir o cadastro:");
    if (!inep) throw new Error("O cadastro precisa do código INEP para continuar.");
    await saveTeacherProfile(account, account.displayName || "Professor(a)", inep.trim());
  }
  const finalProfile = (await getDoc(doc(db, "profiles", account.uid))).data();
  $("#teacher-greeting").textContent = (finalProfile?.name || "professor(a)").split(" ")[0];
  $("#signout-button").hidden = false;
  showView("teacher");
  loadQuizzes();
  const savedRoom = JSON.parse(sessionStorage.getItem("quizziolando:room") || "null");
  if (savedRoom?.id && savedRoom.role === "teacher") await openRoom(savedRoom.id, "teacher");
}

function configurationReady() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("COLOQUE_") &&
    firebaseConfig.projectId && !firebaseConfig.projectId.includes("SEU_");
}

$("#switch-auth").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError($("#auth-error"));
  const button = $("#auth-submit");
  button.disabled = true;
  authFlowInProgress = true;
  try {
    const email = $("#teacher-email").value.trim();
    const password = $("#teacher-password").value;
    if (authMode === "register") {
      const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
      await saveTeacherProfile(credential.user, $("#teacher-name").value, $("#teacher-inep").value);
      await initializeTeacher(credential.user);
    } else {
      const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
      await initializeTeacher(credential.user);
    }
  } catch (error) {
    showError($("#auth-error"), readableError(error));
  } finally {
    authFlowInProgress = false;
    button.disabled = false;
  }
});

$("#quiz-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError($("#quiz-error"));
  const button = $("#quiz-submit");
  button.disabled = true;
  try {
    const questions = parseQuestions($("#quiz-questions").value);
    const title = $("#quiz-title").value.trim();
    if (!title) throw new Error("Informe um nome para o quiz.");
    await addDoc(collection(db, "quizzes"), {
      ownerId: user.uid, title, questions, createdAt: serverTimestamp()
    });
    $("#quiz-form").reset();
    showToast("Quiz salvo com sucesso!");
  } catch (error) {
    showError($("#quiz-error"), readableError(error));
  } finally {
    button.disabled = false;
  }
});

$("#show-join").addEventListener("click", () => enterJoin(new URLSearchParams(location.search).get("pin") || ""));
$("#show-join-teacher").addEventListener("click", () => enterJoin());
document.querySelector("[data-back]").addEventListener("click", backFromJoin);
$("#room-pin").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
  if (joinStep === "nickname") {
    joinStep = "pin";
    $("#nickname-field").hidden = true;
    $("#room-pin").disabled = false;
    $("#join-title").textContent = "Entre na sala";
    $("#join-submit").textContent = "Continuar";
  }
});
$("#join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError($("#join-error"));
  const pin = $("#room-pin").value;
  if (joinStep === "pin") {
    if (!/^\d{6}$/.test(pin)) return showError($("#join-error"), "O PIN precisa ter seis números.");
    joinStep = "nickname";
    $("#room-pin").disabled = true;
    $("#nickname-field").hidden = false;
    $("#player-nickname").required = true;
    $("#join-title").textContent = "Como vamos te chamar?";
    $("#join-description").textContent = "Escolha um apelido para aparecer no placar.";
    $("#join-submit").textContent = "Entrar na sala";
    $("#player-nickname").focus();
    return;
  }
  const nickname = $("#player-nickname").value.trim();
  if (nickname.length < 2) return showError($("#join-error"), "O apelido precisa ter pelo menos 2 caracteres.");
  const button = $("#join-submit");
  button.disabled = true;
  authFlowInProgress = true;
  try {
    if (!user || !user.isAnonymous) {
      const credential = await signInAnonymously(firebaseAuth);
      user = credential.user;
    }
    await joinRoom(pin, nickname);
  } catch (error) {
    showError($("#join-error"), readableError(error));
  } finally {
    authFlowInProgress = false;
    button.disabled = false;
  }
});

$("#start-game").addEventListener("click", startGame);
$("#advance-question").addEventListener("click", advanceQuestion);
$("#leave-room").addEventListener("click", async () => {
  const closeGame = room?.role === "teacher" && room.game?.status !== "finished";
  if (closeGame) {
    try {
      await updateDoc(doc(db, "games", room.id), { status: "finished", revealed: true });
      await deleteDoc(doc(db, "roomPins", room.game.pin));
    } catch (error) {
      showToast(readableError(error));
      return;
    }
  }
  cleanupRoom();
  sessionStorage.removeItem("quizziolando:room");
  if (user?.isAnonymous) await signOut(firebaseAuth);
  else backFromJoin();
  sessionStorage.removeItem("quizziolando:room");
});
$("#signout-button").addEventListener("click", async () => {
  if (room?.role === "teacher" && room.game && room.game.status !== "finished") {
    try {
      await updateDoc(doc(db, "games", room.id), { status: "finished", revealed: true });
      await deleteDoc(doc(db, "roomPins", room.game.pin));
    } catch (error) {
      showToast(readableError(error));
      return;
    }
  }
  cleanupRoom();
  sessionStorage.removeItem("quizziolando:room");
  if (quizUnsubscribe) quizUnsubscribe();
  await signOut(firebaseAuth);
});

window.addEventListener("online", setConnectionStatus);
window.addEventListener("offline", setConnectionStatus);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("#install-button").hidden = false;
});
$("#install-button").addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  $("#install-button").hidden = true;
});

window.addEventListener("unhandledrejection", (event) => {
  showToast(readableError(event.reason));
});

setConnectionStatus();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((error) => console.error("Falha ao registrar o service worker:", error));
}
if (!configurationReady()) {
  $("#connection-status").textContent = "Configure o Firebase";
  $("#connection-status").classList.add("offline");
  showError($("#auth-error"), "Antes de usar o app, preencha os dados do Firebase em site/firebase-config.js e publique as regras do Firestore.");
} else {
  const app = initializeApp(firebaseConfig);
  firebaseAuth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(firebaseAuth, async (account) => {
    if (authFlowInProgress) return;
    user = account;
    if (!account) {
      $("#signout-button").hidden = true;
      showView("auth");
      return;
    }
    try {
      if (account.isAnonymous) {
        const savedRoom = JSON.parse(sessionStorage.getItem("quizziolando:room") || "null");
        if (savedRoom?.id && savedRoom.role === "player") await openRoom(savedRoom.id, "player", savedRoom.nickname);
        else enterJoin(new URLSearchParams(location.search).get("pin") || "");
      } else {
        await initializeTeacher(account);
      }
    } catch (error) {
      showError($("#auth-error"), readableError(error));
      showView("auth");
    }
  });
}

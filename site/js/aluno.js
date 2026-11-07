import { auth, db, storage } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, setDoc,
  updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getBlob, getDownloadURL, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { setupCommentPanel } from "./classroom-interactions.js";
import { readAccountAccess, showMasterLink, startAccessMonitoring } from "./access-monitor.js";
import { playSiteSound, setupSoundEffects } from "./sound-effects.js";
import { setupTutorial } from "./tutorial.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pagePath = () => location.pathname.toLowerCase().replace(/\.html$/, "").replace(/\/+$/, "");
const errorBox = $("#page-error");
let user;
let session;
let gameQuestions = [];
let currentQuestionIndex = -1;
let questionStartedAt = 0;
let sessionUnsubscribe;
let advanceTimer;
let questionTimer;
let answeredQuestion = new Set();
let pendingAnswers = new Set();
let activeExam;
let activeExamQuestions = [];
let examStartedAt = 0;
let activeFormExam;
let activeFormResponseRef;
let activeFormAnswers = {};
let formSaveTimer;
let formExamStartedAt = 0;
let formSubmissionLocked = false;
let monitoredActivityKey = "";
let antiFraudCleanup;
let reportedEvents = new Map();
let userProfile = {};
let studentDisplayName = "";
let classroomObjectUrls = new Set();

function report(error) {
  if (errorBox) errorBox.textContent = error?.message || "Não foi possível concluir a operação.";
  console.error(error);
}

function fail(message) { throw new Error(message); }

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function stopIntegrityMonitor() {
  antiFraudCleanup?.();
  antiFraudCleanup = undefined;
  monitoredActivityKey = "";
  document.body.classList.remove("integrity-active");
}

function startIntegrityMonitor({ activityType, activityId, activityTitle, professorId, enabled = true, blockContextMenu = false, nickname = "" }) {
  stopIntegrityMonitor();
  if (!enabled) return;
  const listeners = [];
  const reportEvent = async (type, details = {}) => {
    const now = Date.now();
    const lastReported = reportedEvents.get(type) || 0;
    if (now - lastReported < 3000) return;
    reportedEvents.set(type, now);
    try {
      const eventRef = doc(collection(db, "penalidades"));
      await setDoc(eventRef, {
        id: eventRef.id, alunoId: user.uid,
        alunoNome: studentDisplayName || nickname || userProfile.nome || "Aluno",
        professorId, tipo: type, atividadeTipo: activityType, atividadeId: activityId,
        atividadeTitulo: activityTitle || "", detalhes: details, data: serverTimestamp()
      });
    } catch (error) { report(error); }
  };
  const listen = (target, name, handler, options) => {
    target.addEventListener(name, handler, options);
    listeners.push(() => target.removeEventListener(name, handler, options));
  };
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") void reportEvent("mudanca_aba", { estado: document.visibilityState });
  });
  listen(document, "copy", (event) => {
    event.preventDefault();
    void reportEvent("tentativa_copiar");
  });
  listen(document, "cut", (event) => {
    event.preventDefault();
    void reportEvent("tentativa_recortar");
  });
  listen(document, "paste", (event) => {
    event.preventDefault();
    void reportEvent("tentativa_colar");
  });
  listen(document, "keydown", (event) => {
    const key = event.key.toLowerCase();
    const copyShortcut = ((event.ctrlKey || event.metaKey) && key === "c") || (event.ctrlKey && key === "insert");
    const cutShortcut = (event.ctrlKey || event.metaKey) && key === "x";
    const pasteShortcut = ((event.ctrlKey || event.metaKey) && key === "v") || (event.shiftKey && key === "insert");
    if (copyShortcut || cutShortcut || pasteShortcut) {
      event.preventDefault();
      void reportEvent(pasteShortcut ? "tentativa_colar" : cutShortcut ? "tentativa_recortar" : "tentativa_copiar");
    }
  });
  if (blockContextMenu) {
    listen(document, "contextmenu", (event) => {
      event.preventDefault();
      void reportEvent("botao_direito");
    });
  }
  antiFraudCleanup = () => listeners.forEach((removeListener) => removeListener());
}

async function saveStudentProfile({ photoFile, avatar }) {
  const nameInput = $("#profile-name");
  const feedback = $("#profile-feedback");
  const nome = nameInput.value.trim();
  if (!nome) fail("Informe seu nome para salvar o perfil.");
  feedback.textContent = "Salvando perfil...";
  const updates = { uid: user.uid, nome, email: user.email || "", role: "aluno", escola: "PEI Riolando Canno" };
  if (avatar) {
    updates.avatar = avatar;
    updates.fotoUrl = "";
  }
  if (photoFile) {
    if (!photoFile.type.startsWith("image/") || photoFile.size > 5 * 1024 * 1024) fail("Escolha uma imagem de até 5 MB.");
    const photoRef = ref(storage, `perfis-alunos/${user.uid}/avatar`);
    await uploadBytes(photoRef, photoFile, { contentType: photoFile.type });
    updates.fotoUrl = await getDownloadURL(photoRef);
    updates.avatar = "";
  }
  await setDoc(doc(db, "users", user.uid), updates, { merge: true });
  userProfile = { ...userProfile, ...updates };
  studentDisplayName = nome;
  renderProfileAvatar(userProfile);
  $("#student-greeting").textContent = nome;
  feedback.textContent = "Perfil salvo.";
}

function renderProfileAvatar(profile = {}) {
  ["#profile-avatar", "#student-welcome-avatar"].forEach((selector) => {
    const avatar = $(selector);
    if (!avatar) return;
    avatar.replaceChildren();
    if (profile.fotoUrl) {
      const image = document.createElement("img");
      image.src = profile.fotoUrl;
      image.alt = "Foto do perfil";
      avatar.append(image);
    } else avatar.textContent = profile.avatar || "🎒";
  });
  if ($("#profile-name")) $("#profile-name").value = profile.nome || user.displayName || "Aluno(a)";
  if ($("#student-greeting")) $("#student-greeting").textContent = profile.nome || "estudante";
}

function setupProfile() {
  const form = $("#profile-form");
  if (!form) return;
  renderProfileAvatar(userProfile);
  $$("[data-avatar-choice]").forEach((button) => button.addEventListener("click", () => {
    $("#profile-photo").value = "";
    $("#profile-preview").hidden = true;
    saveStudentProfile({ avatar: button.dataset.avatarChoice }).catch((error) => {
      $("#profile-feedback").textContent = error?.message || "Não foi possível atualizar o avatar.";
      console.error(error);
    });
  }));
  $("#profile-photo").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      report(new Error("Escolha uma imagem de até 5 MB."));
      event.target.value = "";
      return;
    }
    const preview = $("#profile-preview");
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await saveStudentProfile({ photoFile: $("#profile-photo").files?.[0] }); }
    catch (error) {
      const message = error?.code === "storage/unknown" || error?.code === "storage/bucket-not-found"
        ? "O upload de fotos ainda não está disponível. O Firebase Storage precisa ser inicializado."
        : error?.message;
      $("#profile-feedback").textContent = message || "Não foi possível salvar o perfil.";
      console.error(error);
    }
  });
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

async function enterSession(event) {
  event.preventDefault();
  const pin = $("#game-pin").value.trim();
  const nickname = $("#nickname").value.trim();
  if (!/^\d{6}$/.test(pin)) fail("O PIN deve conter seis números.");
  if (nickname.length < 2) fail("O apelido deve ter pelo menos 2 caracteres.");
  let credential = auth.currentUser?.isAnonymous ? { user: auth.currentUser } : await signInAnonymously(auth);
  user = credential.user;
  const access = await readAccountAccess(db, user);
  if (!access.allowed) fail(`Esta conta está ${access.status === "banned" ? "banida" : "desativada"} no site.`);
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid, nome: nickname, email: "", role: "aluno", escola: "PEI Riolando Canno"
  }, { merge: true });
  const found = await getDoc(doc(db, "sessoesJogo", pin));
  if (!found.exists() || !["lobby", "jogando"].includes(found.data().status) || found.data().pin !== pin) fail("Não foi encontrada uma sessão ativa com esse PIN.");
  const playerRef = doc(db, "jogadores", user.uid);
  const existingPlayer = await getDoc(playerRef);
  const sameSession = existingPlayer.exists() && existingPlayer.data().sessaoId === found.id;
  const playerScore = sameSession ? Number(existingPlayer.data().pontuacao || 0) : 0;
  await setDoc(playerRef, {
    id: user.uid, sessaoId: found.id, apelido: nickname,
    pontuacao: playerScore
  });
  const rankingId = `${found.id}_${user.uid}`;
  const rankingRef = doc(db, "rankingQuizzes", rankingId);
  const existingRanking = await getDoc(rankingRef);
  const savedRanking = existingRanking.exists() ? existingRanking.data() : {};
  await setDoc(rankingRef, {
    id: rankingId, sessaoId: found.id, jogadorId: user.uid, quizId: found.data().quizId,
    titulo: found.data().titulo || "Quiz", apelido: nickname,
    turmaId: found.data().turmaId || "", turma: found.data().turma || "", curso: found.data().curso || "",
    pontuacao: playerScore, acertos: Number(savedRanking.acertos || 0),
    totalRespondidas: Number(savedRanking.totalRespondidas || 0),
    totalQuestoes: Number(savedRanking.totalQuestoes || 0),
    finalizado: savedRanking.finalizado === true, atualizadaEm: serverTimestamp()
  });
  session = {
    ...found.data(), id: found.id,
    playerName: nickname, playerScore,
    quizTitle: found.data().titulo || "Quiz"
  };
  studentDisplayName = nickname;
  location.href = `./jogar.html?sessao=${encodeURIComponent(found.id)}`;
}

function optionButton(text, index, submit) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = `${String.fromCharCode(65 + index)}. ${text}`;
  button.addEventListener("click", () => submit(index));
  return button;
}

async function fetchQuestionData(question) {
  const [optionSnapshot, gapSnapshot] = await Promise.all([
    getDocs(query(collection(db, "options"), where("questionId", "==", question.id))),
    getDocs(query(collection(db, "lacunas"), where("questionId", "==", question.id)))
  ]);
  return {
    ...question,
    options: optionSnapshot.docs.map((item) => item.data()),
    lacunas: gapSnapshot.docs[0]?.data()?.lacunas || []
  };
}

function renderGapQuestion(question, holder, submitAnswer, withSubmitButton = true) {
  const template = question.enunciado;
  let last = 0;
  const regex = /\{\{(\d+)\}\}/g;
  const fragment = document.createDocumentFragment();
  let match;
  while ((match = regex.exec(template))) {
    fragment.append(document.createTextNode(template.slice(last, match.index)));
    const select = document.createElement("select");
    select.dataset.gap = match[1];
    select.setAttribute("aria-label", `Resposta da lacuna ${Number(match[1]) + 1}`);
    const gap = question.lacunas.find((item) => Number(item.index) === Number(match[1]));
    const options = shuffled(gap?.opcoes || []);
    select.innerHTML = `<option value="">Escolha</option>${options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}`;
    fragment.append(select);
    last = regex.lastIndex;
  }
  fragment.append(document.createTextNode(template.slice(last)));
  holder.replaceChildren(fragment);
  if (withSubmitButton) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary";
    button.textContent = "Enviar resposta";
    button.addEventListener("click", () => {
      const answer = $$("select[data-gap]", holder).map((select) => ({ index: Number(select.dataset.gap), resposta: select.value }));
      if (answer.some((item) => !item.resposta)) return report(new Error("Escolha uma opção para cada lacuna."));
      submitAnswer(answer);
    });
    holder.append(button);
  }
}

function questionReview(question, result) {
  const correctAnswer = question.tipo === "lacuna"
    ? question.lacunas
      .slice()
      .sort((a, b) => Number(a.index) - Number(b.index))
      .map((gap) => `{{${gap.index}}}: ${gap.resposta}`)
      .join("; ")
    : question.options.find((option) => option.correta === true)?.texto;
  const lines = [result];
  if (correctAnswer) lines.push(`Resposta correta: ${correctAnswer}`);
  if (question.feedback?.trim()) lines.push(`Explicação: ${question.feedback.trim()}`);
  return lines.join("\n");
}

async function answerCurrent(answer) {
  const index = currentQuestionIndex;
  if (!session || !user || index < 0 || answeredQuestion.has(index) || pendingAnswers.has(index)) return;
  const question = gameQuestions[index];
  if (!question) return;
  const elapsed = Math.max(0, Date.now() - questionStartedAt);
  if (elapsed >= Number(question.tempo || 120) * 1000) {
    $("#game-feedback").textContent = "O tempo desta questão acabou.";
    return;
  }
  let acertou;
  if (question.tipo === "lacuna") {
    acertou = answer.length === question.lacunas.length && answer.every((item) => {
      const gap = question.lacunas.find((entry) => Number(entry.index) === item.index);
      return item.resposta === gap?.resposta;
    });
  } else {
    acertou = question.options[answer]?.correta === true;
  }
  const earned = acertou ? Math.max(1, Math.round(100 - elapsed / 1000)) : 0;
  const responseRef = doc(db, "respostas", `${session.id}_${question.id}_${user.uid}`);
  pendingAnswers.add(index);
  try {
    const priorResponse = await getDoc(responseRef);
    if (priorResponse.exists()) {
      answeredQuestion.add(index);
      $("#game-feedback").textContent = questionReview(question, "Você já respondeu esta questão.");
      $$("#game-options button, #game-options select, #question-content button, #question-content select").forEach((element) => { element.disabled = true; });
      return;
    }
    await setDoc(responseRef, {
      id: responseRef.id, sessaoId: session.id, quizId: session.quizId,
      jogadorId: user.uid, apelido: session.playerName, questionId: question.id,
      acertou, tempoResposta: Math.round(elapsed / 1000), data: serverTimestamp(),
      resposta: answer, professorId: session.professorId
    });
    answeredQuestion.add(index);
    $("#game-feedback").textContent = questionReview(
      question,
      acertou ? `Correto! +${earned} pontos.` : "Não foi dessa vez."
    );
    $$("#game-options button, #game-options select, #question-content button, #question-content select").forEach((element) => { element.disabled = true; });
    const playerRef = doc(db, "jogadores", user.uid);
    await updateDoc(playerRef, { pontuacao: (session.playerScore || 0) + earned });
    session.playerScore = (session.playerScore || 0) + earned;
    await syncQuizRanking();
    playSiteSound(acertou ? "success" : "error");
  } finally {
    pendingAnswers.delete(index);
  }
}

async function syncQuizRanking(finalizado = false) {
  if (!session?.id || !user?.uid) return;
  const answerSnapshot = await getDocs(query(collection(db, "respostas"), where("jogadorId", "==", user.uid)));
  const answers = answerSnapshot.docs.map((item) => item.data()).filter((answer) => answer.sessaoId === session.id);
  const rankingId = `${session.id}_${user.uid}`;
  const completed = finalizado || session.status === "fim";
  await setDoc(doc(db, "rankingQuizzes", rankingId), {
    id: rankingId, sessaoId: session.id, jogadorId: user.uid, quizId: session.quizId,
    titulo: session.quizTitle || "Quiz", apelido: session.playerName || "Aluno",
    turmaId: session.turmaId || "", turma: session.turma || "", curso: session.curso || "",
    pontuacao: Number(session.playerScore || 0),
    acertos: answers.filter((answer) => answer.acertou === true).length,
    totalRespondidas: answers.length,
    totalQuestoes: gameQuestions.length,
    finalizado: completed, atualizadaEm: serverTimestamp()
  }, { merge: true });
}

function scheduleAutoAdvance(index, question) {
  window.clearTimeout(advanceTimer);
  if (!session.autoAvanco) return;
  const advance = async () => {
    const sessionRef = doc(db, "sessoesJogo", session.id);
    await runTransaction(db, async (transaction) => {
      const latest = await transaction.get(sessionRef);
      if (latest.exists() && latest.data().status === "jogando" && Number(latest.data().questaoAtual) === index) {
        transaction.update(sessionRef, {
          questaoAtual: index + 1,
          status: index + 1 >= gameQuestions.length ? "fim" : "jogando",
            inicioQuestaoEm: serverTimestamp(), atualizadaEm: serverTimestamp()
        });
      }
    });
  };
  const startedAt = session.inicioQuestaoEm?.toMillis?.() || Date.now();
  const remainingQuestionMs = Math.max(0, Number(question.tempo || 10) * 1000 - (Date.now() - startedAt));
  advanceTimer = window.setTimeout(() => {
    advanceTimer = window.setTimeout(() => advance().catch(report), Number(session.intervaloSegundos || 5) * 1000);
  }, remainingQuestionMs);
}

async function showQuestion(index) {
  const holder = $("#game-options");
  if (!holder) return;
  if (index >= gameQuestions.length) {
    $("#game-state").textContent = "Quiz finalizado! Parabéns pela participação.";
    $("#question-number").textContent = "";
    $("#question-content").textContent = "";
    holder.replaceChildren();
    return;
  }
  if (index < 0) {
    $("#game-state").textContent = "Aguardando o professor iniciar o quiz...";
    return;
  }
  if (currentQuestionIndex === index) return;
  currentQuestionIndex = index;
  questionStartedAt = session.inicioQuestaoEm?.toMillis?.() || Date.now();
  $("#game-state").textContent = `Questão ${index + 1} de ${gameQuestions.length}`;
  const question = gameQuestions[index];
  window.clearInterval(questionTimer);
  const updateTimer = () => {
    const remaining = Math.max(0, Number(question.tempo || 0) - Math.floor((Date.now() - questionStartedAt) / 1000));
    $("#question-number").textContent = `Questão ${index + 1} · ${remaining}s`;
    if (remaining === 0) {
      $$("#game-options button, #game-options select, #question-content button, #question-content select").forEach((element) => { element.disabled = true; });
      $("#game-feedback").textContent = "O tempo acabou. Aguarde a próxima questão.";
      window.clearInterval(questionTimer);
    }
  };
  scheduleAutoAdvance(index, question);
  const prompt = $("#question-content");
  holder.replaceChildren();
  prompt.replaceChildren();
  $("#game-feedback").textContent = "";
  if (question.imagemUrl) {
    const image = document.createElement("img");
    image.src = question.imagemUrl;
    image.alt = "Imagem da questão";
    image.className = "preview";
    holder.append(image);
  }
  if (question.tipo === "lacuna") {
    prompt.className = "question-text";
    renderGapQuestion(question, prompt, (answer) => answerCurrent(answer).catch(report));
  } else {
    prompt.className = "";
    prompt.append(document.createTextNode(question.enunciado));
    shuffled(question.options).forEach((option, indexInView) => {
      holder.append(optionButton(option.texto, indexInView, () => {
        const answerIndex = question.options.findIndex((entry) => entry.id === option.id);
        answerCurrent(answerIndex).catch(report);
      }));
    });
  }
  updateTimer();
  questionTimer = window.setInterval(updateTimer, 1000);
  const savedResponse = await getDoc(doc(db, "respostas", `${session.id}_${question.id}_${user.uid}`));
  if (savedResponse.exists() && currentQuestionIndex === index) {
    answeredQuestion.add(index);
    $("#game-feedback").textContent = questionReview(question, "Você já respondeu esta questão.");
    $$("#game-options button, #game-options select, #question-content button, #question-content select").forEach((element) => { element.disabled = true; });
  }
}

async function setupGame() {
  const sessionId = new URLSearchParams(location.search).get("sessao");
  if (!sessionId) fail("Link da sessão inválido. Entre novamente com o PIN.");
  if (!user || !user.isAnonymous) user = (await signInAnonymously(auth)).user;
  const sessionRef = doc(db, "sessoesJogo", sessionId);
  const initialSession = await getDoc(sessionRef);
  if (!initialSession.exists()) fail("A sessão não existe mais.");
  session = initialSession.data();
  const playerSnapshot = await getDoc(doc(db, "jogadores", user.uid));
  if (!playerSnapshot.exists() || playerSnapshot.data().sessaoId !== sessionId) fail("Não encontramos sua entrada nesta sessão. Volte e informe o PIN.");
  session.playerName = playerSnapshot.data().apelido;
  session.playerScore = playerSnapshot.data().pontuacao || 0;
  const questionSnapshot = await getDocs(query(collection(db, "questions"), where("quizId", "==", session.quizId)));
  gameQuestions = await Promise.all(questionSnapshot.docs.map((item) => fetchQuestionData({ id: item.id, ...item.data() })));
  gameQuestions.sort((a, b) => a.ordem - b.ordem);
  session.quizTitle = session.titulo || "Quiz";
  session.monitorarIntegridade = session.monitorarIntegridade !== false;
  session.bloquearBotaoDireito = session.bloquearBotaoDireito === true;
  $("#game-title").textContent = session.quizTitle;
  if (!gameQuestions.length) fail("Este quiz ainda não possui questões.");
  currentQuestionIndex = -1;
  sessionUnsubscribe = onSnapshot(sessionRef, (snapshot) => {
    if (!snapshot.exists()) return report(new Error("A sessão foi encerrada."));
    session = { ...session, ...snapshot.data(), playerName: session.playerName, playerScore: session.playerScore };
    $("#game-count").textContent = `PIN ${session.pin}`;
    if (session.status === "lobby") {
      stopIntegrityMonitor();
      currentQuestionIndex = -1;
      $("#game-state").textContent = "Aguardando o professor iniciar o quiz...";
    } else if (session.status === "fim") {
      stopIntegrityMonitor();
      syncQuizRanking(true).catch(report);
      showQuestion(gameQuestions.length);
    } else {
      const monitorKey = `quiz:${session.id}`;
      if (monitoredActivityKey !== monitorKey) {
        startIntegrityMonitor({
          activityType: "quiz", activityId: session.id, activityTitle: session.quizTitle,
          professorId: session.professorId, enabled: session.monitorarIntegridade !== false,
          blockContextMenu: session.bloquearBotaoDireito === true, nickname: session.playerName
        });
        monitoredActivityKey = monitorKey;
        if (session.monitorarIntegridade !== false) document.body.classList.add("integrity-active");
      }
      $("#game-integrity-notice").textContent = session.monitorarIntegridade === false
        ? "O monitoramento de integridade está desativado pelo professor."
        : "Durante a atividade, mudanças de aba e tentativas de copiar/colar podem ser registradas para revisão. Esses sinais não comprovam fraude isoladamente.";
      showQuestion(Number(session.questaoAtual || 0)).catch(report);
    }
  }, report);
}

async function readQuestionForExam(questionId) {
  const snapshot = await getDoc(doc(db, "questions", questionId));
  if (!snapshot.exists()) fail(`A questão ${questionId} não foi encontrada.`);
  return fetchQuestionData({ id: snapshot.id, ...snapshot.data() });
}

function renderExamQuestion(question, index) {
  const card = document.createElement("article");
  card.className = "question-card stack exam-question";
  card.dataset.questionId = question.id;
  card.innerHTML = `<strong>${index + 1}. ${escapeHtml(question.enunciado)}</strong>`;
  if (question.imagemUrl) {
    const image = document.createElement("img");
    image.src = question.imagemUrl; image.alt = "Imagem da questão"; image.className = "preview"; card.append(image);
  }
  if (question.tipo === "lacuna") {
    const fill = document.createElement("div");
    fill.className = "question-text";
    renderGapQuestion(question, fill, () => {}, false);
    card.append(fill);
  } else {
    question.options.forEach((option) => {
      const label = document.createElement("label");
      label.className = "exam-option";
      label.innerHTML = `<span><input type="radio" name="exam-${escapeHtml(question.id)}" value="${escapeHtml(option.id)}"> ${escapeHtml(option.texto)}</span>`;
      card.append(label);
    });
  }
  return card;
}

function renderFormQuestion(question, index) {
  const card = document.createElement("article");
  card.className = "question-card stack exam-question form-exam-question";
  card.dataset.questionId = question.id;
  const required = question.obrigatoria ? '<span class="required-mark" aria-label="Obrigatória">*</span>' : "";
  let answerMarkup = "";
  if (question.tipo === "multipla" || question.tipo === "caixas") {
    answerMarkup = (question.opcoes || []).map((option, optionIndex) => {
      const inputType = question.tipo === "caixas" ? "checkbox" : "radio";
      return `<label class="exam-option"><span><input type="${inputType}" name="form-${escapeHtml(question.id)}" value="${optionIndex}"> ${escapeHtml(option.texto)}</span></label>`;
    }).join("");
  } else {
    answerMarkup = question.tipo === "paragrafo"
      ? '<textarea data-form-text-answer rows="4" maxlength="4000" placeholder="Sua resposta"></textarea>'
      : '<input data-form-text-answer maxlength="500" placeholder="Sua resposta">';
  }
  card.innerHTML = `<strong>${index + 1}. ${escapeHtml(question.enunciado)} ${required}</strong><div class="form-answer-options">${answerMarkup}</div>`;
  if (question.imagemUrl) {
    const image = document.createElement("img");
    image.src = question.imagemUrl;
    image.alt = "Imagem da pergunta";
    image.className = "preview";
    card.insertBefore(image, card.querySelector(".form-answer-options"));
  }
  return card;
}

function collectFormAnswers(validateRequired = false) {
  const answers = {};
  for (const question of activeFormExam.questoes || []) {
    const card = $(`[data-question-id="${CSS.escape(question.id)}"]`, $("#form-exam-questions"));
    let answer;
    if (question.tipo === "multipla") answer = $(`input[name="form-${CSS.escape(question.id)}"]:checked`, card)?.value || "";
    else if (question.tipo === "caixas") answer = $$(`input[name="form-${CSS.escape(question.id)}"]:checked`, card).map((input) => input.value);
    else answer = $("[data-form-text-answer]", card)?.value.trim() || "";
    if (validateRequired && question.obrigatoria && (!answer || (Array.isArray(answer) && !answer.length))) fail(`Responda à pergunta: ${question.enunciado}.`);
    if (answer && (Array.isArray(answer) ? answer.length : true)) answers[question.id] = answer;
  }
  return answers;
}

async function saveFormDraft() {
  if (!activeFormResponseRef || !activeFormExam || formSubmissionLocked) return;
  const answers = collectFormAnswers();
  const alunoNome = $("#form-exam-student-name").value.trim();
  await updateDoc(activeFormResponseRef, {
    alunoNome, respostas: answers, status: "em andamento", atualizadoEm: serverTimestamp()
  });
  activeFormAnswers = answers;
  $("#form-exam-save-status").textContent = "Rascunho salvo automaticamente.";
}

function queueFormDraftSave() {
  if (formSubmissionLocked) return;
  window.clearTimeout(formSaveTimer);
  $("#form-exam-save-status").textContent = "Salvando respostas...";
  formSaveTimer = window.setTimeout(() => saveFormDraft().catch(report), 600);
}

async function startFormExam(examId) {
  formSubmissionLocked = false;
  const examSnapshot = await getDoc(doc(db, "provas", examId));
  if (!examSnapshot.exists() || examSnapshot.data().status !== "disponivel" || !examSnapshot.data().modeloFormulario) fail("Este formulário não está disponível.");
  activeFormExam = { id: examSnapshot.id, ...examSnapshot.data() };
  if (!Array.isArray(activeFormExam.questoes) || !activeFormExam.questoes.length) fail("Este formulário não contém perguntas.");
  activeFormResponseRef = doc(db, "provas", examId, "respostasFormulario", user.uid);
  const savedResponse = await getDoc(activeFormResponseRef);
  activeFormAnswers = savedResponse.exists() ? savedResponse.data().respostas || {} : {};
  $("#exam-play").hidden = true;
  $("#form-exam-play").hidden = false;
  $("#form-exam-title").textContent = activeFormExam.titulo;
  $("#form-exam-description").textContent = activeFormExam.instrucoes || `${activeFormExam.disciplina} · ${activeFormExam.turma} · ${activeFormExam.data}`;
  $("#form-exam-student-name").value = savedResponse.data()?.alunoNome || userProfile.nome || "";
  $("#form-exam-questions").replaceChildren(...activeFormExam.questoes.map(renderFormQuestion));
  for (const question of activeFormExam.questoes) {
    const answer = activeFormAnswers[question.id];
    const card = $(`[data-question-id="${CSS.escape(question.id)}"]`, $("#form-exam-questions"));
    if (question.tipo === "multipla" && answer !== undefined) {
      const input = $$(`input[name="form-${CSS.escape(question.id)}"]`, card).find((item) => item.value === String(answer));
      if (input) input.checked = true;
    } else if (question.tipo === "caixas" && Array.isArray(answer)) {
      $$(`input[name="form-${CSS.escape(question.id)}"]`, card).forEach((input) => { input.checked = answer.includes(input.value); });
    } else if (answer !== undefined) {
      $("[data-form-text-answer]", card).value = answer;
    }
  }
  if (savedResponse.exists() && savedResponse.data().status === "enviada") {
    lockSubmittedForm("Este formulário já foi enviado. As respostas estão bloqueadas e não podem mais ser editadas.");
    return;
  }
  $("#submit-form-exam").hidden = false;
  $("#submit-form-exam").disabled = false;
  formExamStartedAt = Date.now();
  studentDisplayName = $("#form-exam-student-name").value.trim();
  if (!savedResponse.exists()) {
    await setDoc(activeFormResponseRef, {
      provaId: examId, alunoUid: user.uid, professorId: activeFormExam.professorId,
      turmaId: activeFormExam.turmaId, titulo: activeFormExam.titulo,
      alunoNome: studentDisplayName, respostas: {}, status: "em andamento",
      criadoEm: serverTimestamp(), atualizadaEm: serverTimestamp()
    });
  }
  startIntegrityMonitor({
    activityType: "prova", activityId: activeFormExam.id, activityTitle: activeFormExam.titulo,
    professorId: activeFormExam.professorId, enabled: activeFormExam.monitorarIntegridade !== false,
    blockContextMenu: activeFormExam.bloquearBotaoDireito === true
  });
  $("#form-exam-integrity").textContent = activeFormExam.monitorarIntegridade === false
    ? "O monitoramento está desativado pelo professor."
    : "Mudanças de aba e tentativas de copiar/colar podem ser registradas para revisão. Esses sinais não comprovam fraude isoladamente.";
  if (activeFormExam.monitorarIntegridade !== false) document.body.classList.add("integrity-active");
  $("#form-exam-questions").oninput = queueFormDraftSave;
  $("#form-exam-questions").onchange = queueFormDraftSave;
  $("#form-exam-student-name").oninput = queueFormDraftSave;
  $("#submit-form-exam").onclick = () => submitFormExam().catch(report);
  $("#form-exam-play").scrollIntoView({ behavior: "smooth" });
}

function lockSubmittedForm(message) {
  formSubmissionLocked = true;
  window.clearTimeout(formSaveTimer);
  $$("input, textarea", $("#form-exam-play")).forEach((input) => { input.disabled = true; });
  const button = $("#submit-form-exam");
  button.disabled = true;
  button.hidden = true;
  $("#form-exam-save-status").textContent = message;
}

async function submitFormExam() {
  const button = $("#submit-form-exam");
  if (formSubmissionLocked) fail("Esta prova já foi enviada. Não é possível editar as respostas.");
  button.disabled = true;
  window.clearTimeout(formSaveTimer);
  try {
    const answers = collectFormAnswers(true);
    const alunoNome = $("#form-exam-student-name").value.trim();
    if (!alunoNome) fail("Informe seu nome antes de enviar.");
    const resultRef = doc(collection(db, "provas"));
    const result = {
      ...activeFormExam, id: resultRef.id, alunoUid: user.uid, modeloProvaId: activeFormExam.id,
      alunoNome, notaAuto: null, acertos: 0, totalQuestoes: activeFormExam.questoes.length,
      revisaoManual: true, tempoSegundos: Math.round((Date.now() - formExamStartedAt) / 1000),
      status: "concluida", concluidaEm: serverTimestamp()
    };
    delete result.criadoEm;
    delete result.questoes;
    await runTransaction(db, async (transaction) => {
      const submission = await transaction.get(activeFormResponseRef);
      if (!submission.exists() || submission.data().status === "enviada") fail("Esta resposta já foi enviada.");
      transaction.set(resultRef, result);
      transaction.update(activeFormResponseRef, {
        alunoNome, respostas: answers, status: "enviada",
        resultadoId: resultRef.id, tempoSegundos: result.tempoSegundos,
        atualizadaEm: serverTimestamp(), enviadaEm: serverTimestamp()
      });
    });
    lockSubmittedForm("Respostas enviadas! A partir de agora, elas não podem mais ser editadas. O professor poderá revisar as respostas abertas e consultar o resultado.");
    await setDoc(doc(db, "alunos", user.uid, "minhas-provas", resultRef.id), {
      provaId: resultRef.id, titulo: activeFormExam.titulo, alunoNome, notaAuto: null,
      data: activeFormExam.data, turmaId: activeFormExam.turmaId, disciplina: activeFormExam.disciplina,
      acertos: 0, totalQuestoes: activeFormExam.questoes.length
    });
    stopIntegrityMonitor();
    await renderAvailableExams();
  } catch (error) {
    if (!formSubmissionLocked) button.disabled = false;
    throw error;
  }
}

async function renderAvailableExams() {
  const available = $("#available-exams");
  const completed = $("#completed-exams");
  if (!available) return;
  const [availableSnapshot, completedSnapshot] = await Promise.all([
    getDocs(query(collection(db, "provas"), where("status", "==", "disponivel"))),
    getDocs(query(collection(db, "provas"), where("alunoUid", "==", user.uid)))
  ]);
  available.innerHTML = availableSnapshot.docs.map((item) => {
    const exam = item.data();
    return `<article class="question-card form-grid"><div><strong>${escapeHtml(exam.titulo)}</strong><p>${escapeHtml(exam.disciplina)} · ${escapeHtml(exam.turma)} · ${escapeHtml(exam.data)}</p></div><button class="primary" data-exam="${escapeHtml(item.id)}">${exam.modeloFormulario ? "Responder formulário" : "Iniciar prova"}</button></article>`;
  }).join("") || "<p>Nenhuma prova disponível.</p>";
  const completedExams = completedSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => {
      const dateValue = (exam) => exam.concluidaEm?.toMillis?.() || Date.parse(exam.data || "") || 0;
      return dateValue(b) - dateValue(a);
    });
  completed.innerHTML = completedExams.map((exam) => `<article class="question-card"><strong>${escapeHtml(exam.titulo)}</strong><p>${escapeHtml(exam.disciplina)} · ${escapeHtml(exam.turma)} · ${exam.modeloFormulario && exam.notaAuto == null ? "Aguardando resultado" : `Nota ${Number(exam.notaAuto || 0).toFixed(1)} / 10`}</p><p>${exam.acertos ?? 0} de ${exam.totalQuestoes ?? 0} acertos · ${escapeHtml(exam.data || "Data não informada")}</p></article>`).join("") || "<p>Você ainda não concluiu provas.</p>";
  available.onclick = (event) => {
    const button = event.target.closest("[data-exam]");
    if (button) startExam(button.dataset.exam).catch(report);
  };
  await renderStudentDashboard(completedExams);
}

async function joinStudentClass(event) {
  event.preventDefault();
  const feedback = $("#class-join-feedback");
  const button = $("button[type='submit']", event.currentTarget);
  const codigoAcesso = $("#class-access-code").value.trim().toUpperCase();
  const nome = $("#class-student-name").value.trim();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(codigoAcesso)) fail("O código da turma precisa ter 8 caracteres.");
  if (!nome) fail("Informe seu nome para entrar na turma.");
  button.disabled = true;
  feedback.textContent = "Verificando o código...";
  try {
    const codeSnapshot = await getDoc(doc(db, "classAccessCodes", codigoAcesso));
    if (!codeSnapshot.exists()) fail("Código de turma inválido. Confira com seu professor.");
    const access = codeSnapshot.data();
    const classSnapshot = await getDoc(doc(db, "turmas", access.turmaId));
    if (!classSnapshot.exists() || classSnapshot.data().professorId !== access.professorId) fail("A turma associada a este código não está disponível.");
    const turma = { id: classSnapshot.id, ...classSnapshot.data() };
    const membershipId = `${user.uid}_${turma.id}`;
    const membershipRef = doc(db, "matriculas", membershipId);
    const existingMembership = await getDoc(membershipRef);
    if (existingMembership.exists()) fail(`Você já está inscrito em ${turma.nome}.`);
    await setDoc(membershipRef, {
      id: membershipId, alunoUid: user.uid, nome, turmaId: turma.id,
      turmaNome: turma.nome, curso: turma.curso, disciplina: turma.disciplina,
      professorId: turma.professorId, codigoAcesso, criadoEm: serverTimestamp()
    });
    await setDoc(doc(db, "users", user.uid), { nome }, { merge: true });
    userProfile.nome = nome;
    studentDisplayName = nome;
    $("#profile-name").value = nome;
    $("#student-greeting").textContent = nome;
    feedback.textContent = `Você entrou na turma ${turma.nome}.`;
    $("#class-access-code").value = "";
    await loadStudentClassroom();
  } catch (error) {
    feedback.textContent = error?.message || "Não foi possível entrar na turma.";
    console.error(error);
  } finally { button.disabled = false; }
}

function renderClassroomPost(post) {
  const externalLink = post.linkExterno && /^https?:\/\//i.test(post.linkExterno)
    ? `<p><a href="${escapeHtml(post.linkExterno)}" target="_blank" rel="noopener noreferrer">Abrir material complementar</a></p>`
    : "";
  const file = post.arquivoPath
    ? `<div class="post-file"><span>${escapeHtml(post.arquivoNome || "Arquivo")}</span><button type="button" class="secondary" data-open-file="${escapeHtml(post.arquivoPath)}" data-file-type="${escapeHtml(post.arquivoTipo || "")}">Abrir arquivo no site</button><div class="file-preview" data-file-preview hidden></div></div>`
    : "";
  const activity = post.atividadeTipo === "prova"
    ? `<button type="button" class="primary" data-exam="${escapeHtml(post.atividadeId)}">Fazer prova: ${escapeHtml(post.atividadeNome)}</button>`
    : post.atividadeTipo === "quiz"
      ? `<a class="primary classroom-activity-link" href="./join.html?pin=${encodeURIComponent(post.pin)}">Entrar no quiz ao vivo · PIN ${escapeHtml(post.pin)}</a>`
      : "";
  return `<article class="question-card classroom-post" data-post-id="${escapeHtml(post.id)}" data-class-id="${escapeHtml(post.turmaId)}"><div class="post-heading"><span class="pill">${post.tipo === "atividade" ? "Atividade" : "Aula"}</span><strong>${escapeHtml(post.titulo)}</strong></div><p>${escapeHtml(post.turmaNome)} · ${escapeHtml(post.curso)} · ${escapeHtml(post.disciplina)}</p>${post.professorNome ? `<p>Professor(a): ${escapeHtml(post.professorNome)}</p>` : ""}<p>${escapeHtml(post.conteudo)}</p>${externalLink}${file}${activity}<section class="comment-panel"><button type="button" class="secondary" data-load-comments>Comentários e reações</button><div data-comments-holder hidden></div></section></article>`;
}

async function openClassroomFile(button) {
  const preview = $("[data-file-preview]", button.parentElement);
  button.disabled = true;
  try {
    const blob = await getBlob(ref(storage, button.dataset.openFile));
    const url = URL.createObjectURL(blob);
    classroomObjectUrls.add(url);
    const fileType = button.dataset.fileType || blob.type;
    let viewer;
    if (fileType.startsWith("image/")) {
      viewer = document.createElement("img");
      viewer.alt = "Arquivo da aula";
    } else if (fileType.startsWith("video/")) {
      viewer = document.createElement("video");
      viewer.controls = true;
    } else if (fileType.startsWith("audio/")) {
      viewer = document.createElement("audio");
      viewer.controls = true;
    } else {
      viewer = document.createElement("iframe");
      viewer.title = "Visualização do material";
      viewer.loading = "lazy";
    }
    viewer.src = url;
    viewer.className = "classroom-file-viewer";
    preview.replaceChildren(viewer);
    preview.hidden = false;
    button.textContent = "Fechar arquivo";
    button.dataset.open = "true";
  } catch (error) {
    const message = error?.code === "storage/bucket-not-found"
      ? "O Firebase Storage ainda não está inicializado."
      : error?.message || "Não foi possível abrir o arquivo.";
    report(new Error(message));
  } finally {
    button.disabled = false;
  }
}

async function loadStudentClassroom() {
  const classList = $("#student-classes");
  const feed = $("#class-feed");
  if (!classList || !feed) return;
  classroomObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  classroomObjectUrls.clear();
  const membershipSnapshot = await getDocs(query(collection(db, "matriculas"), where("alunoUid", "==", user.uid)));
  const memberships = membershipSnapshot.docs.map((item) => item.data());
  const classesWithPosts = await Promise.all(memberships.map(async (membership) => {
    const classSnapshot = await getDoc(doc(db, "turmas", membership.turmaId));
    if (!classSnapshot.exists()) return { membership, turma: null, posts: [] };
    const turma = { id: classSnapshot.id, ...classSnapshot.data() };
    const postsSnapshot = await getDocs(query(collection(db, "turmas", turma.id, "publicacoes"), where("arquivado", "==", false)));
    const posts = postsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .filter((post) => !post.arquivado);
    return { membership, turma, posts };
  }));
  classList.innerHTML = memberships.length ? classesWithPosts.map(({ membership }) =>
    `<p>${escapeHtml(membership.turmaNome)} · ${escapeHtml(membership.curso)} · ${escapeHtml(membership.disciplina)}</p>`
  ).join("") : "<p>Você ainda não entrou em nenhuma turma.</p>";
  const posts = classesWithPosts.flatMap(({ turma, posts }) =>
    posts.map((post) => ({ ...post, turmaId: turma?.id || post.turmaId, turmaNome: turma?.nome || post.turmaNome, curso: turma?.curso || post.curso, disciplina: turma?.disciplina || post.disciplina }))
  ).sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
  feed.innerHTML = posts.length ? posts.map(renderClassroomPost).join("") : "<p>Não há aulas ou atividades publicadas para suas turmas.</p>";
  $$(".classroom-post", feed).forEach((card, index) => {
    const post = posts[index];
    setupCommentPanel(db, ["turmas", post.turmaId, "publicacoes", post.id], $(".comment-panel", card), {
      userId: user.uid, name: studentDisplayName || userProfile.nome || "Aluno(a)", role: "aluno"
    }, report);
  });
  feed.onclick = (event) => {
    const fileButton = event.target.closest("[data-open-file]");
    if (fileButton) {
      if (fileButton.dataset.open === "true") {
        const preview = $("[data-file-preview]", fileButton.parentElement);
        preview.replaceChildren();
        preview.hidden = true;
        fileButton.textContent = "Abrir arquivo no site";
        fileButton.dataset.open = "false";
        return;
      }
      openClassroomFile(fileButton).catch(report);
      return;
    }
    const examButton = event.target.closest("[data-exam]");
    if (examButton) startExam(examButton.dataset.exam).catch(report);
  };
}

function setupClassEnrollment() {
  const form = $("#class-join-form");
  if (!form) return;
  $("#class-student-name").value = userProfile.nome || "";
  form.addEventListener("submit", (event) => joinStudentClass(event).catch(report));
  loadStudentClassroom().catch(report);
}

function auraMasterMedal(position) {
  if (position === 1) return { icon: "💎", name: "Diamante" };
  if (position <= 3) return { icon: "🥇", name: "Ouro" };
  if (position <= 10) return { icon: "🥈", name: "Prata" };
  return { icon: "🥉", name: "Bronze" };
}

async function renderAuraMasterRanking() {
  const holder = $("#aura-ranking");
  if (!holder) return;
  const snapshot = await getDocs(collection(db, "rankingQuizzes"));
  const groups = new Map();
  snapshot.docs.map((item) => item.data()).filter((item) => item.finalizado === true).forEach((entry) => {
    const groupId = entry.turmaId || `curso:${entry.curso || "geral"}`;
    const groupName = [entry.curso, entry.turma].filter(Boolean).join(" · ") || "Turma/curso não informado";
    const group = groups.get(groupId) || { name: groupName, students: new Map() };
    if (groupName !== "Turma/curso não informado") group.name = groupName;
    const student = group.students.get(entry.jogadorId) || {
      uid: entry.jogadorId, name: entry.apelido || "Aluno", points: 0, correct: 0
    };
    student.points += Number(entry.pontuacao || 0);
    student.correct += Number(entry.acertos || 0);
    if ((entry.atualizadaEm?.toMillis?.() || 0) >= (student.updatedAt || 0)) {
      student.name = entry.apelido || student.name;
      student.updatedAt = entry.atualizadaEm?.toMillis?.() || 0;
    }
    group.students.set(entry.jogadorId, student);
    groups.set(groupId, group);
  });
  const filter = $("#aura-ranking-filter");
  const previous = filter.value;
  const orderedGroups = [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "pt-BR"));
  filter.innerHTML = `<option value="">Todas as turmas e cursos</option>${orderedGroups.map(([id, group]) => `<option value="${escapeHtml(id)}">${escapeHtml(group.name)}</option>`).join("")}`;
  if (groups.has(previous)) filter.value = previous;
  const render = () => {
    const selected = filter.value;
    const visibleGroups = orderedGroups.filter(([id]) => !selected || id === selected);
    holder.innerHTML = visibleGroups.map(([, group]) => {
      const students = [...group.students.values()].sort((a, b) =>
        b.points - a.points || b.correct - a.correct || a.name.localeCompare(b.name, "pt-BR")
      );
      const rows = students.map((student, index) => {
        const position = index + 1;
        const medal = auraMasterMedal(position);
        return `<tr class="${student.uid === user.uid ? "student-rank" : ""}"><td>${position}º</td><td>${escapeHtml(student.name)}${student.uid === user.uid ? " (você)" : ""}</td><td>${student.points} pts</td><td>${medal.icon} ${medal.name}</td></tr>`;
      }).join("");
      return `<article class="question-card"><h3>${escapeHtml(group.name)}</h3><div class="table-wrap"><table class="ranking-table"><thead><tr><th>Posição</th><th>Aluno</th><th>Pontos acumulados</th><th>Recompensa digital</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
    }).join("") || "<p>As medalhas AuraMaster TI aparecerão após a conclusão de quizzes associados a uma turma ou curso.</p>";
  };
  filter.onchange = render;
  render();
}

async function renderStudentDashboard(completedExams) {
  const rankingHolder = $("#quiz-rankings");
  let rankings = [];
  let leaderboardPlacements = [];
  try {
    const snapshot = await getDocs(query(collection(db, "rankingQuizzes"), where("jogadorId", "==", user.uid)));
    rankings = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    leaderboardPlacements = await Promise.all(rankings.map(async (entry) => {
      const snapshot = await getDocs(query(collection(db, "rankingQuizzes"), where("sessaoId", "==", entry.sessaoId)));
      const players = snapshot.docs.map((item) => item.data()).sort((a, b) =>
        Number(b.pontuacao || 0) - Number(a.pontuacao || 0)
        || Number(b.acertos || 0) - Number(a.acertos || 0)
        || String(a.apelido || "").localeCompare(String(b.apelido || ""), "pt-BR")
      );
      const position = players.findIndex((player) => player.jogadorId === user.uid) + 1;
      return { entry, players, position };
    }));
    rankingHolder.innerHTML = leaderboardPlacements.length ? leaderboardPlacements.map(({ entry, players, position }) => {
      const rows = players.map((player, index) => `<tr class="${player.jogadorId === user.uid ? "student-rank" : ""}"><td>${index + 1}º</td><td>${escapeHtml(player.apelido || "Aluno")}${player.jogadorId === user.uid ? " (você)" : ""}</td><td>${Number(player.pontuacao || 0)} pts</td></tr>`).join("");
      return `<article class="question-card"><strong>${escapeHtml(entry.titulo || "Quiz")}</strong><p>${position ? `${position}º lugar de ${players.length}` : "Sua colocação ainda não está disponível"} · ${Number(entry.acertos || 0)}/${Number(entry.totalRespondidas || 0)} acertos · ${Number(entry.pontuacao || 0)} pontos${entry.finalizado ? " · Concluído" : " · Em andamento"}</p><div class="table-wrap"><table class="ranking-table"><thead><tr><th>Posição</th><th>Aluno</th><th>Pontuação</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
    }).join("") : "<p>Seus rankings aparecerão aqui depois que você participar de um quiz.</p>";
  } catch (error) {
    rankingHolder.textContent = "Não foi possível carregar os rankings agora.";
    console.error(error);
    report(error);
  }
  try {
    await renderAuraMasterRanking();
  } catch (error) {
    $("#aura-ranking").textContent = "Não foi possível carregar o ranking AuraMaster TI.";
    report(error);
  }

  const finishedQuizzes = rankings.filter((entry) => entry.finalizado === true);
  const examAverage = completedExams.length
    ? completedExams.reduce((sum, exam) => sum + Number(exam.notaAuto || 0), 0) / completedExams.length
    : null;
  $("#stat-completed-exams").textContent = String(completedExams.length);
  $("#stat-completed-quizzes").textContent = String(finishedQuizzes.length);
  $("#stat-exam-average").textContent = examAverage === null ? "—" : `${examAverage.toFixed(1)} / 10`;

  const activityCount = completedExams.length + finishedQuizzes.length;
  const highestRank = leaderboardPlacements.some(({ entry, position }) => entry.finalizado && position === 1);
  const perfectScore = completedExams.some((exam) => Number(exam.notaAuto) >= 10)
    || finishedQuizzes.some((entry) => Number(entry.totalQuestoes) > 0
      && Number(entry.totalRespondidas) === Number(entry.totalQuestoes)
      && Number(entry.acertos) === Number(entry.totalQuestoes));
  const trophies = [
    { icon: "🎯", title: "Primeira atividade", detail: "Conclua uma prova ou quiz.", earned: activityCount >= 1 },
    { icon: "🏆", title: "No topo", detail: "Fique em 1º lugar em um quiz.", earned: highestRank },
    { icon: "💯", title: "Nota máxima", detail: "Acerte todas as questões de uma atividade.", earned: perfectScore },
    { icon: "📚", title: "Estudante dedicado", detail: "Conclua 5 atividades.", earned: activityCount >= 5 },
    { icon: "⚡", title: "Quizzeiro", detail: "Conclua 5 quizzes.", earned: finishedQuizzes.length >= 5 }
  ];
  $("#student-trophies").innerHTML = trophies.map((trophy) => `<article class="trophy-card ${trophy.earned ? "earned" : ""}"><span class="trophy-icon" aria-hidden="true">${trophy.icon}</span><div><strong>${trophy.earned ? "Conquistado: " : ""}${trophy.title}</strong><span>${trophy.detail}</span></div></article>`).join("");
}

async function startExam(examId) {
  const examSnapshot = await getDoc(doc(db, "provas", examId));
  if (!examSnapshot.exists() || examSnapshot.data().status !== "disponivel") fail("Esta prova não está disponível.");
  if (examSnapshot.data().modeloFormulario) return startFormExam(examId);
  activeExam = { id: examSnapshot.id, ...examSnapshot.data() };
  activeExamQuestions = await Promise.all(activeExam.questoesIds.map(readQuestionForExam));
  $("#exam-play").hidden = false;
  $("#exam-title").textContent = activeExam.titulo;
  $("#exam-play-questions").replaceChildren(...activeExamQuestions.map(renderExamQuestion));
  $("#exam-student-name").value = userProfile.nome || user.displayName || "";
  examStartedAt = Date.now();
  studentDisplayName = $("#exam-student-name").value.trim();
  $("#exam-student-name").addEventListener("input", (event) => {
    studentDisplayName = event.target.value.trim();
  });
  startIntegrityMonitor({
    activityType: "prova", activityId: activeExam.id, activityTitle: activeExam.titulo,
    professorId: activeExam.professorId, enabled: activeExam.monitorarIntegridade !== false,
    blockContextMenu: activeExam.bloquearBotaoDireito === true
  });
  if (activeExam.monitorarIntegridade === false) {
    $("#integrity-notice").textContent = "O monitoramento está desativado pelo professor.";
  } else {
    $("#integrity-notice").textContent = "A atividade registra mudanças de aba e tentativas de copiar/colar para revisão do professor. Esses sinais não comprovam fraude isoladamente.";
  }
  if (activeExam.monitorarIntegridade !== false) document.body.classList.add("integrity-active");
  $("#submit-exam").onclick = () => submitExam().catch(report);
  $("#exam-play").scrollIntoView({ behavior: "smooth" });
}

async function submitExam() {
  const alunoNome = $("#exam-student-name").value.trim();
  if (!alunoNome) fail("Informe seu nome antes de finalizar.");
  let acertos = 0;
  const submittedAnswers = [];
  for (const [index, question] of activeExamQuestions.entries()) {
    const card = $$(".exam-question")[index];
    let acertou = false;
    let resposta;
    if (question.tipo === "lacuna") {
      resposta = $$(".question-text select", card).map((select) => ({ index: Number(select.dataset.gap), resposta: select.value }));
      if (resposta.some((item) => !item.resposta)) fail(`Responda todas as lacunas da questão ${index + 1}.`);
      acertou = resposta.length === question.lacunas.length && resposta.every((item) => question.lacunas.find((gap) => Number(gap.index) === item.index)?.resposta === item.resposta);
    } else {
      const chosenId = $(`input[name="exam-${CSS.escape(question.id)}"]:checked`, card)?.value;
      if (!chosenId) fail(`Responda a questão ${index + 1}.`);
      const chosen = question.options.find((item) => item.id === chosenId);
      resposta = chosen?.texto || "";
      acertou = chosen?.correta === true;
    }
    if (acertou) acertos += 1;
    submittedAnswers.push({ question, acertou, resposta });
  }
  const notaAuto = Math.round((acertos / activeExamQuestions.length) * 100) / 10;
  $("#student-exam-grade").value = notaAuto.toFixed(1);
  const proofRef = doc(collection(db, "provas"));
  const completed = {
    ...activeExam, id: proofRef.id, professorId: activeExam.professorId, alunoUid: user.uid,
    modeloProvaId: activeExam.id,
    alunoNome, notaAuto, acertos, totalQuestoes: activeExamQuestions.length,
    tempoSegundos: Math.round((Date.now() - examStartedAt) / 1000), status: "concluida",
    concluidaEm: serverTimestamp()
  };
  delete completed.criadoEm;
  await setDoc(proofRef, completed);
  await setDoc(doc(db, "alunos", user.uid, "minhas-provas", proofRef.id), {
    provaId: proofRef.id, titulo: activeExam.titulo, alunoNome, notaAuto,
    data: activeExam.data, turmaId: activeExam.turmaId, disciplina: activeExam.disciplina,
    acertos, totalQuestoes: activeExamQuestions.length
  });
  for (const entry of submittedAnswers) {
    const responseRef = doc(db, "respostas", `${proofRef.id}_${entry.question.id}_${user.uid}`);
    await setDoc(responseRef, {
      id: responseRef.id, alunoUid: user.uid, apelido: alunoNome, questionId: entry.question.id,
      professorId: activeExam.professorId, acertou: entry.acertou, resposta: entry.resposta,
      tempoResposta: Math.round((Date.now() - examStartedAt) / 1000), data: serverTimestamp(),
      provaId: proofRef.id, turmaId: activeExam.turmaId, titulo: activeExam.titulo
    });
  }
  stopIntegrityMonitor();
  $("#exam-play").hidden = true;
  await renderAvailableExams();
  window.alert(`Prova finalizada! Sua nota foi ${notaAuto.toFixed(1)} / 10.`);
}

async function initializeStudentPage() {
  const path = pagePath();
  if (path.endsWith("/join")) {
    if (userProfile.nome) $("#nickname").value = userProfile.nome.slice(0, 30);
    const pin = new URLSearchParams(location.search).get("pin");
    if (pin && /^\d{6}$/.test(pin)) $("#game-pin").value = pin;
    $("#join-form").addEventListener("submit", (event) => enterSession(event).catch(report));
  }
  if (path.endsWith("/jogar")) await setupGame();
  if (path.endsWith("/minhas-provas")) {
    await renderAvailableExams();
    setupProfile();
    setupClassEnrollment();
    const sharedExamId = new URLSearchParams(location.search).get("prova");
    if (sharedExamId) await startFormExam(sharedExamId);
  }
}

onAuthStateChanged(auth, async (account) => {
  try {
    if (!account || !account.isAnonymous) {
      await signInAnonymously(auth);
      return;
    }
    user = account;
    const access = await readAccountAccess(db, account);
    if (!access.allowed) {
      errorBox.textContent = `Esta conta está ${access.status === "banned" ? "banida" : "desativada"} no site.${access.reason ? ` Motivo: ${access.reason}` : ""}`;
      return;
    }
    startAccessMonitoring(db, account);
    showMasterLink(account);
    const path = pagePath();
    if (path.endsWith("/minhas-provas") || path.endsWith("/join")) {
      const profileRef = doc(db, "users", user.uid);
      const profileSnapshot = await getDoc(profileRef);
      userProfile = profileSnapshot.exists() ? profileSnapshot.data() : {};
      studentDisplayName = userProfile.nome || user.displayName || "";
      if (path.endsWith("/minhas-provas")) {
        await setDoc(profileRef, {
          uid: user.uid, nome: userProfile.nome || user.displayName || "Aluno(a)", email: user.email || "",
          role: "aluno", escola: "PEI Riolando Canno"
        }, { merge: true });
        if (!userProfile.nome) userProfile.nome = user.displayName || "";
      }
    }
    await initializeStudentPage();
  } catch (error) { report(error); }
});

setupSoundEffects();
setupTutorial();
window.addEventListener("beforeunload", () => {
  sessionUnsubscribe?.();
  window.clearTimeout(advanceTimer);
  window.clearInterval(questionTimer);
  classroomObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  stopIntegrityMonitor();
});

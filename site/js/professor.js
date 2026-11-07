import { auth, db, storage } from "./firebase-config.js";
import {
  collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, runTransaction,
  serverTimestamp, setDoc, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { setupCommentPanel } from "./classroom-interactions.js";
import { isMasterAccount, readAccountAccess, showMasterLink, startAccessMonitoring, stopAccessMonitoring } from "./access-monitor.js";
import { setupSoundEffects } from "./sound-effects.js";
import { setupTutorial } from "./tutorial.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pagePath = () => location.pathname.toLowerCase().replace(/\.html$/, "").replace(/\/+$/, "");
const pageError = $("#page-error");
let currentUser;
let quizzes = [];
let classes = [];
let activeSessionUnsubscribe;
let activeSessionsUnsubscribe;
let activeSessionId;
let teacherName = "";
let teacherProofs = [];
const academicCatalog = { disciplinas: [], cursos: [] };
const defaultAcademicOptions = {
  disciplinas: ["Matemática", "Português", "História", "Geografia", "Biologia", "Física", "Química", "Filosofia", "Sociologia", "Inglês", "Artes"],
  cursos: ["Mecânica", "Eletrônica", "Informática", "Logística"]
};

function generateClassCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
}

async function ensureClassAccessCode(classItem) {
  if (classItem.codigoAcesso) return classItem.codigoAcesso;
  const classRef = doc(db, "turmas", classItem.id);
  const code = await runTransaction(db, async (transaction) => {
    const classSnapshot = await transaction.get(classRef);
    if (!classSnapshot.exists()) fail(`A turma "${classItem.nome}" não existe mais.`);
    const existingCode = classSnapshot.data().codigoAcesso;
    if (existingCode) return existingCode;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = generateClassCode();
      const codeRef = doc(db, "classAccessCodes", candidate);
      const codeSnapshot = await transaction.get(codeRef);
      if (codeSnapshot.exists()) continue;
      transaction.update(classRef, { codigoAcesso: candidate });
      transaction.set(codeRef, {
        id: candidate, turmaId: classItem.id, professorId: currentUser.uid,
        criadoEm: serverTimestamp()
      });
      return candidate;
    }
    fail("Não foi possível gerar um código de turma exclusivo. Tente novamente.");
  });
  classItem.codigoAcesso = code;
  return code;
}

async function createClassAccessCode(classRef, turma) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateClassCode();
    const codeRef = doc(db, "classAccessCodes", candidate);
    const created = await runTransaction(db, async (transaction) => {
      const codeSnapshot = await transaction.get(codeRef);
      if (codeSnapshot.exists()) return false;
      transaction.set(classRef, { ...turma, codigoAcesso: candidate });
      transaction.set(codeRef, {
        id: candidate, turmaId: classRef.id, professorId: currentUser.uid,
        criadoEm: serverTimestamp()
      });
      return true;
    });
    if (created) return candidate;
  }
  fail("Não foi possível gerar um código de turma exclusivo. Tente novamente.");
}

function report(error) {
  if (pageError) pageError.textContent = error?.message || "Não foi possível concluir a operação.";
  console.error(error);
}

function watchIntegrityEvents() {
  const holder = $("#integrity-events");
  if (!holder) return;
  const eventLabels = {
    mudanca_aba: "Saiu da aba da atividade",
    tentativa_copiar: "Tentou copiar conteúdo",
    tentativa_recortar: "Tentou recortar conteúdo",
    tentativa_colar: "Tentou colar conteúdo",
    botao_direito: "Tentou abrir o menu do botão direito"
  };
  onSnapshot(query(collection(db, "penalidades"), where("professorId", "==", currentUser.uid)), (snapshot) => {
    const entries = snapshot.docs.map((item) => item.data()).sort((a, b) => {
      const aTime = a.data?.toMillis?.() || 0;
      const bTime = b.data?.toMillis?.() || 0;
      return bTime - aTime;
    }).slice(0, 100);
    holder.innerHTML = entries.length ? entries.map((entry) => {
      const occurredAt = entry.data?.toDate?.().toLocaleString("pt-BR") || "agora";
      const activity = entry.atividadeTipo === "prova" ? "Prova" : "Quiz";
      return `<article class="integrity-event"><strong>${escapeHtml(entry.alunoNome || "Aluno")}</strong><span>${escapeHtml(eventLabels[entry.tipo] || entry.tipo)}</span><span>${activity} · ${escapeHtml(entry.atividadeTitulo || entry.atividadeId)}</span><time>${escapeHtml(occurredAt)}</time></article>`;
    }).join("") : "<p>Nenhuma ocorrência registrada.</p>";
  }, report);
}

function fail(message) {
  throw new Error(message);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function makeSelectOptions(values) {
  return values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
}

function academicOptions(type) {
  const field = type === "curso" ? "curso" : "disciplina";
  return [...new Set([
    ...academicCatalog[type === "curso" ? "cursos" : "disciplinas"],
    ...classes.map((item) => item[field]),
    ...quizzes.map((item) => item[field])
  ].map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function refreshAcademicSelects() {
  $$('select[name="disciplina"]').forEach((select) => {
    const previous = select.value;
    select.innerHTML = `<option value="">Selecione uma disciplina</option>${makeSelectOptions(academicOptions("disciplina"))}`;
    if (academicOptions("disciplina").includes(previous)) select.value = previous;
  });
  $$('select[name="curso"]').forEach((select) => {
    const previous = select.value;
    select.innerHTML = `<option value="">Selecione um curso</option>${makeSelectOptions(academicOptions("curso"))}`;
    if (academicOptions("curso").includes(previous)) select.value = previous;
  });
  renderAcademicCatalog();
}

async function loadAcademicCatalog() {
  const catalogRef = doc(db, "catalogosAcademicos", currentUser.uid);
  const snapshot = await getDoc(catalogRef);
  const normalize = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (snapshot.exists()) {
    const data = snapshot.data();
    academicCatalog.disciplinas = normalize([...(Array.isArray(data.disciplinas) ? data.disciplinas : []), ...classes.map((item) => item.disciplina), ...quizzes.map((item) => item.disciplina)]);
    academicCatalog.cursos = normalize([...(Array.isArray(data.cursos) ? data.cursos : []), ...classes.map((item) => item.curso), ...quizzes.map((item) => item.curso)]);
    return;
  }
  academicCatalog.disciplinas = normalize([...defaultAcademicOptions.disciplinas, ...classes.map((item) => item.disciplina), ...quizzes.map((item) => item.disciplina)]);
  academicCatalog.cursos = normalize([...defaultAcademicOptions.cursos, ...classes.map((item) => item.curso), ...quizzes.map((item) => item.curso)]);
  await setDoc(catalogRef, {
    professorId: currentUser.uid, ...academicCatalog, atualizadoEm: serverTimestamp()
  });
}

function renderAcademicCatalog() {
  const render = (holder, type) => {
    if (!holder) return;
    const values = academicCatalog[type === "curso" ? "cursos" : "disciplinas"];
    holder.innerHTML = values.length ? values.map((value) => `<article class="catalog-item"><strong>${escapeHtml(value)}</strong><div><button class="secondary" type="button" data-edit-catalog="${type}" data-catalog-value="${escapeHtml(value)}">Editar nome</button><button class="danger" type="button" data-delete-catalog="${type}" data-catalog-value="${escapeHtml(value)}">Excluir</button></div></article>`).join("") : "<p>Nenhuma opção cadastrada.</p>";
  };
  render($("#discipline-catalog-list"), "disciplina");
  render($("#course-catalog-list"), "curso");
}

async function findAcademicReferences(type, value) {
  const field = type === "curso" ? "curso" : "disciplina";
  const [classSnapshot, quizSnapshot, proofSnapshot] = await Promise.all([
    getDocs(query(collection(db, "turmas"), where("professorId", "==", currentUser.uid))),
    getDocs(query(collection(db, "quizzes"), where("professorId", "==", currentUser.uid))),
    getDocs(query(collection(db, "provas"), where("professorId", "==", currentUser.uid)))
  ]);
  const updates = [];
  const matchingClasses = classSnapshot.docs.filter((item) => item.data()[field] === value);
  const matchingQuizzes = quizSnapshot.docs.filter((item) => item.data()[field] === value);
  const matchingProofs = proofSnapshot.docs.filter((item) => item.data()[field] === value);
  matchingClasses.forEach((item) => updates.push({ ref: item.ref }));
  matchingQuizzes.forEach((item) => updates.push({ ref: item.ref }));
  matchingProofs.forEach((item) => updates.push({ ref: item.ref }));
  for (const classDoc of classSnapshot.docs) {
    const posts = await getDocs(collection(db, "turmas", classDoc.id, "publicacoes"));
    posts.docs.filter((item) => item.data()[field] === value)
      .forEach((item) => updates.push({ ref: item.ref }));
  }
  return { updates, matchingClasses, matchingQuizzes, matchingProofs };
}

async function saveCatalogRename(type, oldValue, newValue) {
  const field = type === "curso" ? "curso" : "disciplina";
  const listKey = type === "curso" ? "cursos" : "disciplinas";
  const references = await findAcademicReferences(type, oldValue);
  if (references.updates.length > 450) fail("Há mais de 450 registros vinculados. Não foi feita nenhuma alteração; peça ajuda para atualizar esse catálogo com segurança.");
  const nextValues = academicCatalog[listKey].map((value) => value === oldValue ? newValue : value);
  const batch = writeBatch(db);
  references.updates.forEach(({ ref: recordRef }) => batch.update(recordRef, { [field]: newValue }));
  batch.set(doc(db, "catalogosAcademicos", currentUser.uid), {
    professorId: currentUser.uid, [listKey]: nextValues, atualizadoEm: serverTimestamp()
  }, { merge: true });
  await batch.commit();
  academicCatalog[listKey] = [...new Set(nextValues)].sort((a, b) => a.localeCompare(b, "pt-BR"));
  classes = classes.map((item) => item[field] === oldValue ? { ...item, [field]: newValue } : item);
  quizzes = quizzes.map((item) => item[field] === oldValue ? { ...item, [field]: newValue } : item);
  teacherProofs = teacherProofs.map((item) => item[field] === oldValue ? { ...item, [field]: newValue } : item);
  refreshAcademicSelects();
  renderClassList();
}

async function saveCatalogDelete(type, value) {
  const listKey = type === "curso" ? "cursos" : "disciplinas";
  const references = await findAcademicReferences(type, value);
  if (references.updates.length) {
    fail(`Não é possível excluir: "${value}" ainda está vinculado a ${references.matchingClasses.length} turma(s), ${references.matchingQuizzes.length} quiz(es), ${references.matchingProofs.length} prova(s) ou publicações. Edite o nome para atualizar esses registros ou remova os vínculos primeiro.`);
  }
  const previousValues = academicCatalog[listKey];
  academicCatalog[listKey] = previousValues.filter((item) => item !== value);
  try {
    await setDoc(doc(db, "catalogosAcademicos", currentUser.uid), {
      professorId: currentUser.uid, [listKey]: academicCatalog[listKey], atualizadoEm: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    academicCatalog[listKey] = previousValues;
    throw error;
  }
  refreshAcademicSelects();
}

function setupAcademicCatalog() {
  const form = $("#catalog-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const feedback = $("#catalog-feedback");
    const data = new FormData(form);
    const type = String(data.get("tipo"));
    const value = String(data.get("nome") || "").trim();
    const listKey = type === "curso" ? "cursos" : "disciplinas";
    if (!value || value.length > 120) {
      feedback.textContent = "Informe um nome com até 120 caracteres.";
      return;
    }
    if (academicCatalog[listKey].length >= 150) {
      feedback.textContent = "Este catálogo atingiu o limite de 150 opções.";
      return;
    }
    if (academicCatalog[listKey].some((item) => item.toLocaleLowerCase("pt-BR") === value.toLocaleLowerCase("pt-BR"))) {
      feedback.textContent = "Essa opção já está cadastrada.";
      return;
    }
    const button = $("button[type='submit']", form);
    button.disabled = true;
    feedback.textContent = "Salvando opção...";
    try {
      academicCatalog[listKey] = [...academicCatalog[listKey], value].sort((a, b) => a.localeCompare(b, "pt-BR"));
      await setDoc(doc(db, "catalogosAcademicos", currentUser.uid), {
        professorId: currentUser.uid, [listKey]: academicCatalog[listKey], atualizadoEm: serverTimestamp()
      }, { merge: true });
      form.reset();
      refreshAcademicSelects();
      feedback.textContent = `${type === "curso" ? "Curso" : "Disciplina"} cadastrado(a).`;
    } catch (error) {
      academicCatalog[listKey] = academicCatalog[listKey].filter((item) => item !== value);
      feedback.textContent = error?.message || "Não foi possível cadastrar a opção.";
      console.error(error);
    } finally {
      button.disabled = false;
    }
  });
  $(".catalog-lists").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-edit-catalog], [data-delete-catalog]");
    if (!button) return;
    const type = button.dataset.editCatalog || button.dataset.deleteCatalog;
    const value = button.dataset.catalogValue;
    const feedback = $("#catalog-feedback");
    button.disabled = true;
    feedback.textContent = "";
    try {
      if (button.hasAttribute("data-edit-catalog")) {
        const newValue = prompt("Novo nome:", value)?.trim();
        if (!newValue || newValue === value) return;
        if (newValue.length > 120) fail("O nome deve ter até 120 caracteres.");
        const listKey = type === "curso" ? "cursos" : "disciplinas";
        if (academicCatalog[listKey].some((item) => item !== value && item.toLocaleLowerCase("pt-BR") === newValue.toLocaleLowerCase("pt-BR"))) fail("Já existe uma opção com esse nome.");
        await saveCatalogRename(type, value, newValue);
        feedback.textContent = `Nome atualizado. Os registros vinculados a "${value}" também foram atualizados.`;
      } else {
        if (!confirm(`Excluir "${value}" do catálogo?`)) return;
        await saveCatalogDelete(type, value);
        feedback.textContent = "Opção excluída.";
      }
    } catch (error) {
      feedback.textContent = error?.message || "Não foi possível atualizar o catálogo.";
      console.error(error);
    } finally {
      button.disabled = false;
    }
  });
}

async function loadTeacherData() {
  const classSnapshot = await getDocs(query(collection(db, "turmas"), where("professorId", "==", currentUser.uid)));
  classes = classSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  await Promise.all(classes.map((item) => ensureClassAccessCode(item).catch(report)));
  try {
    const quizSnapshot = await getDocs(query(collection(db, "quizzes"), where("professorId", "==", currentUser.uid)));
    quizzes = quizSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    quizzes = [];
    report(new Error(`As turmas foram carregadas, mas não foi possível carregar os quizzes: ${error.message}`));
  }
  refreshAcademicSelects();
}

function fillClassSelect(selector) {
  const element = $(selector);
  if (!element) return;
  const previousValue = element.value;
  element.innerHTML = `<option value="">${classes.length ? "Selecione" : "Nenhuma turma cadastrada — atualize a lista"}</option>${classes.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nome)} — ${escapeHtml(item.curso)}</option>`).join("")}`;
  if (classes.some((item) => item.id === previousValue)) element.value = previousValue;
  element.disabled = false;
  const emptyMessage = selector === "#quiz-turma" ? $("#quiz-class-empty") : $("#exam-class-empty");
  if (emptyMessage) emptyMessage.hidden = classes.length > 0;
  renderClassList();
}

function renderClassList() {
  const list = $("#class-list");
  if (!list) return;
  list.innerHTML = classes.length
    ? classes.map((item) => `<p>${escapeHtml(item.nome)} · ${escapeHtml(item.curso)} · ${escapeHtml(item.disciplina)}${item.codigoAcesso ? ` · Código: <code>${escapeHtml(item.codigoAcesso)}</code>` : ""}</p>`).join("")
    : "<p>Nenhuma turma cadastrada para este professor.</p>";
}

async function reloadClasses() {
  const button = $("#refresh-classes");
  const feedback = $("#class-feedback");
  if (button) button.disabled = true;
  if (feedback) feedback.textContent = "Buscando turmas cadastradas...";
  try {
    const snapshot = await getDocs(query(collection(db, "turmas"), where("professorId", "==", currentUser.uid)));
    classes = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    await Promise.all(classes.map((item) => ensureClassAccessCode(item)));
    refreshAcademicSelects();
    fillClassSelect("#quiz-turma");
    fillClassSelect("#exam-turma");
    fillClassSelect("#publication-class");
    const filter = $("#publication-filter");
    if (filter) {
      const previousFilter = filter.value;
      filter.innerHTML = `<option value="">Todas as turmas</option>${classes.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nome)}</option>`).join("")}`;
      if (classes.some((item) => item.id === previousFilter)) filter.value = previousFilter;
    }
    if (button) button.textContent = `Turmas atualizadas (${classes.length})`;
    if (feedback) feedback.textContent = classes.length
      ? `${classes.length} turma(s) carregada(s).`
      : "Nenhuma turma encontrada para esta conta de professor.";
    return classes;
  } catch (error) {
    const message = `Não foi possível buscar as turmas: ${error.message}`;
    if (feedback) feedback.textContent = message;
    report(new Error(message));
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

async function persistClass(data) {
  const nome = String(data.get("nome") || "").trim();
  const curso = String(data.get("curso") || "").trim();
  const disciplina = String(data.get("disciplina") || "").trim();
  if (!nome || !curso || !disciplina) fail("Preencha o nome, o curso e a disciplina da turma.");
  const classRef = doc(collection(db, "turmas"));
  const turma = { id: classRef.id, professorId: currentUser.uid, nome, curso, disciplina, criadoEm: serverTimestamp() };
  turma.codigoAcesso = await createClassAccessCode(classRef, turma);
  classes.push({ ...turma, id: classRef.id });
  refreshAcademicSelects();
  fillClassSelect("#quiz-turma");
  fillClassSelect("#exam-turma");
  const selector = $("#quiz-turma") || $("#exam-turma");
  if (selector) selector.value = classRef.id;
  const list = $("#class-list");
  if (list) list.innerHTML = classes.map((item) => `<p>${escapeHtml(item.nome)} · ${escapeHtml(item.curso)} · ${escapeHtml(item.disciplina)}${item.codigoAcesso ? ` · Código: <code>${escapeHtml(item.codigoAcesso)}</code>` : ""}</p>`).join("");
  return turma;
}

function makeQuestionCard(type) {
  const card = document.createElement("article");
  card.className = "question-card stack";
  card.dataset.type = type;
  const radioGroup = `correct-${crypto.randomUUID()}`;
  card.innerHTML = `<div class="form-grid"><label>Enunciado${type === "lacuna" ? " (use {{0}}, {{1}}...)" : ""}<textarea data-prompt required rows="3"></textarea></label>
    <label>Tempo da questão<select class="tempo-questao" data-time>${makeSelectOptions([5, 10, 20, 30, 60, 90, 120].map((n) => `${n}s`))}</select></label></div>
    ${type === "multipla" ? `<div class="option-grid">${[0, 1, 2, 3].map((index) => `<label>Alternativa ${String.fromCharCode(65 + index)}<input data-option="${index}" required><span><input type="radio" name="${radioGroup}" data-correct="${index}" ${index === 0 ? "checked" : ""}> Correta</span></label>`).join("")}</div>` : `<div data-gaps class="stack"></div>`}
    <label>Feedback / rubrica para o aluno (opcional)<textarea data-feedback rows="3" placeholder="Explique por que a resposta está correta ou destaque o raciocínio esperado."></textarea></label>
    <div class="form-grid"><label>Upload da Galeria<input data-image-file type="file" accept="image/*"></label><label>Colar Link<input data-image-url type="url" placeholder="https://..."></label></div><img data-preview class="preview" alt="Prévia da imagem" hidden>
    <button type="button" class="secondary" data-remove>Remover questão</button>`;
  card.querySelector("[data-remove]").addEventListener("click", () => card.remove());
  const prompt = card.querySelector("[data-prompt]");
  const fileInput = card.querySelector("[data-image-file]");
  const urlInput = card.querySelector("[data-image-url]");
  const preview = card.querySelector("[data-preview]");
  prompt.addEventListener("input", () => {
    if (type !== "lacuna") return;
    const gapIndices = [...new Set([...prompt.value.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
    card.querySelector("[data-gaps]").innerHTML = gapIndices.map((index) => `<div class="question-card"><strong>Lacuna {{${index}}}</strong><div class="form-grid"><label>Resposta correta<input data-gap-answer="${index}" required></label><label>3 distratores separados por |<input data-gap-options="${index}" required placeholder="opção 1|opção 2|opção 3"></label></div></div>`).join("");
  });
  urlInput.addEventListener("input", () => {
    preview.src = urlInput.value;
    preview.hidden = !urlInput.value;
    fileInput.value = "";
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    urlInput.value = "";
  });
  return card;
}

async function saveQuiz(event) {
  event.preventDefault();
  pageError.textContent = "";
  const form = event.currentTarget;
  if (!currentUser) fail("Sua sessão de professor ainda não foi carregada. Atualize a página e tente novamente.");
  if (!classes.length) {
    await reloadClasses();
    if (!classes.length) fail("Nenhuma turma cadastrada para esta conta. Cadastre uma turma no Dashboard e volte para criar o quiz.");
  }
  const data = new FormData(form);
  const title = String(data.get("titulo") || "").trim();
  const turmaId = String(data.get("turma") || "");
  const selectedClass = classes.find((item) => item.id === turmaId);
  const cards = $$(".question-card[data-type]", $("#questions"));
  if (!title) fail("Informe o título do quiz.");
  if (!String(data.get("disciplina") || "").trim()) fail("Informe a disciplina do quiz.");
  if (!String(data.get("curso") || "").trim()) fail("Informe o curso do quiz.");
  if (!title || !selectedClass) fail("Preencha o título e selecione uma turma.");
  if (!cards.length) fail("Adicione pelo menos uma questão.");
  const defaultTime = Number(data.get("tempoPadrao"));
  if (!Number.isInteger(defaultTime) || defaultTime < 5 || defaultTime > 120) {
    fail("O tempo padrão deve ser um número entre 5 e 120 segundos.");
  }
  const autoAvanco = $("#autoAvanco").checked;
  const intervaloSegundos = Number($("#intervalo").value);
  if (!Number.isInteger(intervaloSegundos) || intervaloSegundos < 1) fail("O intervalo precisa ser de pelo menos 1 segundo.");
  for (const [order, card] of cards.entries()) {
    const prompt = card.querySelector("[data-prompt]").value.trim();
    if (!prompt) fail(`Informe o enunciado da questão ${order + 1}.`);
    if (card.dataset.type === "multipla") {
      if ($$("[data-option]", card).some((input) => !input.value.trim())) fail(`Preencha as quatro alternativas da questão ${order + 1}.`);
    } else {
      const indices = [...new Set([...prompt.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))];
      if (!indices.length) fail(`A questão ${order + 1} precisa ter ao menos uma lacuna, como {{0}}.`);
      for (const index of indices) {
        const answer = $(`[data-gap-answer="${index}"]`, card)?.value.trim();
        const options = $(`[data-gap-options="${index}"]`, card)?.value.split("|").map((item) => item.trim()).filter(Boolean);
        if (!answer || options?.length !== 3) fail(`Informe a resposta correta e exatamente 3 distratores para {{${index}}}.`);
      }
    }
  }
  const quizRef = doc(collection(db, "quizzes"));
  pageError.textContent = "Salvando quiz e questões...";
  await setDoc(quizRef, {
    id: quizRef.id, professorId: currentUser.uid, titulo: title,
    disciplina: String(data.get("disciplina") || "").trim(),
    curso: String(data.get("curso") || "").trim(), turma: selectedClass.nome, turmaId,
    tempoPadrao: defaultTime, autoAvanco, intervaloSegundos,
    monitorarIntegridade: form.elements.monitorarIntegridade.checked,
    bloquearBotaoDireito: form.elements.bloquearBotaoDireito.checked,
    criadoEm: serverTimestamp()
  });
  for (const [order, card] of cards.entries()) {
    const prompt = card.querySelector("[data-prompt]").value.trim();
    const time = Number(card.querySelector("[data-time]").value.replace("s", ""));
    if (!prompt || time < 5 || time > 120) fail(`Revise o enunciado ou tempo da questão ${order + 1}.`);
    let imageUrl = card.querySelector("[data-image-url]").value.trim();
    const imageFile = card.querySelector("[data-image-file]").files?.[0];
    if (imageFile) {
      const imageRef = ref(storage, `questoes-imagens/${currentUser.uid}/${quizRef.id}/${crypto.randomUUID()}-${imageFile.name}`);
      await uploadBytes(imageRef, imageFile);
      imageUrl = await getDownloadURL(imageRef);
    }
    const questionRef = doc(collection(db, "questions"));
    await setDoc(questionRef, {
      id: questionRef.id, quizId: quizRef.id, tipo: card.dataset.type, enunciado: prompt,
      tempo: time, imagemUrl: imageUrl, ordem: order,
      feedback: card.querySelector("[data-feedback]").value.trim()
    });
    if (card.dataset.type === "multipla") {
      const options = $$("[data-option]", card).map((input) => input.value.trim());
      if (options.some((value) => !value)) fail(`Preencha as quatro alternativas da questão ${order + 1}.`);
      const correct = Number($("[data-correct]:checked", card).dataset.correct);
      for (const [index, texto] of options.entries()) {
        const optionRef = doc(collection(db, "options"));
        await setDoc(optionRef, { id: optionRef.id, questionId: questionRef.id, texto, correta: index === correct });
      }
    } else {
      const indices = [...new Set([...prompt.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
      if (!indices.length) fail(`A questão ${order + 1} precisa ter ao menos uma lacuna, como {{0}}.`);
      const lacunas = indices.map((index) => {
        const resposta = $(`[data-gap-answer="${index}"]`, card)?.value.trim();
        const opcoes = $(`[data-gap-options="${index}"]`, card)?.value.split("|").map((item) => item.trim()).filter(Boolean);
        if (!resposta || opcoes?.length !== 3) fail(`Informe a resposta correta e exatamente 3 distratores para {{${index}}}.`);
        return { index, resposta, opcoes: [resposta, ...opcoes] };
      });
      const gapRef = doc(collection(db, "lacunas"));
      await setDoc(gapRef, { id: gapRef.id, questionId: questionRef.id, fraseTemplate: prompt, lacunas });
    }
  }
  form.reset();
  $("#questions").replaceChildren();
  location.href = "./dashboard.html";
}

function renderDashboard() {
  const quizList = $("#quiz-list");
  if (!quizList) return;
  let activeFilter = "all";
  let visibleQuizzes = quizzes;
  const filterValue = $("#filter-value");
  const render = () => {
    quizList.innerHTML = visibleQuizzes.length ? visibleQuizzes.map((quiz) => `<article class="question-card form-grid"><div><strong>${escapeHtml(quiz.titulo)}</strong><p>${escapeHtml(quiz.disciplina)} · ${escapeHtml(quiz.curso)} · ${escapeHtml(quiz.turma)}</p></div><button class="primary" data-start="${escapeHtml(quiz.id)}">Abrir sessão</button></article>`).join("") : "<p>Nenhum quiz encontrado.</p>";
  };
  const applyFilter = async () => {
    const value = filterValue.value;
    const field = activeFilter === "turma" ? "turmaId" : activeFilter;
    const constraints = [where("professorId", "==", currentUser.uid)];
    if (activeFilter !== "all" && value) constraints.push(where(field, "==", value));
    const snapshot = await getDocs(query(collection(db, "quizzes"), ...constraints));
    visibleQuizzes = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    render();
  };
  $("#quiz-filters").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    activeFilter = button.dataset.filter;
    $$("#quiz-filters [data-filter]").forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    const values = activeFilter === "disciplina"
      ? academicOptions("disciplina")
      : activeFilter === "turma"
        ? classes.map((item) => item.id)
        : activeFilter === "curso" ? academicOptions("curso") : [];
    $("#filter-value-label").hidden = activeFilter === "all";
    filterValue.innerHTML = `<option value="">Todas</option>${values.map((value) => {
      const label = activeFilter === "turma" ? classes.find((item) => item.id === value)?.nome || value : value;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join("")}`;
    try { await applyFilter(); } catch (error) { report(error); }
  });
  filterValue.addEventListener("change", () => applyFilter().catch(report));
  render();
  quizList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-start]");
    if (!button) return;
    if (button.disabled) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Criando sessão...";
    if (pageError) pageError.textContent = "";
    const creationFeedback = $("#session-creation-feedback");
    if (creationFeedback) creationFeedback.textContent = "Criando sala e reservando um PIN...";
    try {
      const quiz = quizzes.find((item) => item.id === button.dataset.start);
      if (!quiz) fail("Não encontramos esse quiz. Atualize a página e tente novamente.");
      const sessionRef = await createQuizSession(quiz);
      watchSession(sessionRef.id);
      const feedback = $("#session-feedback");
      if (feedback) feedback.textContent = "Sessão criada. Compartilhe o link ou o PIN com seus alunos.";
      if (creationFeedback) creationFeedback.textContent = "Sessão aberta. O PIN e o link de entrada estão disponíveis na seção Sessões.";
      $("#session-controls")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      const message = `Não foi possível abrir a sessão: ${error?.message || "erro inesperado."}`;
      report(new Error(message));
      if (creationFeedback) creationFeedback.textContent = message;
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });
}

function newSessionPin() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

async function createQuizSession(quiz) {
  const questionSnapshot = await getDocs(query(collection(db, "questions"), where("quizId", "==", quiz.id)));
  if (!questionSnapshot.size) fail("Este quiz ainda não tem questões. Adicione e salve pelo menos uma questão antes de abrir a sessão.");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pin = newSessionPin();
    const sessionRef = doc(db, "sessoesJogo", pin);
    const created = await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(sessionRef);
      if (existing.exists()) return false;
      transaction.set(sessionRef, {
        id: sessionRef.id, quizId: quiz.id, professorId: currentUser.uid, pin, status: "lobby",
        titulo: quiz.titulo || "Quiz",
        turmaId: quiz.turmaId || "", turma: quiz.turma || "", curso: quiz.curso || "",
        questaoAtual: 0, autoAvanco: Boolean(quiz.autoAvanco),
        monitorarIntegridade: quiz.monitorarIntegridade !== false,
        bloquearBotaoDireito: quiz.bloquearBotaoDireito === true,
        intervaloSegundos: Number(quiz.intervaloSegundos || 5),
        criadoEm: serverTimestamp(), atualizadaEm: serverTimestamp()
      });
      return true;
    });
    if (created) return sessionRef;
  }
  fail("Não foi possível reservar um PIN exclusivo após várias tentativas. Tente novamente.");
}

function watchSession(sessionId) {
  activeSessionUnsubscribe?.();
  activeSessionId = sessionId;
  $("#session-controls").hidden = false;
  activeSessionUnsubscribe = onSnapshot(doc(db, "sessoesJogo", sessionId), (snapshot) => {
    if (activeSessionId !== sessionId) return;
    if (!snapshot.exists()) {
      activeSessionUnsubscribe?.();
      activeSessionUnsubscribe = undefined;
      activeSessionId = undefined;
      $("#session-controls").hidden = true;
      return;
    }
    const session = snapshot.data();
    const statusLabels = { lobby: "Em preparação", jogando: "Em andamento", fim: "Finalizada" };
    $("#session-title").textContent = session.titulo || "Quiz";
    $("#session-pin").textContent = `PIN: ${session.pin}`;
    $("#session-status").textContent = `${statusLabels[session.status] || session.status} · Questão: ${(session.questaoAtual || 0) + 1}`;
    $("#start-session").hidden = session.status !== "lobby";
    $("#next-question").hidden = session.status !== "jogando";
    $("#next-question").disabled = session.autoAvanco || session.status === "fim";
    const joinUrl = new URL("../aluno/join.html", location.href);
    joinUrl.searchParams.set("pin", session.pin);
    $("#session-link").value = joinUrl.href;
    $("#open-student-join").href = joinUrl.href;
  }, report);
}

async function advanceSession() {
  if (!activeSessionId) return;
  const sessionRef = doc(db, "sessoesJogo", activeSessionId);
  const sessionSnapshot = await getDoc(sessionRef);
  if (!sessionSnapshot.exists()) fail("Esta sessão não existe mais. Atualize a lista.");
  const session = sessionSnapshot.data();
  if (session.status !== "jogando") fail("Inicie o quiz antes de avançar questões.");
  if (session.autoAvanco) fail("O avanço automático está ativado para esta sessão.");
  const questions = await getDocs(query(collection(db, "questions"), where("quizId", "==", session.quizId)));
  const next = Number(session.questaoAtual || 0) + 1;
  if (next > questions.size) fail("Todas as questões desta sessão já foram apresentadas.");
  await updateDoc(sessionRef, {
    questaoAtual: next, status: next >= questions.size ? "fim" : "jogando",
    inicioQuestaoEm: serverTimestamp(), atualizadaEm: serverTimestamp()
  });
}

async function deleteQuizSession(sessionId, title = "sessão selecionada") {
  if (!confirm(`Apagar a sessão "${title}"? Os alunos não poderão mais entrar ou continuar. As respostas e o histórico já registrados serão preservados.`)) return;
  const wasActiveSession = activeSessionId === sessionId;
  await deleteDoc(doc(db, "sessoesJogo", sessionId));
  if (wasActiveSession) {
    activeSessionUnsubscribe?.();
    activeSessionUnsubscribe = undefined;
    activeSessionId = undefined;
    $("#session-controls").hidden = true;
  }
  const feedback = $("#feedback");
  if (feedback) feedback.textContent = "Sessão apagada. O histórico de respostas foi preservado.";
  const sessionFeedback = $("#sessions-feedback");
  if (sessionFeedback) sessionFeedback.textContent = "Sessão apagada. O histórico de respostas foi preservado.";
}

function findDuplicateGroups(items, keyFor) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFor(item);
    if (!key) return;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

function normalizedKey(...values) {
  return values.map((value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR")).join("|");
}

function renderDuplicateReport() {
  const holder = $("#duplicates-report");
  const classGroups = findDuplicateGroups(classes, (item) =>
    normalizedKey(item.nome, item.curso, item.disciplina));
  const quizGroups = findDuplicateGroups(quizzes, (item) =>
    normalizedKey(item.titulo, item.disciplina, item.curso, item.turmaId || item.turma));
  if (!classGroups.length && !quizGroups.length) {
    holder.innerHTML = "<p>Nenhuma coincidência de nome e contexto encontrada nas turmas e quizzes desta conta.</p>";
    return;
  }
  const renderGroup = (label, group) => `<article class="question-card"><strong>${label}</strong>${group.map((item) =>
    `<p>${escapeHtml(item.nome || item.titulo || "Registro")} · ${escapeHtml(item.curso || "")} · ${escapeHtml(item.disciplina || "")} <small>ID: ${escapeHtml(item.id)}</small></p>`
  ).join("")}<p class="data-review-note">Coincidência nos campos usados para a análise; confira o conteúdo antes de decidir se algum registro deve ser removido.</p></article>`;
  holder.innerHTML = [
    ...classGroups.map((group) => renderGroup("Possível duplicidade de turma", group)),
    ...quizGroups.map((group) => renderGroup("Possível duplicidade de quiz", group))
  ].join("");
}

function setupDashboard() {
  renderDashboard();
  watchIntegrityEvents();
  activeSessionsUnsubscribe?.();
  activeSessionsUnsubscribe = onSnapshot(
    query(collection(db, "sessoesJogo"), where("professorId", "==", currentUser.uid)),
    (snapshot) => {
      const sessions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
      const statusLabels = { lobby: "Em preparação", jogando: "Em andamento", fim: "Finalizada" };
      $("#session-list").innerHTML = sessions.length ? sessions.map((item) =>
        `<article class="question-card session-list-item"><div><strong>${escapeHtml(item.titulo || "Quiz")}</strong><p>PIN ${escapeHtml(item.pin)} · ${escapeHtml(statusLabels[item.status] || item.status)}${item.turma ? ` · ${escapeHtml(item.turma)}` : ""}</p></div><div class="session-actions"><button class="secondary" type="button" data-session="${escapeHtml(item.id)}">Abrir painel</button><button class="danger" type="button" data-delete-session="${escapeHtml(item.id)}" data-session-title="${escapeHtml(item.titulo || "Quiz")}">Apagar</button></div></article>`
      ).join("") : "<p>Nenhuma sessão encontrada. Abra uma a partir de um quiz.</p>";
    }, report
  );
  $("#start-session")?.addEventListener("click", async () => {
    if (!activeSessionId) return;
    const button = $("#start-session");
    const feedback = $("#session-feedback");
    button.disabled = true;
    if (feedback) feedback.textContent = "Iniciando quiz...";
    try {
      const sessionRef = doc(db, "sessoesJogo", activeSessionId);
      const snapshot = await getDoc(sessionRef);
      if (!snapshot.exists()) fail("Esta sessão não existe mais. Atualize a lista.");
      if (snapshot.data().status !== "lobby") fail("Esta sessão já foi iniciada.");
      await updateDoc(sessionRef, { status: "jogando", questaoAtual: 0, inicioEm: serverTimestamp(), inicioQuestaoEm: serverTimestamp(), atualizadaEm: serverTimestamp() });
      if (feedback) feedback.textContent = "Quiz iniciado. Acompanhe a turma nesta tela.";
    } catch (error) {
      report(error);
      if (feedback) feedback.textContent = error?.message || "Não foi possível iniciar o quiz.";
    } finally { button.disabled = false; }
  });
  $("#next-question")?.addEventListener("click", async () => {
    const button = $("#next-question");
    button.disabled = true;
    const feedback = $("#session-feedback");
    if (feedback) feedback.textContent = "Avançando questão...";
    try {
      await advanceSession();
      if (feedback) feedback.textContent = "Questão avançada.";
    } catch (error) {
      report(error);
      if (feedback) feedback.textContent = error?.message || "Não foi possível avançar a questão.";
    } finally { button.disabled = false; }
  });
  $("#delete-session")?.addEventListener("click", () => {
    if (activeSessionId) deleteQuizSession(activeSessionId, $("#session-title").textContent).catch(report);
  });
  $("#copy-session-link")?.addEventListener("click", async () => {
    const feedback = $("#session-feedback");
    try {
      await navigator.clipboard.writeText(`${$("#session-link").value}\nPIN: ${$("#session-pin").textContent.replace("PIN: ", "")}`);
      if (feedback) feedback.textContent = "Link e PIN copiados.";
    } catch (error) {
      if (feedback) feedback.textContent = "Não foi possível copiar automaticamente. Selecione e copie o link exibido.";
      console.error("Falha ao copiar o link da sessão.", error);
    }
  });
  $("#class-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button[type='submit']", form);
    const feedback = $("#class-feedback");
    if (feedback) feedback.textContent = "Cadastrando turma...";
    button.disabled = true;
    try {
      const turma = await persistClass(new FormData(form));
      form.reset();
      await reloadClasses();
      if (feedback) feedback.textContent = `Turma "${turma.nome}" cadastrada e disponível nos seletores.`;
    } catch (error) {
      if (feedback) feedback.textContent = error?.message || "Não foi possível cadastrar a turma.";
      report(error);
    }
    finally { button.disabled = false; }
  });
  renderClassList();
  $("#session-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session]");
    if (button) watchSession(button.dataset.session);
  });
  $("#session-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-session]");
    if (button) deleteQuizSession(button.dataset.deleteSession, button.dataset.sessionTitle).catch(report);
  });
  $("#scan-duplicates")?.addEventListener("click", () => {
    const button = $("#scan-duplicates");
    button.disabled = true;
    button.textContent = "Analisando...";
    try {
      renderDuplicateReport();
    } catch (error) {
      report(error);
      $("#duplicates-report").textContent = "Não foi possível gerar o relatório.";
    } finally {
      button.disabled = false;
      button.textContent = "Gerar relatório novamente";
    }
  });
}

function setupQuestionBuilder() {
  const questions = $("#questions");
  $("#add-multiple")?.addEventListener("click", () => questions.append(makeQuestionCard("multipla")));
  $("#add-gap")?.addEventListener("click", () => questions.append(makeQuestionCard("lacuna")));
  const form = $("#quiz-form");
  if (!form) return;
  $("#quiz-turma")?.addEventListener("change", (event) => {
    const classItem = classes.find((item) => item.id === event.currentTarget.value);
    if (!classItem) return;
    form.elements.curso.value = classItem.curso || "";
    if (classItem.disciplina) form.elements.disciplina.value = classItem.disciplina;
  });
  form.noValidate = true;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = $("button[type='submit']", form);
    if (submitButton.disabled) return;
    pageError.textContent = "";
    if (!form.reportValidity()) {
      pageError.textContent = "Revise os campos destacados e preencha as informações obrigatórias.";
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = "Salvando quiz...";
    try {
      await saveQuiz(event);
    } catch (error) {
      pageError.textContent = `Não foi possível salvar o quiz: ${error?.message || "erro inesperado."}`;
      console.error("Falha ao salvar quiz.", error);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Salvar quiz";
    }
  });
}

function setupExamForm() {
  if (!$("#exam-form")) return;
  $("#professor-name").value = teacherName;
  const today = new Date();
  $("#exam-form [name='data']").value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  fillClassSelect("#exam-turma");
  const holder = $("#exam-questions");
  let questionNumber = 0;
  const types = [
    ["multipla", "Múltipla escolha"],
    ["caixas", "Caixas de seleção"],
    ["curta", "Resposta curta"],
    ["paragrafo", "Parágrafo"]
  ];
  const addQuestion = () => {
    if ($$(".form-question-card", holder).length >= 100) {
      pageError.textContent = "Um formulário pode ter no máximo 100 perguntas.";
      return;
    }
    questionNumber += 1;
    const id = crypto.randomUUID();
    const card = document.createElement("article");
    card.className = "question-card form-question-card";
    card.dataset.questionId = id;
    card.innerHTML = `<div class="form-question-heading"><strong>Pergunta ${questionNumber}</strong><button type="button" class="danger" data-remove-question>Remover</button></div>
      <label>Pergunta<textarea data-question-prompt rows="2" required maxlength="2000" placeholder="Digite o enunciado da pergunta"></textarea></label>
      <label>Imagem da pergunta (opcional)<input data-question-image type="file" accept="image/*"><span class="form-help">Ou informe um link de imagem</span><input data-question-image-url type="url" placeholder="https://..."></label><img data-question-image-preview class="preview" alt="Prévia da imagem da pergunta" hidden>
      <div class="form-question-settings"><label>Tipo de resposta<select data-question-type>${types.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label>Pontos<input data-question-points type="number" min="0" max="100" step="0.5" value="1"></label><label class="inline-field"><span>Resposta obrigatória</span><input data-question-required type="checkbox" checked></label></div>
      <div data-question-options class="form-choice-editor"></div>
      <label data-text-answer-label hidden>Gabarito opcional para correção automática<input data-text-answer maxlength="500" placeholder="Deixe vazio para revisar manualmente"></label>`;
    holder.append(card);
    renderChoices(card);
  };
  function renderChoices(card) {
    const type = $("[data-question-type]", card).value;
    const choices = $("[data-question-options]", card);
    const textAnswer = $("[data-text-answer-label]", card);
    if (type === "curta" || type === "paragrafo") {
      choices.replaceChildren();
      textAnswer.hidden = false;
      return;
    }
    textAnswer.hidden = true;
    const multiple = type === "caixas";
    if (!choices.querySelector("[data-option-row]")) {
      choices.innerHTML = `<div class="form-choice-heading"><strong>Alternativas</strong><span>Marque a(s) resposta(s) correta(s)</span></div>
        <div data-choice-list></div><button type="button" class="secondary" data-add-option>+ Adicionar alternativa</button>`;
      addOption(card);
      addOption(card);
      return;
    }
    $$(".form-choice-row", choices).forEach((row) => {
      const current = $("input[type='radio'], input[type='checkbox']", row);
      const checked = current.checked;
      const replacement = document.createElement("input");
      replacement.type = multiple ? "checkbox" : "radio";
      replacement.name = `correct-${card.dataset.questionId}`;
      replacement.checked = checked;
      replacement.setAttribute("aria-label", "Marcar resposta correta");
      current.replaceWith(replacement);
    });
  }
  function addOption(card) {
    const list = $("[data-choice-list]", card);
    if (!list) return;
    const type = $("[data-question-type]", card).value;
    const row = document.createElement("div");
    row.className = "form-choice-row";
    row.dataset.optionRow = "";
    row.innerHTML = `<input type="${type === "caixas" ? "checkbox" : "radio"}" name="correct-${card.dataset.questionId}" aria-label="Marcar resposta correta">
      <input data-option-text required maxlength="500" aria-label="Texto da alternativa" placeholder="Alternativa">
      <button type="button" class="icon-button" data-remove-option aria-label="Remover alternativa">×</button>`;
    list.append(row);
  }

  function normalizeImportedExam(source) {
    const text = String(source || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let imported;
    try { imported = JSON.parse(text); } catch { fail("O conteúdo não é um JSON válido. Copie a resposta JSON completa da IA."); }
    if (!imported || typeof imported !== "object" || Array.isArray(imported)) fail("O JSON deve ser um objeto com uma lista de questões.");
    const sourceQuestions = imported.questoes || imported.questions;
    if (!Array.isArray(sourceQuestions) || !sourceQuestions.length) fail("Inclua pelo menos uma questão no campo \"questoes\".");
    if (sourceQuestions.length > 100) fail("O formulário aceita no máximo 100 questões.");
    const typeAliases = {
      multipla: "multipla", multipla_escolha: "multipla", multiple_choice: "multipla", multiple: "multipla",
      caixas: "caixas", checkbox: "caixas", checkboxes: "caixas", selecao_multipla: "caixas",
      curta: "curta", short_answer: "curta", short: "curta", open: "curta",
      paragrafo: "paragrafo", paragraph: "paragrafo", long_answer: "paragrafo"
    };
    const questions = sourceQuestions.map((question, index) => {
      if (!question || typeof question !== "object" || Array.isArray(question)) fail(`A questão ${index + 1} tem formato inválido.`);
      const enunciado = String(question.enunciado || question.pergunta || question.question || "").trim();
      if (!enunciado || enunciado.length > 2000) fail(`A questão ${index + 1} precisa ter um enunciado de até 2.000 caracteres.`);
      const rawOptions = question.opcoes || question.alternativas || question.options || [];
      if (!Array.isArray(rawOptions)) fail(`As alternativas da questão ${index + 1} devem ser uma lista.`);
      const answerKey = String(question.gabarito || question.respostaCorreta || question.correctAnswer || "").trim();
      const options = rawOptions.map((option) => typeof option === "string"
        ? { texto: option.trim(), correta: false }
        : {
          texto: String(option?.texto || option?.text || "").trim(),
          correta: option?.correta === true || option?.isCorrect === true
        });
      if (options.some((option) => !option.texto || option.texto.length > 500)) fail(`Revise o texto das alternativas da questão ${index + 1}.`);
      if (answerKey && options.length) {
        const answerIndex = options.findIndex((option) => option.texto.toLocaleLowerCase("pt-BR") === answerKey.toLocaleLowerCase("pt-BR"));
        if (answerIndex >= 0 && !options.some((option) => option.correta)) options[answerIndex].correta = true;
      }
      const declaredType = String(question.tipo || question.type || "").trim().toLocaleLowerCase("pt-BR").replaceAll(" ", "_");
      if (declaredType && !typeAliases[declaredType]) fail(`O tipo da questão ${index + 1} não é aceito.`);
      const tipo = typeAliases[declaredType] || (options.length ? "multipla" : "curta");
      if (tipo === "multipla" || tipo === "caixas") {
        if (options.length < 2 || options.length > 20) fail(`A questão ${index + 1} precisa ter de 2 a 20 alternativas.`);
        const correctCount = options.filter((option) => option.correta).length;
        if ((tipo === "multipla" && correctCount !== 1) || (tipo === "caixas" && correctCount < 1)) {
          fail(`Marque a resposta correta da questão ${index + 1} usando "correta": true (ou informe o gabarito).`);
        }
      } else if (options.length) fail(`A questão ${index + 1} não deve conter alternativas se o tipo for resposta aberta.`);
      const pontos = Number(question.pontos ?? question.points ?? 1);
      if (!Number.isFinite(pontos) || pontos < 0 || pontos > 100 || !Number.isInteger(pontos * 2)) {
        fail(`A pontuação da questão ${index + 1} deve estar entre 0 e 100, em incrementos de 0,5.`);
      }
      const imagemUrl = String(question.imagemUrl || question.imageUrl || "").trim();
      if (imagemUrl && !/^https?:\/\//i.test(imagemUrl)) fail(`O link de imagem da questão ${index + 1} deve começar com http:// ou https://.`);
      return {
        enunciado, tipo, pontos,
        obrigatoria: question.obrigatoria !== false && question.required !== false,
        opcoes: options,
        gabarito: answerKey,
        imagemUrl
      };
    });
    return {
      titulo: String(imported.titulo || imported.title || "").trim(),
      instrucoes: String(imported.instrucoes || imported.instructions || "").trim(),
      disciplina: String(imported.disciplina || imported.subject || "").trim(),
      curso: String(imported.curso || imported.course || "").trim(),
      questions
    };
  }

  function importQuestions(source) {
    const imported = normalizeImportedExam(source);
    if ($$(".form-question-card", holder).length && !confirm("Importar esta prova e substituir todas as perguntas que já estão no formulário?")) return;
    holder.replaceChildren();
    questionNumber = 0;
    imported.questions.forEach((question) => {
      addQuestion();
      const card = holder.lastElementChild;
      $("[data-question-prompt]", card).value = question.enunciado;
      $("[data-question-points]", card).value = String(question.pontos);
      $("[data-question-required]", card).checked = question.obrigatoria;
      $("[data-question-type]", card).value = question.tipo;
      $("[data-question-options]", card).replaceChildren();
      renderChoices(card);
      if (question.opcoes.length) {
        while ($$(".form-choice-row", card).length < question.opcoes.length) addOption(card);
        const rows = $$(".form-choice-row", card);
        $$(".form-choice-row", card).forEach((row, index) => {
          const option = question.opcoes[index];
          if (!option) {
            row.remove();
            return;
          }
          $("[data-option-text]", row).value = option.texto;
          $("input[type='radio'], input[type='checkbox']", row).checked = option.correta;
        });
      }
      if (question.tipo === "curta" || question.tipo === "paragrafo") $("[data-text-answer]", card).value = question.gabarito;
      if (question.imagemUrl) {
        $("[data-question-image-url]", card).value = question.imagemUrl;
        const preview = $("[data-question-image-preview]", card);
        preview.src = question.imagemUrl;
        preview.hidden = false;
      }
    });
    $$(".form-question-card", holder).forEach((card, index) => {
      $("strong", card.querySelector(".form-question-heading")).textContent = `Pergunta ${index + 1}`;
    });
    const form = $("#exam-form");
    if (imported.titulo) form.elements.titulo.value = imported.titulo.slice(0, 120);
    if (imported.instrucoes) form.elements.instrucoes.value = imported.instrucoes.slice(0, 1500);
    if (imported.disciplina && [...form.elements.disciplina.options].some((option) => option.value === imported.disciplina)) {
      form.elements.disciplina.value = imported.disciplina;
    }
    if (imported.curso && [...form.elements.curso.options].some((option) => option.value === imported.curso)) {
      form.elements.curso.value = imported.curso;
    }
    $("#exam-import-feedback").textContent = `${imported.questions.length} pergunta(s) importada(s). Confira o conteúdo e o gabarito antes de publicar.`;
  }

  holder.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const card = button.closest(".form-question-card");
    if (button.id === "add-exam-question") addQuestion();
    if (button.matches("[data-remove-question]")) {
      card.remove();
      $$(".form-question-card", holder).forEach((item, index) => {
        $("strong", item.querySelector(".form-question-heading")).textContent = `Pergunta ${index + 1}`;
      });
    }
    if (button.matches("[data-add-option]")) addOption(card);
    if (button.matches("[data-remove-option]")) {
      const rows = $$(".form-choice-row", card);
      if (rows.length <= 2) {
        pageError.textContent = "Cada pergunta de seleção precisa ter pelo menos duas alternativas.";
        return;
      }
      button.closest(".form-choice-row").remove();
    }
  });
  holder.addEventListener("change", (event) => {
    if (event.target.matches("[data-question-type]")) renderChoices(event.target.closest(".form-question-card"));
    if (event.target.matches("[data-question-image]")) {
      const input = event.target;
      const file = input.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/") || file.size >= 5 * 1024 * 1024) {
        pageError.textContent = "Escolha uma imagem menor que 5 MB.";
        input.value = "";
        return;
      }
      const card = input.closest(".form-question-card");
      input.disabled = true;
      pageError.textContent = "Enviando imagem...";
      const imageRef = ref(storage, `questoes-imagens/${currentUser.uid}/formularios/${crypto.randomUUID()}`);
      uploadBytes(imageRef, file).then(() => getDownloadURL(imageRef)).then((url) => {
        $("[data-question-image-url]", card).value = url;
        const preview = $("[data-question-image-preview]", card);
        preview.src = url;
        preview.hidden = false;
        pageError.textContent = "Imagem adicionada à pergunta.";
      }).catch((error) => {
        pageError.textContent = `Não foi possível enviar a imagem: ${error.message}`;
        console.error(error);
      }).finally(() => { input.disabled = false; });
    }
  });
  holder.addEventListener("input", (event) => {
    if (!event.target.matches("[data-question-image-url]")) return;
    const preview = $("[data-question-image-preview]", event.target.closest(".form-question-card"));
    const url = event.target.value.trim();
    preview.hidden = !url;
    if (url) preview.src = url;
    else preview.removeAttribute("src");
  });
  $("#add-exam-question").addEventListener("click", addQuestion);
  addQuestion();
  $("#exam-import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const feedback = $("#exam-import-feedback");
    if (file.size > 1024 * 1024) {
      feedback.textContent = "O arquivo JSON deve ter no máximo 1 MB.";
      event.target.value = "";
      return;
    }
    try {
      $("#exam-import-json").value = await file.text();
      feedback.textContent = "Arquivo carregado. Clique em “Importar perguntas” para revisar e inserir.";
    } catch (error) {
      feedback.textContent = `Não foi possível ler o arquivo: ${error.message}`;
      console.error(error);
    }
  });
  $("#import-ai-exam").addEventListener("click", () => {
    try {
      importQuestions($("#exam-import-json").value);
    } catch (error) {
      $("#exam-import-feedback").textContent = error?.message || "Não foi possível importar as questões.";
      console.error(error);
    }
  });
  $("#copy-ai-import-prompt").addEventListener("click", async (event) => {
    const prompt = `Crie uma prova para importar no Quizziolando. Responda somente com JSON válido, sem Markdown nem comentários, neste formato:
{
  "titulo": "Título da prova",
  "disciplina": "Disciplina",
  "curso": "Curso",
  "instrucoes": "Orientações para os alunos",
  "questoes": [
    {
      "enunciado": "Texto da pergunta",
      "tipo": "multipla",
      "opcoes": [
        { "texto": "Alternativa A", "correta": true },
        { "texto": "Alternativa B", "correta": false },
        { "texto": "Alternativa C", "correta": false },
        { "texto": "Alternativa D", "correta": false }
      ],
      "gabarito": "",
      "pontos": 1,
      "obrigatoria": true
    }
  ]
}
Use "multipla" para uma única alternativa correta, "caixas" para várias corretas, "curta" para resposta curta ou "paragrafo" para resposta aberta. Inclua de 2 a 20 alternativas nas questões de seleção e marque cada alternativa com "correta": true ou false. Não invente informações ausentes do pedido.`;
    try {
      await navigator.clipboard.writeText(prompt);
      event.currentTarget.textContent = "Instrução copiada";
    } catch (error) {
      $("#exam-import-feedback").textContent = `Não foi possível copiar a instrução: ${error.message}`;
      console.error(error);
    }
  });

  function collectQuestions() {
    const cards = $$(".form-question-card", holder);
    if (!cards.length) fail("Adicione pelo menos uma pergunta.");
    return cards.map((card, index) => {
      const enunciado = $("[data-question-prompt]", card).value.trim();
      const tipo = $("[data-question-type]", card).value;
      const pontos = Number($("[data-question-points]", card).value);
      if (!enunciado) fail(`Escreva o enunciado da pergunta ${index + 1}.`);
      if (!Number.isFinite(pontos) || pontos < 0 || pontos > 100) fail(`Informe uma pontuação válida para a pergunta ${index + 1}.`);
      const question = {
        id: card.dataset.questionId, enunciado, tipo, pontos,
        obrigatoria: $("[data-question-required]", card).checked,
        imagemUrl: $("[data-question-image-url]", card).value.trim()
      };
      if (question.imagemUrl && !/^https?:\/\//i.test(question.imagemUrl)) fail(`Informe um link de imagem válido na pergunta ${index + 1}.`);
      if (tipo === "multipla" || tipo === "caixas") {
        question.opcoes = $$(".form-choice-row", card).map((row) => ({
          texto: $("[data-option-text]", row).value.trim(),
          correta: $("input[type='radio'], input[type='checkbox']", row).checked
        }));
        if (question.opcoes.length < 2 || question.opcoes.some((option) => !option.texto)) fail(`Preencha ao menos duas alternativas na pergunta ${index + 1}.`);
        const correctCount = question.opcoes.filter((option) => option.correta).length;
        if ((tipo === "multipla" && correctCount !== 1) || (tipo === "caixas" && correctCount < 1)) fail(`Marque a(s) resposta(s) correta(s) na pergunta ${index + 1}.`);
      } else {
        question.gabarito = $("[data-text-answer]", card).value.trim();
      }
      return question;
    });
  }

  $("#exam-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = $("button[type='submit']", event.currentTarget);
    pageError.textContent = "";
    submitButton.disabled = true;
    submitButton.textContent = "Publicando formulário...";
    try {
      const form = new FormData(event.currentTarget);
      const examForm = event.currentTarget;
      const questions = collectQuestions();
      const classItem = classes.find((item) => item.id === form.get("turmaId"));
      if (!classItem) fail("Cadastre ou selecione uma turma.");
      const professorNome = String(form.get("professorNome") || "").trim();
      if (!professorNome) fail("Informe o nome do professor.");
      const monitorarIntegridade = examForm.elements.monitorarIntegridade.checked;
      const bloquearBotaoDireito = examForm.elements.bloquearBotaoDireito.checked;
      await setDoc(doc(db, "users", currentUser.uid), { nome: professorNome }, { merge: true });
      teacherName = professorNome;
      const examRef = doc(collection(db, "provas"));
      const publicQuestions = questions.map((question) => ({
        id: question.id, enunciado: question.enunciado, tipo: question.tipo,
        pontos: question.pontos, obrigatoria: question.obrigatoria,
        imagemUrl: question.imagemUrl,
        ...(question.opcoes ? { opcoes: question.opcoes.map((option) => ({ texto: option.texto })) } : {})
      }));
      const batch = writeBatch(db);
      batch.set(examRef, {
        id: examRef.id, professorId: currentUser.uid, turmaId: classItem.id,
        turma: classItem.nome, disciplina: String(form.get("disciplina")), curso: String(form.get("curso")),
        titulo: String(form.get("titulo")).trim(), data: String(form.get("data")),
        questoesIds: questions.map((question) => question.id), questoes: publicQuestions,
        modeloFormulario: true, instrucoes: String(form.get("instrucoes") || "").trim(),
        professorNome,
        escola: String(form.get("escola")), status: "disponivel",
        monitorarIntegridade, bloquearBotaoDireito,
        criadoEm: serverTimestamp()
      });
      questions.forEach((question) => batch.set(doc(db, "provas", examRef.id, "gabaritos", question.id), {
        questionId: question.id, pontos: question.pontos,
        opcoesCorretas: question.opcoes?.flatMap((option, index) => option.correta ? [index] : []) || [],
        gabarito: question.gabarito || ""
      }));
      await batch.commit();
      const shareUrl = new URL(`../aluno/minhas-provas.html?prova=${encodeURIComponent(examRef.id)}`, location.href).href;
      $("#published-form-link").value = shareUrl;
      $("#open-form-responses").href = `./respostas-formulario.html?prova=${encodeURIComponent(examRef.id)}`;
      $("#published-exam").textContent = `“${String(form.get("titulo")).trim()}” está disponível para os alunos.`;
      $("#form-share").hidden = false;
      const qr = $("#form-qr-code");
      qr.replaceChildren();
      if (window.QRCode) new window.QRCode(qr, { text: shareUrl, width: 176, height: 176, correctLevel: window.QRCode.CorrectLevel.M });
      else qr.textContent = "Não foi possível gerar o QR code. Compartilhe o link.";
      $("#form-share").scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      pageError.textContent = `Não foi possível publicar: ${error?.message || "erro inesperado."}`;
      console.error("Falha ao publicar formulário.", error);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Publicar formulário";
    }
  });
  $("#copy-form-link").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#published-form-link").value);
      $("#copy-form-link").textContent = "Link copiado";
    } catch (error) {
      pageError.textContent = `Não foi possível copiar o link: ${error.message}`;
      console.error(error);
    }
  });
  $("#download-pdf").addEventListener("click", async () => {
    try {
      const questions = collectQuestions();
      const form = new FormData($("#exam-form"));
      const turma = classes.find((item) => item.id === form.get("turmaId"));
      window.dispatchEvent(new CustomEvent("quizziolando:pdf", { detail: {
        escola: form.get("escola"), professor: $("#professor-name").value.trim(),
        aluno: "", disciplina: form.get("disciplina"),
        curso: form.get("curso"), turma: turma?.nome || "", data: form.get("data"), titulo: form.get("titulo"),
        nota: "", questoes: questions.map((question) => ({ ...question, options: question.opcoes?.map((option) => option.texto) }))
      } }));
    } catch (error) { report(error); }
  });
}

function setupFormResponses() {
  const holder = $("#form-responses");
  if (!holder) return;
  const examId = new URLSearchParams(location.search).get("prova");
  if (!examId) fail("O link do formulário não contém o código da prova.");
  getDoc(doc(db, "provas", examId)).then(async (snapshot) => {
    if (!snapshot.exists() || snapshot.data().professorId !== currentUser.uid || !snapshot.data().modeloFormulario) fail("Formulário não encontrado ou sem acesso.");
    const exam = { id: snapshot.id, ...snapshot.data() };
    const keySnapshot = await getDocs(collection(db, "provas", examId, "gabaritos"));
    const keys = new Map(keySnapshot.docs.map((item) => [item.id, item.data()]));
    $("#response-form-summary").innerHTML = `<h2>${escapeHtml(exam.titulo)}</h2><p>${escapeHtml(exam.disciplina)} · ${escapeHtml(exam.turma)} · ${escapeHtml(exam.data)}</p><p>${escapeHtml(exam.instrucoes || "Sem instruções adicionais.")}</p>`;
    const gradeResponse = (response) => {
      let earned = 0;
      let possible = 0;
      let correct = 0;
      let manual = false;
      for (const question of exam.questoes || []) {
        const key = keys.get(question.id);
        if (!key) continue;
        const submitted = response.respostas?.[question.id];
        const points = Number(key.pontos || 0);
        let isCorrect = false;
        possible += points;
        if (question.tipo === "multipla" || question.tipo === "caixas") {
          const expected = (key.opcoesCorretas || []).map(String).sort();
          const selected = (Array.isArray(submitted) ? submitted : submitted === undefined ? [] : [submitted]).map(String).sort();
          isCorrect = expected.length === selected.length && expected.every((value, index) => value === selected[index]);
        } else if (key.gabarito) {
          isCorrect = String(submitted || "").trim().toLocaleLowerCase("pt-BR") === key.gabarito.trim().toLocaleLowerCase("pt-BR");
        } else {
          const manualScore = response.pontuacoesManuais?.[question.id];
          if (manualScore === undefined) manual = true;
          else {
            const score = Math.max(0, Math.min(points, Number(manualScore)));
            earned += score;
            isCorrect = score === points;
          }
        }
        if (isCorrect) { correct += 1; earned += question.tipo === "multipla" || question.tipo === "caixas" || key.gabarito ? points : 0; }
      }
      return { correct, note: possible ? Math.round((earned / possible) * 100) / 10 : null, manual };
    };
    onSnapshot(collection(db, "provas", examId, "respostasFormulario"), (responseSnapshot) => {
      const responses = responseSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => String(a.alunoNome || "").localeCompare(String(b.alunoNome || ""), "pt-BR"));
      const submitted = responses.filter((response) => response.status === "enviada").length;
      $("#response-open-count").textContent = String(responses.length);
      $("#response-submitted-count").textContent = String(submitted);
      $("#response-progress-count").textContent = String(responses.length - submitted);
      holder.innerHTML = responses.length ? responses.map((response) => {
        const isSubmitted = response.status === "enviada";
        const grade = gradeResponse(response);
        const answers = response.respostas || {};
        const questionRows = (exam.questoes || []).map((question, index) => {
          const answer = answers[question.id];
          const answerText = Array.isArray(answer)
            ? answer.map((choice) => question.opcoes?.[Number(choice)]?.texto || choice).join(", ")
            : question.tipo === "multipla" && answer !== undefined
              ? question.opcoes?.[Number(answer)]?.texto || "Sem resposta"
              : answer || "Sem resposta";
          const key = keys.get(question.id);
          const correctOptions = key?.opcoesCorretas?.map((optionIndex) => question.opcoes?.[optionIndex]?.texto).filter(Boolean).join(", ");
          const answerKey = correctOptions || key?.gabarito || "";
          const manualGrade = isSubmitted && key && !question.opcoes?.length && !key.gabarito
            ? `<label>Nota da resposta (até ${Number(key.pontos || 0)} pontos)<input data-manual-score="${escapeHtml(question.id)}" type="number" min="0" max="${Number(key.pontos || 0)}" step="0.5" value="${escapeHtml(response.pontuacoesManuais?.[question.id] ?? "")}"></label>`
            : "";
          return `<div class="response-answer"><strong>${index + 1}. ${escapeHtml(question.enunciado)}</strong><p>Resposta: ${escapeHtml(answerText)}</p>${answerKey ? `<small data-answer-key>Gabarito: ${escapeHtml(answerKey)}</small>` : ""}${manualGrade}</div>`;
        }).join("");
        const gradeLabel = !isSubmitted ? "Respondendo agora" : grade.note == null ? "Questões pendentes de revisão" : `${grade.manual ? "Nota parcial" : "Nota"} ${grade.note.toFixed(1)} / 10${grade.manual ? " · finalize a correção das respostas abertas" : ""}`;
        const gradeAction = isSubmitted ? `<button class="primary" type="button" data-publish-grade>${response.notaAuto == null ? "Publicar resultado" : "Atualizar resultado"}</button>` : "";
        return `<article class="question-card response-student" data-response-id="${escapeHtml(response.id)}"><div class="response-student-heading"><div><strong>${escapeHtml(response.alunoNome || "Aluno sem nome")}</strong><p>${isSubmitted ? "Enviada" : "Em andamento"} · ${escapeHtml(gradeLabel)}</p></div><div class="session-actions">${gradeAction}<button class="secondary" type="button" data-download-response>Baixar PDF</button><button class="secondary" type="button" data-print-response>Imprimir</button></div></div><header class="response-print-heading" hidden><strong>${escapeHtml(exam.escola || "PEI Prof. Riolando Canno")} · AVALIAÇÃO</strong><h1>${escapeHtml(exam.titulo || "Formulário")}</h1><p>Professor: ${escapeHtml(exam.professorNome || teacherName || "—")} · Aluno: ${escapeHtml(response.alunoNome || "—")}</p><p>Disciplina: ${escapeHtml(exam.disciplina || "—")} · Curso: ${escapeHtml(exam.curso || "—")} · Turma: ${escapeHtml(exam.turma || "—")}</p><p>Data: ${escapeHtml(exam.data || "—")} · Nota: ${grade.note == null ? "Pendente de revisão" : `${grade.note.toFixed(1)} / 10`}</p></header><details><summary>Ver respostas do aluno</summary><div class="response-answer-list">${questionRows}</div></details></article>`;
      }).join("") : "<p>As respostas aparecerão aqui assim que os alunos abrirem o formulário.</p>";
      holder.onclick = (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        const card = button.closest(".response-student");
        const response = responses.find((item) => item.id === card.dataset.responseId);
        if (!response) return;
        if (button.matches("[data-publish-grade]")) {
          const pontuacoesManuais = { ...(response.pontuacoesManuais || {}) };
          const manualInputs = $$("[data-manual-score]", card);
          if (manualInputs.some((input) => input.value === "")) {
            pageError.textContent = "Preencha a pontuação de cada resposta aberta.";
            return;
          }
          manualInputs.forEach((input) => { pontuacoesManuais[input.dataset.manualScore] = Number(input.value); });
          const grade = gradeResponse({ ...response, pontuacoesManuais });
          if (grade.manual || grade.note == null) {
            pageError.textContent = "Preencha as notas das respostas abertas antes de publicar o resultado.";
            return;
          }
          if (!response.resultadoId) {
            pageError.textContent = "Não foi possível localizar o registro desta entrega para publicar a nota.";
            return;
          }
          const batch = writeBatch(db);
          batch.update(doc(db, "provas", examId, "respostasFormulario", response.id), {
            pontuacoesManuais, notaAuto: grade.note, acertos: grade.correct,
            revisaoManual: false, corrigidaEm: serverTimestamp()
          });
          batch.update(doc(db, "provas", response.resultadoId), {
            notaAuto: grade.note, acertos: grade.correct, revisaoManual: false,
            corrigidaEm: serverTimestamp()
          });
          batch.commit().catch(report);
          return;
        }
        const payload = {
          escola: exam.escola, professor: exam.professorNome, aluno: response.alunoNome,
          disciplina: exam.disciplina, curso: exam.curso, turma: exam.turma, data: exam.data,
          titulo: exam.titulo, nota: gradeResponse(response).note, status: response.status,
          questoes: (exam.questoes || []).map((question) => ({
            ...question,
            options: question.opcoes?.map((option) => option.texto),
            respostaAluno: Array.isArray(response.respostas?.[question.id])
              ? response.respostas[question.id].map((choice) => question.opcoes?.[Number(choice)]?.texto || choice)
              : question.tipo === "multipla" && response.respostas?.[question.id] !== undefined
                ? question.opcoes?.[Number(response.respostas[question.id])]?.texto
                : response.respostas?.[question.id],
            correta: keys.get(question.id)?.opcoesCorretas || [],
            gabarito: keys.get(question.id)?.gabarito || ""
          }))
        };
        if (button.matches("[data-download-response]")) window.dispatchEvent(new CustomEvent("quizziolando:response-pdf", { detail: payload }));
        if (button.matches("[data-print-response]")) {
          card.dataset.print = "true";
          $("details", card).open = true;
          document.body.classList.add("printing-submission");
          window.addEventListener("afterprint", () => {
            delete card.dataset.print;
            document.body.classList.remove("printing-submission");
          }, { once: true });
          window.print();
        }
      };
    }, report);
  }).catch((error) => {
    holder.textContent = "Não foi possível abrir as respostas deste formulário.";
    report(error);
  });
}

function validExternalLink(value) {
  const link = String(value || "").trim();
  if (!link) return "";
  let url;
  try { url = new URL(link); } catch { fail("Informe um link externo válido."); }
  if (!["http:", "https:"].includes(url.protocol)) fail("O link precisa começar com http:// ou https://.");
  return url.href;
}

function isAllowedClassFile(file) {
  return file && file.size <= 20 * 1024 * 1024
    && (file.type === "application/pdf" || file.type === "text/plain"
      || /^(image|video|audio)\/[a-z0-9.+-]+$/i.test(file.type));
}

async function createPublishedQuizSession(quiz, turma) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000);
    const sessionRef = doc(db, "sessoesJogo", pin);
    const created = await runTransaction(db, async (transaction) => {
      const current = await transaction.get(sessionRef);
      if (current.exists()) return false;
      transaction.set(sessionRef, {
        id: sessionRef.id, quizId: quiz.id, professorId: currentUser.uid,
        titulo: quiz.titulo || "Quiz", turmaId: turma.id, turma: turma.nome, curso: turma.curso,
        pin, status: "lobby", questaoAtual: 0,
        autoAvanco: Boolean(quiz.autoAvanco), intervaloSegundos: Number(quiz.intervaloSegundos || 5),
        monitorarIntegridade: quiz.monitorarIntegridade !== false,
        bloquearBotaoDireito: quiz.bloquearBotaoDireito === true,
        criadoEm: serverTimestamp()
      });
      return true;
    });
    if (created) return { id: sessionRef.id, pin };
  }
  fail("Não foi possível gerar um PIN exclusivo para o quiz. Tente novamente.");
}

function updatePublicationActivityOptions() {
  const turmaId = $("#publication-class")?.value;
  const activityType = $("#activity-type")?.value;
  const isActivity = $("#publication-type")?.value === "atividade";
  $("#activity-type-field").hidden = !isActivity;
  $("#activity-proof-field").hidden = !isActivity || activityType !== "prova";
  $("#activity-quiz-field").hidden = !isActivity || activityType !== "quiz";
  $("#activity-proof").innerHTML = `<option value="">Selecione uma prova</option>${teacherProofs
    .filter((proof) => proof.turmaId === turmaId && proof.status === "disponivel")
    .map((proof) => `<option value="${escapeHtml(proof.id)}">${escapeHtml(proof.titulo)}</option>`).join("")}`;
  $("#activity-quiz").innerHTML = `<option value="">Selecione um quiz</option>${quizzes
    .filter((quiz) => quiz.turmaId === turmaId)
    .map((quiz) => `<option value="${escapeHtml(quiz.id)}">${escapeHtml(quiz.titulo)}</option>`).join("")}`;
}

async function publishClassroomPost(form) {
  const data = new FormData(form);
  const turma = classes.find((item) => item.id === data.get("turmaId"));
  if (!turma) fail("Selecione uma turma sua para publicar.");
  const tipo = String(data.get("tipo"));
  const titulo = String(data.get("titulo") || "").trim();
  const conteudo = String(data.get("conteudo") || "").trim();
  if (!titulo || (tipo !== "atividade" && !conteudo && !data.get("linkExterno") && !$("#publication-file").files?.[0])) {
    fail("Informe um título e pelo menos um conteúdo, link ou arquivo para a aula.");
  }
  const linkExterno = validExternalLink(data.get("linkExterno"));
  const file = $("#publication-file").files?.[0];
  if (file && !isAllowedClassFile(file)) fail("Envie um PDF, texto, imagem, áudio ou vídeo de até 20 MB.");
  const atividadeTipo = tipo === "atividade" ? $("#activity-type").value : "";
  const atividadeId = tipo === "atividade"
    ? (atividadeTipo === "quiz" ? $("#activity-quiz").value : $("#activity-proof").value)
    : "";
  if (tipo === "atividade" && !atividadeId) fail("Selecione o quiz ou a prova que será disponibilizado.");
  const quiz = atividadeTipo === "quiz" ? quizzes.find((item) => item.id === atividadeId) : null;
  const proof = atividadeTipo === "prova" ? teacherProofs.find((item) => item.id === atividadeId) : null;
  if (atividadeTipo === "quiz" && (!quiz || quiz.turmaId !== turma.id)) fail("O quiz selecionado não pertence a esta turma.");
  if (atividadeTipo === "prova" && (!proof || proof.turmaId !== turma.id || proof.status !== "disponivel")) fail("A prova selecionada não está disponível para esta turma.");

  const postRef = doc(collection(db, "turmas", turma.id, "publicacoes"));
  let arquivoPath = "";
  let session;
  try {
    if (file) {
      const safeName = file.name.replace(/[^\w.-]/g, "_");
      arquivoPath = `aulas-atividades/${currentUser.uid}/${turma.id}/${postRef.id}/${crypto.randomUUID()}-${safeName}`;
      await uploadBytes(ref(storage, arquivoPath), file, { contentType: file.type });
    }
    if (quiz) session = await createPublishedQuizSession(quiz, turma);
    const post = {
      id: postRef.id, professorId: currentUser.uid, professorNome: teacherName,
      turmaId: turma.id, turmaNome: turma.nome, curso: turma.curso, disciplina: turma.disciplina,
      titulo, tipo, conteudo, linkExterno, arquivoPath,
      arquivoNome: file?.name || "", arquivoTipo: file?.type || "",
      atividadeTipo, atividadeId, atividadeNome: quiz?.titulo || proof?.titulo || "",
      sessaoId: session?.id || "", pin: session?.pin || "",
      arquivado: false, criadoEm: serverTimestamp()
    };
    await setDoc(postRef, post);
    return { post, session };
  } catch (error) {
    if (session?.id) await deleteDoc(doc(db, "sessoesJogo", session.id)).catch((cleanupError) => console.error("Não foi possível remover a sessão incompleta.", cleanupError));
    if (arquivoPath) await deleteObject(ref(storage, arquivoPath)).catch((cleanupError) => console.error("Não foi possível remover o arquivo incompleto.", cleanupError));
    if (error?.code === "storage/bucket-not-found" || error?.code === "storage/unknown") {
      throw new Error("O Firebase Storage ainda não está inicializado. Ative o Storage no projeto Firebase para publicar arquivos.");
    }
    throw error;
  }
}

async function loadTeacherPublications() {
  const holder = $("#teacher-publications");
  if (!holder) return;
  const filter = $("#publication-filter").value;
  const selectedClasses = classes.filter((item) => !filter || item.id === filter);
  const snapshots = await Promise.all(selectedClasses.map(async (turma) => ({
    turma,
    snapshot: await getDocs(collection(db, "turmas", turma.id, "publicacoes"))
  })));
  const posts = snapshots.flatMap(({ turma, snapshot }) => snapshot.docs.map((item) => ({
    ...item.data(), id: item.id, turmaId: turma.id, turmaNome: turma.nome
  }))).sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
  holder.innerHTML = posts.length ? posts.map((post) => {
    const status = post.arquivado ? "Retirada da turma" : post.tipo === "atividade" ? "Atividade" : "Aula";
    const activityInfo = post.atividadeTipo === "quiz"
      ? `<p>Quiz: ${escapeHtml(post.atividadeNome)} · PIN ${escapeHtml(post.pin)} · <a href="./dashboard.html">Iniciar pelo Dashboard</a></p>`
      : post.atividadeTipo === "prova" ? `<p>Prova: ${escapeHtml(post.atividadeNome)}</p>` : "";
    return `<article class="question-card classroom-post ${post.arquivado ? "archived-post" : ""}" data-post-id="${escapeHtml(post.id)}" data-class-id="${escapeHtml(post.turmaId)}"><div class="post-heading"><span class="pill">${status}</span><strong>${escapeHtml(post.titulo)}</strong></div><p>${escapeHtml(post.turmaNome)} · ${escapeHtml(post.curso)} · ${escapeHtml(post.disciplina)}</p><p>${escapeHtml(post.conteudo)}</p>${post.linkExterno ? `<p><a href="${escapeHtml(post.linkExterno)}" target="_blank" rel="noopener noreferrer">Abrir link complementar</a></p>` : ""}${post.arquivoNome ? `<p>Arquivo: ${escapeHtml(post.arquivoNome)}</p>` : ""}${activityInfo}${post.arquivado ? "" : '<button type="button" class="secondary" data-archive-publication>Retirar da turma</button>'}<section class="comment-panel"><button type="button" class="secondary" data-load-comments>Comentários e reações</button><div data-comments-holder hidden></div></section></article>`;
  }).join("") : "<p>Você ainda não publicou aulas ou atividades.</p>";
  $$(".classroom-post", holder).forEach((card) => {
    const postPath = ["turmas", card.dataset.classId, "publicacoes", card.dataset.postId];
    setupCommentPanel(db, postPath, $(".comment-panel", card), {
      userId: currentUser.uid, name: teacherName || currentUser.displayName || "Professor(a)", role: "professor"
    }, report);
  });
  holder.onclick = async (event) => {
    const button = event.target.closest("[data-archive-publication]");
    if (!button) return;
    const card = button.closest(".classroom-post");
    button.disabled = true;
    try {
      await updateDoc(doc(db, "turmas", card.dataset.classId, "publicacoes", card.dataset.postId), {
        arquivado: true, atualizadoEm: serverTimestamp()
      });
      await loadTeacherPublications();
    } catch (error) { report(error); }
  };
}

async function setupTeacherClassroom() {
  const form = $("#publication-form");
  if (!form) return;
  fillClassSelect("#publication-class");
  const filter = $("#publication-filter");
  filter.innerHTML = `<option value="">Todas as turmas</option>${classes.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nome)}</option>`).join("")}`;
  const proofSnapshot = await getDocs(query(collection(db, "provas"), where("professorId", "==", currentUser.uid)));
  teacherProofs = proofSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  $("#publication-class").addEventListener("change", updatePublicationActivityOptions);
  $("#publication-type").addEventListener("change", updatePublicationActivityOptions);
  $("#activity-type").addEventListener("change", updatePublicationActivityOptions);
  filter.addEventListener("change", () => loadTeacherPublications().catch(report));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("button[type='submit']", form);
    const feedback = $("#publication-feedback");
    button.disabled = true;
    feedback.textContent = "Publicando...";
    try {
      const { post, session } = await publishClassroomPost(form);
      form.reset();
      updatePublicationActivityOptions();
      feedback.textContent = session
        ? `Publicado. Compartilhe o PIN ${session.pin}; inicie o quiz pelo Dashboard.`
        : `“${post.titulo}” foi publicado para ${post.turmaNome}.`;
      await loadTeacherPublications();
    } catch (error) {
      feedback.textContent = error?.message || "Não foi possível publicar.";
      console.error(error);
    } finally { button.disabled = false; }
  });
  await loadTeacherPublications();
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("pt-BR") : "—";
}

async function setupRecords() {
  if (!$("#records-body")) return;
  const [proofsSnapshot, answersSnapshot, quizSnapshots, classSnapshots] = await Promise.all([
    getDocs(query(collection(db, "provas"), where("professorId", "==", currentUser.uid))),
    getDocs(query(collection(db, "respostas"), where("professorId", "==", currentUser.uid))),
    getDocs(query(collection(db, "quizzes"), where("professorId", "==", currentUser.uid))),
    getDocs(query(collection(db, "turmas"), where("professorId", "==", currentUser.uid)))
  ]);
  const quizMap = new Map(quizSnapshots.docs.map((item) => [item.id, item.data()]));
  const classMap = new Map(classSnapshots.docs.map((item) => [item.id, item.data().nome]));
  const rows = proofsSnapshot.docs.filter((item) => item.data().alunoUid || item.data().status === "concluida").map((item) => {
    const proof = item.data();
    return { aluno: proof.alunoNome || "Aguardando aluno", turma: proof.turma || classMap.get(proof.turmaId) || "—", atividade: proof.titulo, disciplina: proof.disciplina, data: proof.concluidaEm || proof.data, nota: proof.notaAuto, tempo: proof.tempoSegundos || 0, acertos: proof.totalQuestoes ? Math.round((proof.acertos / proof.totalQuestoes) * 100) : 0 };
  });
  const gameResults = new Map();
  answersSnapshot.docs.forEach((item) => {
    const answer = item.data();
    const quiz = quizMap.get(answer.quizId);
    if (quiz?.professorId !== currentUser.uid) return;
    const key = `${answer.sessaoId}:${answer.jogadorId}:${answer.quizId}`;
    const result = gameResults.get(key) || {
      aluno: answer.apelido || "Aluno", turma: quiz.turma || "—", atividade: quiz.titulo,
      disciplina: quiz.disciplina, data: answer.data, total: 0, acertos: 0, tempo: 0
    };
    result.total += 1;
    result.acertos += answer.acertou ? 1 : 0;
    result.tempo += Number(answer.tempoResposta || 0);
    gameResults.set(key, result);
  });
  gameResults.forEach((result) => rows.push({
    ...result,
    nota: Math.round((result.acertos / result.total) * 100) / 10,
    acertos: Math.round((result.acertos / result.total) * 100)
  }));
  renderRecordRows(rows);
  $("#date-filter").addEventListener("change", () => renderRecordRows(rows));
  $("#clear-filters").addEventListener("click", () => { $("#date-filter").value = ""; renderRecordRows(rows); });
  $("#export-csv").addEventListener("click", () => {
    const csvRows = [["Aluno", "Turma", "Prova/Quiz", "Disciplina", "Data", "Nota", "Tempo", "% Acertos"], ...currentRecordRows.map((row) => [row.aluno, row.turma, row.atividade, row.disciplina, formatDate(row.data), row.nota, row.tempo, row.acertos])];
    const blob = new Blob(["\uFEFF" + csvRows.map((row) => row.map((field) => `"${String(field ?? "").replaceAll('"', '""')}"`).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "registros-quizziolando.csv"; link.click();
    URL.revokeObjectURL(link.href);
  });
}

let currentRecordRows = [];
function renderRecordRows(rows) {
  const dateFilter = $("#date-filter").value;
  currentRecordRows = rows.filter((row) => !dateFilter || formatDate(row.data) === new Date(`${dateFilter}T00:00:00`).toLocaleDateString("pt-BR"));
  $("#records-body").innerHTML = currentRecordRows.map((row) => `<tr><td>${escapeHtml(row.aluno)}</td><td>${escapeHtml(row.turma)}</td><td>${escapeHtml(row.atividade)}</td><td>${escapeHtml(row.disciplina)}</td><td>${escapeHtml(formatDate(row.data))}</td><td>${escapeHtml(row.nota)}</td><td>${escapeHtml(row.tempo)}s</td><td>${escapeHtml(row.acertos)}%</td></tr>`).join("");
}

async function setupBI() {
  if (!$("#question-chart")) return;
  const [answersSnapshot, proofsSnapshot, classesSnapshot, questionsSnapshot] = await Promise.all([
    getDocs(query(collection(db, "respostas"), where("professorId", "==", currentUser.uid))), getDocs(query(collection(db, "provas"), where("professorId", "==", currentUser.uid))),
    getDocs(query(collection(db, "turmas"), where("professorId", "==", currentUser.uid))),
    getDocs(collection(db, "questions"))
  ]);
  const answers = answersSnapshot.docs.map((item) => item.data());
  const questions = new Map(questionsSnapshot.docs.map((item) => [item.id, item.data()]));
  const correctByQuestion = new Map();
  answers.forEach((answer) => {
    if (answer.professorId && answer.professorId !== currentUser.uid) return;
    const current = correctByQuestion.get(answer.questionId) || { total: 0, correct: 0 };
    current.total += 1; current.correct += answer.acertou ? 1 : 0;
    correctByQuestion.set(answer.questionId, current);
  });
  const labels = [...correctByQuestion.keys()].map((id) => questions.get(id)?.enunciado || id);
  const rates = [...correctByQuestion.values()].map(({ total, correct }) => Math.round((correct / total) * 100));
  new Chart($("#question-chart"), { type: "bar", data: { labels, datasets: [{ label: "Acertos (%)", data: rates, backgroundColor: rates.map((rate) => rate < 50 ? "#dc3545" : "#204B9C") }] }, options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } } } });
  const classes = classesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const proofs = proofsSnapshot.docs.map((item) => item.data()).filter((item) => item.alunoUid);
  const averages = classes.map((classItem) => {
    const grades = proofs.filter((proof) => proof.turmaId === classItem.id).map((proof) => Number(proof.notaAuto || 0));
    return grades.length ? grades.reduce((sum, grade) => sum + grade, 0) / grades.length : 0;
  });
  new Chart($("#class-chart"), { type: "pie", data: { labels: classes.map((item) => item.nome), datasets: [{ data: averages, backgroundColor: ["#204B9C", "#FFC700", "#4d83d2", "#f2a900", "#6589bd"] }] } });
  const studentFilter = $("#student-filter");
  const studentIds = [...new Set(proofs.map((proof) => proof.alunoUid))];
  const studentNames = new Map(proofs.map((proof) => [proof.alunoUid, proof.alunoNome || proof.alunoUid]));
  studentFilter.innerHTML += studentIds.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(studentNames.get(id))}</option>`).join("");
  let studentChart;
  const drawStudent = () => {
    const selected = studentFilter.value;
    const studentProofs = proofs.filter((proof) => proof.alunoUid === selected).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    studentChart?.destroy();
    studentChart = new Chart($("#student-chart"), { type: "line", data: { labels: studentProofs.map((proof) => proof.data || ""), datasets: [{ label: "Nota", data: studentProofs.map((proof) => Number(proof.notaAuto || 0)), borderColor: "#204B9C", tension: .25 }] }, options: { scales: { y: { min: 0, max: 10 } } } });
  };
  studentFilter.addEventListener("change", drawStudent);
  drawStudent();
  const missed = [...correctByQuestion.entries()].sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total)).slice(0, 5);
  $("#missed-list").innerHTML = missed.map(([id, counts]) => `<li>${escapeHtml(questions.get(id)?.enunciado || id)} (${counts.total - counts.correct} erros)</li>`).join("") || "<li>Sem respostas registradas.</li>";
  const riskyStudents = proofs.filter((proof) => Number(proof.notaAuto) < 5);
  $("#risk-list").innerHTML = riskyStudents.map((proof) => `<li>${escapeHtml(proof.alunoNome || "Aluno")} — ${escapeHtml(proof.notaAuto)} / 10</li>`).join("") || "<li>Nenhum aluno em risco.</li>";
}

function initializePage() {
  const root = pagePath();
  if ($("#class-form")) setupDashboard();
  if ($("#catalog-form")) setupAcademicCatalog();
  if ($("#exam-form")) setupExamForm();
  if ($("#form-responses")) setupFormResponses();
  if ($("#publication-form")) setupTeacherClassroom().catch(report);
  if ($("#records-body")) setupRecords().catch(report);
  if ($("#question-chart")) setupBI().catch(report);
}

function setupClassManager() {
  const toggleButton = $("#toggle-quiz-class-form") || $("#toggle-exam-class-form");
  const classForm = $("#quiz-class-form") || $("#exam-class-form");
  if (!toggleButton || !classForm) return;
  toggleButton.addEventListener("click", () => {
    classForm.hidden = !classForm.hidden;
    toggleButton.setAttribute("aria-expanded", String(!classForm.hidden));
    toggleButton.textContent = classForm.hidden ? "Cadastrar turma nova" : "Fechar cadastro";
  });
  classForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const feedback = $("#class-feedback");
    feedback.textContent = "";
    if (!currentUser) {
      feedback.textContent = "Faça login como professor para cadastrar uma turma.";
      return;
    }
    const data = new FormData(classForm);
    const nome = String(data.get("nome") || "").trim();
    const curso = String(data.get("curso") || "").trim();
    const disciplina = String(data.get("disciplina") || "").trim();
    if (!nome || !curso || !disciplina) {
      feedback.textContent = "Preencha o nome, o curso e a disciplina da turma.";
      return;
    }
    const submitButton = $("button[type='submit']", classForm);
    submitButton.disabled = true;
    try {
      const turma = await persistClass(data);
      classForm.reset();
      classForm.hidden = true;
      toggleButton.setAttribute("aria-expanded", "false");
      toggleButton.textContent = "Cadastrar turma nova";
      feedback.textContent = `Turma "${turma.nome}" cadastrada e selecionada.`;
    } catch (error) {
      feedback.textContent = error?.message || "Não foi possível cadastrar a turma.";
      console.error(error);
    } finally {
      submitButton.disabled = false;
    }
  });
}

if ($("#quiz-form") && $("#questions")) setupQuestionBuilder();
setupClassManager();
$("#refresh-classes")?.addEventListener("click", () => reloadClasses());
setupSoundEffects();
setupTutorial();

$$("[data-signout]").forEach((button) => button.addEventListener("click", () => {
  stopAccessMonitoring(currentUser);
  signOut(auth).then(() => { location.href = "../index.html"; }).catch(report);
}));
onAuthStateChanged(auth, async (account) => {
  if (!account || account.isAnonymous) { location.href = `../index.html?redirect=${encodeURIComponent(location.pathname)}`; return; }
  currentUser = account;
  try {
    const access = await readAccountAccess(db, account);
    if (!access.allowed) {
      pageError.textContent = `Esta conta está ${access.status === "banned" ? "banida" : "desativada"} no site.${access.reason ? ` Motivo: ${access.reason}` : ""}`;
      return;
    }
    startAccessMonitoring(db, account);
    showMasterLink(account);
    if (pagePath().endsWith("/controle-master") && !isMasterAccount(account)) {
      pageError.textContent = "Esta área é exclusiva da conta master verificada.";
      return;
    }
    const userRef = doc(db, "users", account.uid);
    const userSnapshot = await getDoc(userRef);
    if (!userSnapshot.exists()) {
      teacherName = account.displayName || account.email || "";
      await setDoc(userRef, { uid: account.uid, nome: teacherName || "Professor(a)", email: account.email || "", role: "professor", escola: "PEI Riolando Canno" }, { merge: true });
    } else if (userSnapshot.data().role !== "professor") fail("Esta área é exclusiva para professores.");
    else teacherName = userSnapshot.data().nome || account.displayName || account.email || "";
    await loadTeacherData();
    await loadAcademicCatalog();
    refreshAcademicSelects();
    fillClassSelect("#quiz-turma");
    fillClassSelect("#exam-turma");
    initializePage();
  } catch (error) { report(error); }
});

$("#google-signin")?.addEventListener("click", () => signInWithPopup(auth, new GoogleAuthProvider()).catch(report));

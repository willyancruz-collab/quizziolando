import { auth, db } from "./firebase-config.js";
import {
  collection, doc, getDocs, limit, orderBy, query, serverTimestamp,
  Timestamp, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { isMasterAccount, startAccessMonitoring, stopAccessMonitoring } from "./access-monitor.js";
import { setupSoundEffects } from "./sound-effects.js";
import { setupTutorial } from "./tutorial.js";

const $ = (selector) => document.querySelector(selector);
const pageError = $("#master-feedback");
let account;
let accounts = [];
let presence = [];
let logs = [];
let audit = [];
let presenceRefreshTimer;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function dateLabel(value) {
  const date = value?.toDate?.();
  return date ? date.toLocaleString("pt-BR") : "—";
}

function displayIdentity(item) {
  const profileName = accounts.find((entry) => entry.uid === item.uid)?.nome;
  return profileName || item.email || item.uid || "Conta sem e-mail";
}

async function removeExpiredLogs() {
  let removed = 0;
  while (true) {
    const expired = await getDocs(query(
      collection(db, "accessLogs"),
      where("expiresAt", "<", Timestamp.now()),
      limit(400)
    ));
    if (expired.empty) break;
    const batch = writeBatch(db);
    expired.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
    removed += expired.size;
    if (expired.size < 400) break;
  }
  return removed;
}

async function removeStalePresence() {
  let removed = 0;
  const cutoff = Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000));
  while (true) {
    const stale = await getDocs(query(
      collection(db, "accessPresence"),
      where("lastSeen", "<", cutoff),
      limit(400)
    ));
    if (stale.empty) break;
    const batch = writeBatch(db);
    stale.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
    removed += stale.size;
    if (stale.size < 400) break;
  }
  return removed;
}

function renderAccounts() {
  const term = $("#account-search").value.trim().toLocaleLowerCase("pt-BR");
  const visible = accounts.filter((item) => {
    const text = `${item.nome || ""} ${item.email || ""} ${item.uid || ""}`.toLocaleLowerCase("pt-BR");
    return text.includes(term);
  });
  $("#accounts-body").innerHTML = visible.map((item) => {
    const status = item.accessStatus || "active";
    const statusLabel = status === "active" ? "Ativa" : status === "banned" ? "Banida no site" : "Desativada";
    const isSelf = item.uid === account.uid;
    return `<tr><td><strong>${escapeHtml(item.nome || "Sem nome")}</strong><br><small>${escapeHtml(item.email || item.uid)}</small></td><td>${escapeHtml(item.role || "—")}</td><td><span class="account-status status-${escapeHtml(status)}">${statusLabel}</span></td><td>${escapeHtml(item.accessReason || "—")}</td><td>${isSelf ? "Conta master" : `<label class="sr-only" for="status-${escapeHtml(item.uid)}">Novo status de ${escapeHtml(item.email || item.uid)}</label><select id="status-${escapeHtml(item.uid)}" data-account-status="${escapeHtml(item.uid)}"><option value="active" ${status === "active" ? "selected" : ""}>Ativar</option><option value="disabled" ${status === "disabled" ? "selected" : ""}>Desativar</option><option value="banned" ${status === "banned" ? "selected" : ""}>Banir</option></select><input data-account-reason="${escapeHtml(item.uid)}" maxlength="300" placeholder="Motivo (opcional)" aria-label="Motivo da ação"><button class="secondary" type="button" data-save-account="${escapeHtml(item.uid)}">Aplicar</button>`}</td></tr>`;
  }).join("") || '<tr><td colspan="5">Nenhuma conta encontrada.</td></tr>';
}

function renderPresence() {
  const statuses = new Map(accounts.map((item) => [item.uid, item.accessStatus || "active"]));
  const active = presence.filter((item) =>
    Date.now() - (item.lastSeen?.toMillis?.() || 0) <= 5 * 60 * 1000
    && (statuses.get(item.uid) || "active") === "active"
  );
  $("#active-count").textContent = String(active.length);
  $("#active-students").textContent = String(active.filter((item) => item.role === "aluno").length);
  $("#active-teachers").textContent = String(active.filter((item) => item.role === "professor").length);
  $("#presence-body").innerHTML = active.sort((a, b) => (b.lastSeen?.toMillis?.() || 0) - (a.lastSeen?.toMillis?.() || 0))
    .map((item) => `<tr><td>${escapeHtml(displayIdentity(item))}</td><td>${item.role === "aluno" ? "Aluno" : "Professor"}</td><td>${escapeHtml(item.page || "—")}</td><td>${escapeHtml(dateLabel(item.lastSeen))}</td></tr>`)
    .join("") || '<tr><td colspan="4">Nenhuma conta com atividade recente.</td></tr>';
}

function renderHistory() {
  $("#access-history-body").innerHTML = logs.map((item) =>
    `<tr><td>${escapeHtml(dateLabel(item.accessedAt))}</td><td>${escapeHtml(displayIdentity(item))}</td><td>${item.role === "aluno" ? "Aluno" : "Professor"}</td><td>${escapeHtml(item.page || "—")}</td></tr>`
  ).join("") || '<tr><td colspan="4">Nenhum acesso no período.</td></tr>';
  $("#audit-body").innerHTML = audit.map((item) =>
    `<tr><td>${escapeHtml(dateLabel(item.createdAt))}</td><td>${item.action === "banned" ? "Banimento" : item.action === "disabled" ? "Desativação" : "Reativação"}</td><td>${escapeHtml(item.targetEmail || item.targetUid)}</td><td>${escapeHtml(item.actorEmail || item.actorUid)}</td><td>${escapeHtml(item.reason || "—")}</td></tr>`
  ).join("") || '<tr><td colspan="5">Nenhuma ação registrada.</td></tr>';
}

async function loadMasterData() {
  pageError.textContent = "Carregando dados do painel...";
  try {
    const expiredCount = await removeExpiredLogs();
    await removeStalePresence();
    const [accountSnapshot, presenceSnapshot, logSnapshot, auditSnapshot] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(query(collection(db, "accessPresence"), where("lastSeen", ">=", Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000))))),
      getDocs(query(collection(db, "accessLogs"), orderBy("accessedAt", "desc"), limit(200))),
      getDocs(query(collection(db, "adminAudit"), orderBy("createdAt", "desc"), limit(100)))
    ]);
    accounts = accountSnapshot.docs.map((item) => ({ uid: item.id, ...item.data(), profileExists: true }));
    presence = presenceSnapshot.docs.map((item) => item.data());
    logs = logSnapshot.docs.map((item) => item.data())
      .filter((item) => (item.expiresAt?.toMillis?.() || 0) > Date.now());
    const knownAccounts = new Map(accounts.map((item) => [item.uid, item]));
    [...presence, ...logs].forEach((item) => {
      if (!item.uid || knownAccounts.has(item.uid)) return;
      const profile = {
        uid: item.uid,
        email: item.email || "",
        nome: item.email || "Aluno sem perfil",
        role: item.role || "aluno",
        accessStatus: "active",
        profileExists: false
      };
      knownAccounts.set(item.uid, profile);
    });
    accounts = [...knownAccounts.values()]
      .sort((a, b) => String(a.nome || a.email || "").localeCompare(String(b.nome || b.email || ""), "pt-BR"));
    audit = auditSnapshot.docs.map((item) => item.data());
    renderAccounts();
    renderPresence();
    renderHistory();
    pageError.textContent = expiredCount ? `${expiredCount} registros de acesso expirados foram removidos.` : "";
  } catch (error) {
    pageError.textContent = error?.message || "Não foi possível carregar os dados master.";
    console.error(error);
  }
}

async function refreshPresence() {
  const snapshot = await getDocs(query(
    collection(db, "accessPresence"),
    where("lastSeen", ">=", Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)))
  ));
  presence = snapshot.docs.map((item) => item.data());
  renderPresence();
}

async function updateAccountStatus(targetUid, nextStatus, reason) {
  if (targetUid === account.uid) throw new Error("Não é permitido alterar o status da própria conta master.");
  const target = accounts.find((item) => item.uid === targetUid);
  if (!target) throw new Error("A conta selecionada não foi encontrada.");
  const previousStatus = target.accessStatus || "active";
  if (previousStatus === nextStatus) return;
  const actionText = nextStatus === "banned" ? "banir" : nextStatus === "disabled" ? "desativar" : "reativar";
  if (!window.confirm(`Confirma ${actionText} ${target.email || target.uid} no site?`)) return;
  const batch = writeBatch(db);
  const accountRef = doc(db, "users", targetUid);
  const statusFields = {
    accessStatus: nextStatus,
    accessReason: nextStatus === "active" ? "" : reason,
    accessUpdatedAt: serverTimestamp(),
    accessUpdatedBy: account.uid
  };
  if (target.profileExists) {
    batch.update(accountRef, statusFields);
  } else {
    batch.set(accountRef, {
      uid: targetUid,
      nome: target.nome || "Aluno sem perfil",
      email: target.email || "",
      role: target.role === "professor" ? "professor" : "aluno",
      escola: "PEI Riolando Canno",
      ...statusFields
    });
  }
  const auditRef = doc(collection(db, "adminAudit"));
  batch.set(auditRef, {
    id: auditRef.id,
    actorUid: account.uid,
    actorEmail: account.email,
    targetUid,
    targetEmail: target.email || "",
    action: nextStatus,
    previousStatus,
    reason: nextStatus === "active" ? "" : reason,
    createdAt: serverTimestamp()
  });
  await batch.commit();
}

$("#account-search").addEventListener("input", renderAccounts);
$("#accounts-body").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-save-account]");
  if (!button) return;
  button.disabled = true;
  const targetUid = button.dataset.saveAccount;
  const status = $(`[data-account-status="${CSS.escape(targetUid)}"]`).value;
  const reason = $(`[data-account-reason="${CSS.escape(targetUid)}"]`).value.trim();
  try {
    await updateAccountStatus(targetUid, status, reason);
    await loadMasterData();
  } catch (error) {
    pageError.textContent = error?.message || "Não foi possível atualizar a conta.";
    console.error(error);
  } finally {
    button.disabled = false;
  }
});
$("#refresh-master").addEventListener("click", () => loadMasterData());
$("#master-signout").addEventListener("click", () => {
  stopAccessMonitoring(account);
  signOut(auth).then(() => { location.href = "../index.html"; }).catch((error) => {
    pageError.textContent = error?.message || "Não foi possível sair.";
  });
});

setupSoundEffects();
setupTutorial();
onAuthStateChanged(auth, async (currentAccount) => {
  account = currentAccount;
  if (!currentAccount) {
    pageError.textContent = "Entre com a conta master para continuar.";
    return;
  }
  if (currentAccount.email?.toLowerCase() !== "willyancruz@prof.educacao.sp.gov.br") {
    pageError.textContent = "Acesso restrito à conta master autorizada.";
    return;
  }
  if (!isMasterAccount(currentAccount)) {
    pageError.textContent = "Verifique o e-mail da conta master para habilitar o painel.";
    return;
  }
  $("#master-content").hidden = false;
  startAccessMonitoring(db, currentAccount);
  await loadMasterData();
  window.clearInterval(presenceRefreshTimer);
  presenceRefreshTimer = window.setInterval(() => refreshPresence().catch((error) => {
    pageError.textContent = error?.message || "Não foi possível atualizar a presença.";
  }), 60_000);
});

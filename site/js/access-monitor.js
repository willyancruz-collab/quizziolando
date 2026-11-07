import {
  collection, doc, getDoc, serverTimestamp, setDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const MASTER_EMAIL = "willyancruz@prof.educacao.sp.gov.br";
const activeTrackers = new Map();
const DAY_MS = 24 * 60 * 60 * 1000;

export function isMasterAccount(account) {
  return account?.email?.toLowerCase() === MASTER_EMAIL && account.emailVerified === true;
}

export function showMasterLink(account) {
  if (!isMasterAccount(account)) return;
  const nav = document.querySelector("header nav, .site-nav");
  if (!nav || nav.querySelector("[data-master-link]")) return;
  const link = document.createElement("a");
  link.href = location.pathname.toLowerCase().includes("/professor/")
    ? "./controle-master.html"
    : "/professor/controle-master.html";
  link.textContent = "Controle master";
  link.dataset.masterLink = "";
  nav.append(link);
}

export async function readAccountAccess(db, account) {
  if (!account) return { allowed: false };
  const snapshot = await getDoc(doc(db, "users", account.uid));
  if (!snapshot.exists()) return { allowed: true };
  const profile = snapshot.data();
  const status = profile.accessStatus || "active";
  return {
    allowed: status === "active" || isMasterAccount(account),
    status,
    reason: profile.accessReason || ""
  };
}

export function startAccessMonitoring(db, account) {
  if (!account || activeTrackers.has(account.uid)) return;
  for (const [uid, stop] of activeTrackers) {
    if (uid === account.uid) continue;
    stop();
    activeTrackers.delete(uid);
  }
  const page = location.pathname.slice(0, 180);
  const role = account.isAnonymous ? "aluno" : "professor";
  const identity = {
    uid: account.uid,
    email: account.email || "",
    role,
    page
  };
  if (!document.querySelector("[data-access-notice]")) {
    const notice = document.createElement("p");
    notice.className = "access-privacy-note";
    notice.dataset.accessNotice = "";
    notice.textContent = "Para gestão e segurança, registramos o histórico de acessos por 90 dias e a presença aproximada desta conta. Não coletamos endereço IP.";
    document.querySelector("main")?.prepend(notice);
  }
  const presenceRef = doc(db, "accessPresence", account.uid);
  const writePresence = () => setDoc(presenceRef, {
    ...identity,
    lastSeen: serverTimestamp()
  }, { merge: true });

  const handlePresenceError = (error) => {
    console.error("Não foi possível atualizar a presença.", error);
    if (error?.code === "permission-denied") stopAccessMonitoring(account);
  };
  writePresence().catch(handlePresenceError);
  const heartbeat = window.setInterval(() => {
    writePresence().catch(handlePresenceError);
  }, 240_000);

  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 90 * DAY_MS));
  setDoc(doc(collection(db, "accessLogs")), {
    ...identity,
    accessedAt: serverTimestamp(),
    expiresAt
  }).catch((error) => console.error("Não foi possível registrar o acesso.", error));

  activeTrackers.set(account.uid, () => window.clearInterval(heartbeat));
}

export function stopAccessMonitoring(account) {
  if (!account) return;
  activeTrackers.get(account.uid)?.();
  activeTrackers.delete(account.uid);
}

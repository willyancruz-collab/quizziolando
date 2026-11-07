import {
  collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const QUICK_EMOJIS = ["🙂", "❤️", "👍", "👏"];
const COMMENT_REACTIONS = ["👍", "❤️", "😂", "👏", "💡"];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function emojiButtons() {
  return QUICK_EMOJIS.map((emoji) => `<button type="button" class="emoji-button" data-insert-emoji="${emoji}" aria-label="Inserir ${emoji}">${emoji}</button>`).join("");
}

async function renderComments(db, postPath, currentUserId) {
  const commentsSnapshot = await getDocs(collection(db, ...postPath, "comentarios"));
  const comments = commentsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
  const reactions = new Map(await Promise.all(comments.map(async (comment) => {
    const snapshot = await getDocs(collection(db, ...postPath, "comentarios", comment.id, "reacoes"));
    return [comment.id, snapshot.docs.map((item) => item.data())];
  })));
  const children = new Map();
  comments.forEach((comment) => {
    const parentId = comments.some((candidate) => candidate.id === comment.parentId) ? comment.parentId : "";
    const siblings = children.get(parentId) || [];
    siblings.push(comment);
    children.set(parentId, siblings);
  });
  const renderBranch = (parentId, depth = 0) => (children.get(parentId) || []).map((comment) => {
    const marginLeft = Math.min(depth, 3) * 14;
    const commentReactions = reactions.get(comment.id) || [];
    const reactionButtons = COMMENT_REACTIONS.map((emoji) => {
      const count = commentReactions.filter((reaction) => reaction.emoji === emoji).length;
      const selected = commentReactions.some((reaction) => reaction.usuarioId === currentUserId && reaction.emoji === emoji);
      return `<button type="button" class="reaction-button ${selected ? "selected" : ""}" data-react="${emoji}" aria-pressed="${selected}">${emoji} <span>${count || ""}</span></button>`;
    }).join("");
    const authorRole = comment.autorRole === "professor" ? "Professor(a)" : "Aluno(a)";
    return `<article class="comment-entry" data-comment-id="${escapeHtml(comment.id)}" style="margin-left:${marginLeft}px"><p><strong>${escapeHtml(comment.autorNome || authorRole)}</strong> <span class="comment-role">${authorRole}</span></p><p>${escapeHtml(comment.texto)}</p><div class="comment-actions">${reactionButtons}${depth === 0 ? '<button type="button" class="comment-reply" data-toggle-reply>Responder</button>' : ""}</div>${depth === 0 ? `<form class="comment-form reply-form" data-parent-id="${escapeHtml(comment.id)}" hidden><label>Resposta<textarea required maxlength="2000" rows="2"></textarea></label><div class="emoji-picker">${emojiButtons()}</div><button class="primary" type="submit">Enviar resposta</button></form>` : ""}${renderBranch(comment.id, depth + 1)}</article>`;
  }).join("");

  return `<div class="comment-list">${renderBranch("") || "<p>Seja o primeiro a comentar.</p>"}</div><form class="comment-form" data-parent-id=""><label>Escreva um comentário<textarea required maxlength="2000" rows="2"></textarea></label><div class="emoji-picker">${emojiButtons()}</div><button class="primary" type="submit">Comentar</button></form>`;
}

export function setupCommentPanel(db, postPath, panel, identity, report) {
  const toggle = panel.querySelector("[data-load-comments]");
  const holder = panel.querySelector("[data-comments-holder]");
  if (!toggle || !holder) return;
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      holder.innerHTML = await renderComments(db, postPath, identity.userId);
      holder.hidden = false;
      toggle.textContent = "Atualizar comentários";
      holder.onclick = async (event) => {
        const emojiButton = event.target.closest("[data-insert-emoji]");
        if (emojiButton) {
          const textarea = emojiButton.closest(".comment-form").querySelector("textarea");
          textarea.value += emojiButton.dataset.insertEmoji;
          textarea.focus();
          return;
        }
        const replyButton = event.target.closest("[data-toggle-reply]");
        if (replyButton) {
          const form = replyButton.closest(".comment-entry").querySelector(".reply-form");
          form.hidden = !form.hidden;
          if (!form.hidden) form.querySelector("textarea").focus();
          return;
        }
        const reactionButton = event.target.closest("[data-react]");
        if (!reactionButton) return;
        reactionButton.disabled = true;
        try {
          const commentId = reactionButton.closest(".comment-entry").dataset.commentId;
          const reactionRef = doc(db, ...postPath, "comentarios", commentId, "reacoes", identity.userId);
          const currentEmoji = reactionButton.dataset.react;
          const isSelected = reactionButton.getAttribute("aria-pressed") === "true";
          if (isSelected) await deleteDoc(reactionRef);
          else await setDoc(reactionRef, { usuarioId: identity.userId, emoji: currentEmoji, atualizadaEm: serverTimestamp() });
          holder.innerHTML = await renderComments(db, postPath, identity.userId);
        } catch (error) {
          report(error);
        }
      };
      holder.onsubmit = async (event) => {
        const form = event.target.closest(".comment-form");
        if (!form) return;
        event.preventDefault();
        const submit = form.querySelector("button[type='submit']");
        submit.disabled = true;
        try {
          const text = form.querySelector("textarea").value.trim();
          if (!text) throw new Error("Escreva um comentário antes de enviar.");
          const commentRef = doc(collection(db, ...postPath, "comentarios"));
          await setDoc(commentRef, {
            id: commentRef.id, autorUid: identity.userId, autorNome: identity.name,
            autorRole: identity.role, texto: text, parentId: form.dataset.parentId || "",
            criadoEm: serverTimestamp()
          });
          holder.innerHTML = await renderComments(db, postPath, identity.userId);
        } catch (error) {
          report(error);
        } finally {
          submit.disabled = false;
        }
      };
    } catch (error) {
      report(error);
    } finally {
      toggle.disabled = false;
    }
  });
}

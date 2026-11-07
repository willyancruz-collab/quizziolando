function imageToDataUrl(url) {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Não foi possível carregar a imagem: ${response.status}`);
    return response.blob();
  }).then((blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não foi possível preparar a imagem para o PDF."));
    reader.readAsDataURL(blob);
  }));
}

async function generateExamPdf(data) {
  if (!window.jspdf?.jsPDF) throw new Error("A biblioteca jsPDF não foi carregada.");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  let y = 18;
  const ensureSpace = (height) => {
    if (y + height > pageHeight - 18) { pdf.addPage(); y = 18; }
  };
  const line = (label, value) => {
    const text = `${label}: ${value || "________________________________"}`;
    const lines = pdf.splitTextToSize(text, pageWidth - margin * 2);
    ensureSpace(lines.length * 6 + 2);
    pdf.text(lines, margin, y);
    y += lines.length * 6 + 2;
  };

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(32, 75, 156);
  pdf.text("Q  QUIZZIOLANDO", margin, y);
  y += 9;
  pdf.setFontSize(13);
  pdf.text(data.escola || "PEI Prof. Riolando Canno", margin, y);
  y += 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(30, 35, 50);
  line("Formulário", data.titulo);
  line("Professor", data.professor);
  line("Aluno", data.aluno);
  line("Disciplina", data.disciplina);
  line("Curso", data.curso);
  line("Turma", data.turma);
  line("Data", data.data);
  line("Nota", data.nota);
  y += 5;

  for (const [index, question] of data.questoes.entries()) {
    const prompt = pdf.splitTextToSize(`${index + 1}. ${question.enunciado}`, pageWidth - margin * 2);
    ensureSpace(prompt.length * 5 + 15);
    pdf.setFont("helvetica", "bold");
    pdf.text(prompt, margin, y);
    y += prompt.length * 5 + 2;
    if (question.imagemUrl) {
      const image = await imageToDataUrl(question.imagemUrl);
      ensureSpace(55);
      const format = image.slice(5, image.indexOf(";")).toUpperCase().replace("IMAGE/", "");
      pdf.addImage(image, format, margin, y, 65, 45, undefined, "FAST");
      y += 49;
    }
    pdf.setFont("helvetica", "normal");
    if (question.options?.length) {
      for (const [optionIndex, option] of question.options.entries()) {
        const optionLines = pdf.splitTextToSize(`(   ) ${String.fromCharCode(65 + optionIndex)}) ${option}`, pageWidth - margin * 2 - 4);
        ensureSpace(optionLines.length * 5 + 2);
        pdf.text(optionLines, margin + 4, y);
        y += optionLines.length * 5 + 2;
      }
    } else {
      for (let blank = 0; blank < (question.tipo === "paragrafo" ? 6 : 2); blank += 1) {
        ensureSpace(7);
        pdf.text("________________________________________________________________", margin + 4, y);
        y += 7;
      }
    }
    y += 4;
  }
  pdf.setFontSize(9);
  pdf.setTextColor(90, 90, 90);
  const footer = "PEI Prof. Riolando Canno - Avaliação";
  for (let page = 1; page <= pdf.getNumberOfPages(); page += 1) {
    pdf.setPage(page);
    pdf.text(footer, pageWidth / 2, pageHeight - 9, { align: "center" });
  }
  pdf.save("avaliacao-quizziolando.pdf");
}

async function generateResponsePdf(data) {
  if (!window.jspdf?.jsPDF) throw new Error("A biblioteca jsPDF não foi carregada.");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 9;
  const gutter = 5;
  const columnWidth = (pageWidth - margin * 2 - gutter) / 2;
  const lineHeight = 3.5;
  const bottom = pageHeight - 12;
  let headerY = 8;
  const writeHeader = (value, { bold = false, size = 8, gap = 1 } = {}) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(String(value || "—"), pageWidth - margin * 2);
    pdf.text(lines, margin, headerY);
    headerY += lines.length * size * 0.4 + gap;
  };
  pdf.setTextColor(32, 75, 156);
  writeHeader(`${data.escola || "PEI Prof. Riolando Canno"} · AVALIAÇÃO`, { bold: true, size: 10, gap: 1 });
  writeHeader(data.titulo || "Respostas do formulário", { bold: true, size: 11, gap: 1 });
  pdf.setTextColor(30, 35, 50);
  writeHeader(`Professor: ${data.professor || "—"} · Aluno: ${data.aluno || "—"}`);
  writeHeader(`Disciplina: ${data.disciplina || "—"} · Curso: ${data.curso || "—"} · Turma: ${data.turma || "—"}`);
  writeHeader(`Data: ${data.data || "—"} · Status: ${data.status === "enviada" ? "Enviada" : "Em andamento"} · Nota: ${data.nota == null ? "Pendente de revisão" : `${Number(data.nota).toFixed(1)} / 10`}`, { bold: true, gap: 2 });
  const firstPageY = headerY;
  let column = 0;
  let columnY = [firstPageY, firstPageY];
  const nextColumn = () => {
    if (column === 0) {
      column = 1;
      return;
    }
    pdf.addPage();
    column = 0;
    columnY = [10, 10];
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(32, 75, 156);
    pdf.text(`${data.titulo || "Formulário"} · ${data.aluno || "Aluno"} (continuação)`, margin, 7);
    pdf.setTextColor(30, 35, 50);
  };
  for (const [index, question] of (data.questoes || []).entries()) {
    const prompt = pdf.splitTextToSize(`${index + 1}. ${question.enunciado || "—"}`, columnWidth);
    const answer = Array.isArray(question.respostaAluno) ? question.respostaAluno.join(", ") : question.respostaAluno;
    const answerLines = pdf.splitTextToSize(`Resposta: ${answer || "Sem resposta"}`, columnWidth);
    const blockHeight = (prompt.length + answerLines.length) * lineHeight + 2;
    if (blockHeight <= bottom - firstPageY && columnY[column] + blockHeight > bottom) nextColumn();
    const drawLines = (lines, bold) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(7.5);
      for (const line of lines) {
        if (columnY[column] + lineHeight > bottom) nextColumn();
        pdf.text(line, margin + column * (columnWidth + gutter), columnY[column]);
        columnY[column] += lineHeight;
      }
    };
    drawLines(prompt, true);
    drawLines(answerLines, false);
    columnY[column] += 2;
  }
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(90, 90, 90);
  for (let page = 1; page <= pdf.getNumberOfPages(); page += 1) {
    pdf.setPage(page);
    pdf.text(`PEI Prof. Riolando Canno - Avaliação · ${page}/${pdf.getNumberOfPages()}`, pageWidth / 2, pageHeight - 6, { align: "center" });
  }
  const safeName = String(data.aluno || "aluno").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
  pdf.save(`resposta-${safeName || "aluno"}.pdf`);
}

window.addEventListener("quizziolando:pdf", (event) => {
  generateExamPdf(event.detail).catch((error) => {
    const feedback = document.querySelector("#page-error");
    if (feedback) feedback.textContent = error.message || "Falha ao gerar PDF.";
    console.error(error);
  });
});

window.addEventListener("quizziolando:response-pdf", (event) => {
  generateResponsePdf(event.detail).catch((error) => {
    const feedback = document.querySelector("#page-error");
    if (feedback) feedback.textContent = error.message || "Falha ao gerar PDF da resposta.";
    console.error(error);
  });
});

const AUTO_KEY = "quizziolando:tutorial-auto";
const DISMISSED_PREFIX = "quizziolando:tutorial-dismissed:";

function readAutoPreference() {
  try {
    return localStorage.getItem(AUTO_KEY) !== "false";
  } catch (error) {
    console.warn("Não foi possível ler a preferência do tutorial.", error);
    return true;
  }
}

function saveAutoPreference(value) {
  try {
    localStorage.setItem(AUTO_KEY, String(value));
  } catch (error) {
    console.error("Não foi possível salvar a preferência do tutorial.", error);
  }
}

function pageSteps() {
  const path = location.pathname.toLowerCase().replace(/\.html$/, "").replace(/\/+$/, "");
  if (path.endsWith("/controle-master")) return [
    { title: "Visão geral do controle master", text: "Esta área é exclusiva da conta master verificada. Aqui você administra contas do site, consulta presença e acessos e revisa o histórico de ações administrativas.", target: ".master-notice" },
    { title: "Contas e bloqueios", text: "Pesquise pelo nome, e-mail ou UID. Escolha ativar, desativar ou banir no site; você pode registrar um motivo. A mudança é reversível e não desativa a conta no Firebase Auth.", target: "#accounts-body" },
    { title: "Presença e acessos", text: "Presença é aproximada: conta com sinal nos últimos cinco minutos. O histórico de acessos é mantido por até 90 dias. O painel não coleta IP e não conta pessoas únicas.", target: "#presence-body" },
    { title: "Auditoria", text: "As mudanças de status aparecem no registro de auditoria com responsável, horário e motivo. Use “Atualizar dados” para recarregar o painel.", target: "#audit-body" }
  ];
  if (path.endsWith("/dashboard")) return [
    { title: "Quizzes", text: "Veja seus quizzes e filtre por disciplina, turma ou curso. Use “Abrir sessão” para gerar um PIN e preparar o jogo.", target: "#quiz-list" },
    { title: "Sessões ao vivo", text: "Selecione uma sessão, compartilhe o PIN e inicie o quiz. Quando o avanço automático estiver desligado, use “Próxima questão” para controlar a partida.", target: "#session-list" },
    { title: "Turmas", text: "Cadastre as turmas que pertencem à sua conta. O código de acesso exibido pode ser compartilhado com os alunos para matrícula.", target: "#class-form" },
    { title: "Integridade", text: "Os alertas registram sinais do navegador durante atividades monitoradas. Eles não comprovam fraude isoladamente; revise o contexto antes de qualquer decisão.", target: "#integrity-events" }
  ];
  if (path.endsWith("/criar-quiz")) return [
    { title: "Escolha a turma", text: "Cadastre uma turma aqui se necessário; ela fica associada à sua conta e poderá ser escolhida ao criar quizzes e provas.", target: ".class-manager" },
    { title: "Configure o quiz", text: "Informe título, disciplina, curso e turma. Você pode ligar o avanço automático e definir o intervalo entre questões.", target: "#quiz-form" },
    { title: "Monte as questões", text: "Crie questões de múltipla escolha ou lacunas. Defina o tempo de cada pergunta e, se quiser, envie ou vincule uma imagem.", target: "#questions" },
    { title: "Monitoramento", text: "Os controles de integridade permitem registrar mudanças de aba e tentativas de copiar/colar. O botão direito pode ser bloqueado. São sinais para revisão do professor, não prova de fraude.", target: "#quiz-form" }
  ];
  if (path.endsWith("/criar-prova")) return [
    { title: "Turma e identificação", text: "Cadastre ou selecione sua turma, confira os dados da prova e informe título e data. O nome do professor pode ser editado.", target: ".class-manager" },
    { title: "Selecione as questões", text: "Escolha um quiz como base e marque quais questões entrarão na avaliação.", target: "#exam-questions" },
    { title: "Publicar ou exportar", text: "Publique para disponibilizar a prova aos alunos. O botão BAIXAR PDF gera uma cópia para impressão com os campos e questões selecionados.", target: "#download-pdf" },
    { title: "Monitoramento da prova", text: "As opções de integridade controlam o registro de sinais do navegador. A nota do aluno é calculada ao concluir a prova.", target: "#exam-form" }
  ];
  if (path.endsWith("/aulas-atividades")) return [
    { title: "Publique para uma turma", text: "Escolha uma turma, dê um título e adicione texto, link ou arquivo. Atividades podem apontar para uma prova existente ou criar um quiz ao vivo com PIN.", target: "#publication-form" },
    { title: "Códigos de acesso", text: "Compartilhe o código da turma com seus alunos. Eles usam esse código na área do aluno para se inscrever e acessar as publicações.", target: "#class-list" },
    { title: "Gerencie publicações", text: "Veja o que foi publicado e filtre por turma. Você pode retirar uma publicação e abrir os comentários para responder, reagir ou usar emojis.", target: "#teacher-publications" }
  ];
  if (path.endsWith("/bi")) return [
    { title: "Escolha um aluno", text: "Selecione um aluno para ver a evolução das notas de provas ao longo do tempo.", target: "#student-filter" },
    { title: "Gráficos de desempenho", text: "A taxa por questão destaca dificuldades; o gráfico por turma compara as médias e a linha mostra a evolução do aluno selecionado.", target: "#question-chart" },
    { title: "Acompanhamento", text: "Consulte as questões mais erradas e a lista de alunos com nota abaixo de cinco para orientar o acompanhamento pedagógico.", target: "#missed-list" }
  ];
  if (path.endsWith("/registros")) return [
    { title: "Consulte os resultados", text: "A tabela reúne provas e respostas dos quizzes dos seus alunos, com turma, atividade, nota, tempo e percentual de acertos.", target: "#records-body" },
    { title: "Filtre e exporte", text: "Escolha uma data para filtrar, use “Limpar filtros” para voltar à lista completa ou exporte o resultado atual em CSV.", target: "#date-filter" }
  ];
  if (path.endsWith("/minhas-provas")) return [
    { title: "Seu perfil", text: "Atualize seu nome, escolha um avatar e salve. O envio de foto depende da ativação do Firebase Storage.", target: ".profile-card" },
    { title: "Turmas e materiais", text: "Inscreva-se com o código do professor para ver aulas e atividades da turma, comentar, responder e reagir.", target: "#class-join-form" },
    { title: "Provas e troféus", text: "Confira atividades disponíveis, provas realizadas, resumo de notas e troféus conquistados.", target: "#student-trophies" },
    { title: "AuraMaster TI", text: "O ranking acumula pontos de quizzes concluídos por turma/curso e mostra medalhas digitais: Diamante, Ouro, Prata e Bronze.", target: ".aura-ranking-card" },
    { title: "Ranking de cada quiz", text: "Consulte sua colocação e a pontuação dos participantes em cada partida.", target: "#quiz-rankings" }
  ];
  if (path.endsWith("/join")) return [
    { title: "Entre na partida", text: "Digite o PIN de seis números informado pelo professor e escolha um apelido para aparecer no placar.", target: "#join-form" },
    { title: "Preferências", text: "O botão “Som” controla os efeitos sonoros. Eles começam desligados e só são ativados se você escolher.", target: ".sound-toggle" }
  ];
  if (path.endsWith("/jogar")) return [
    { title: "Responda no seu ritmo", text: "Acompanhe o tempo e selecione uma resposta. Em questões de lacuna, escolha uma opção para cada espaço e envie a resposta.", target: "#question-content" },
    { title: "Feedback e integridade", text: "Após responder, veja o resultado e os pontos. Se o professor ativou o monitoramento, mudanças de aba e tentativas de copiar/colar podem ser registradas para revisão.", target: "#game-feedback" }
  ];
  if (document.querySelector("#teacher-view") && !document.querySelector("#teacher-view").hidden) return [
    { title: "Seu painel rápido", text: "Crie um quiz rápido preenchendo o título e as perguntas. Cada linha deve conter o enunciado, quatro alternativas, o número da correta e o tempo, separados por |.", target: "#quiz-form" },
    { title: "Gerencie suas atividades", text: "Abra o Dashboard avançado para cadastrar turmas, filtrar quizzes, controlar sessões ao vivo e acompanhar alertas de integridade.", target: ".site-nav" },
    { title: "Entre em uma sala", text: "Use este botão para participar de um quiz com PIN, como um aluno.", target: "#show-join-teacher" }
  ];
  return [
    { title: "Bem-vindo ao Quizziolando", text: "Professores podem criar conta, preparar quizzes e provas e acompanhar as turmas. Alunos podem entrar com PIN ou abrir a área de aluno.", target: "#auth-view" },
    { title: "Acesso do professor", text: "Entre com e-mail e senha ou Google. Depois de entrar, use o painel para criar atividades e abrir uma sessão ao vivo.", target: "#auth-form" },
    { title: "Acesso do aluno", text: "Use os links da área do aluno para acompanhar provas, ranking, turmas, materiais e recompensas digitais.", target: ".student-entry" },
    { title: "Som e ajuda", text: "Os efeitos sonoros são opcionais. O botão “Tutorial” fica disponível para abrir este guia novamente.", target: ".sound-toggle" }
  ];
}

function createButton(text, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

export function setupTutorial() {
  if (!document.body || document.querySelector(".tutorial-launcher")) return;
  const launcher = createButton("Tutorial", "tutorial-launcher", () => openTutorial());
  launcher.setAttribute("aria-label", "Abrir tutorial desta página");
  document.body.append(launcher);

  const overlay = document.createElement("div");
  overlay.className = "tutorial-overlay";
  overlay.hidden = true;
  overlay.setAttribute("role", "presentation");
  const dialog = document.createElement("section");
  dialog.className = "tutorial-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "tutorial-title");
  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.id = "tutorial-title";
  const count = document.createElement("p");
  count.className = "tutorial-count";
  const closeButton = createButton("Fechar", "secondary tutorial-close", () => closeTutorial());
  header.append(title, closeButton);
  const text = document.createElement("p");
  text.className = "tutorial-text";
  const progress = document.createElement("div");
  progress.className = "tutorial-progress";
  const preferenceLabel = document.createElement("label");
  preferenceLabel.className = "tutorial-preference";
  const preference = document.createElement("input");
  preference.type = "checkbox";
  preferenceLabel.append(preference, document.createTextNode(" Mostrar automaticamente ao visitar novas áreas"));
  preference.addEventListener("change", () => saveAutoPreference(preference.checked));
  const controls = document.createElement("div");
  controls.className = "tutorial-controls";
  const skip = createButton("Pular", "secondary", () => closeTutorial());
  const previous = createButton("Anterior", "secondary", () => move(-1));
  const next = createButton("Próximo", "primary", () => move(1));
  controls.append(skip, previous, next);
  dialog.append(header, count, text, progress, preferenceLabel, controls);
  overlay.append(dialog);
  document.body.append(overlay);

  let steps = [];
  let index = 0;
  let highlighted;

  function render() {
    highlighted?.classList.remove("tutorial-highlight");
    const step = steps[index];
    title.textContent = step.title;
    count.textContent = index === 0 ? "Apresentação" : `Etapa ${index} de ${steps.length - 1}`;
    text.textContent = step.text;
    preference.checked = readAutoPreference();
    previous.hidden = index < 2;
    next.textContent = index === 0 ? "Começar tutorial" : index === steps.length - 1 ? "Concluir" : "Próximo";
    progress.replaceChildren(...steps.map((_, stepIndex) => {
      const marker = document.createElement("span");
      marker.className = stepIndex <= index ? "complete" : "";
      marker.setAttribute("aria-hidden", "true");
      return marker;
    }));
    highlighted = step.target ? document.querySelector(step.target) : null;
    if (highlighted && !highlighted.closest(".tutorial-dialog")) {
      highlighted.classList.add("tutorial-highlight");
      highlighted.scrollIntoView({ behavior: "smooth", block: "center" });
    } else highlighted = null;
  }

  function closeTutorial() {
    overlay.hidden = true;
    document.body.classList.remove("tutorial-open");
    highlighted?.classList.remove("tutorial-highlight");
    highlighted = null;
    try {
      sessionStorage.setItem(`${DISMISSED_PREFIX}${location.pathname}`, "true");
    } catch (error) {
      console.warn("Não foi possível registrar que o tutorial foi dispensado nesta sessão.", error);
    }
    launcher.focus();
  }

  function move(direction) {
    if (index === 0 && direction < 0) return;
    if (index + direction >= steps.length) {
      closeTutorial();
      return;
    }
    index = Math.max(0, index + direction);
    render();
  }

  function openTutorial() {
    steps = [
      {
        title: "Tutorial do Quizziolando",
        text: "Este guia explica as funções desta área. Você pode começar agora, pular e abrir pelo botão Tutorial quando quiser. Desmarque a opção abaixo para não abrir automaticamente em outras áreas.",
        target: null
      },
      ...pageSteps()
    ];
    index = 0;
    overlay.hidden = false;
    document.body.classList.add("tutorial-open");
    render();
    closeButton.focus();
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeTutorial();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTutorial();
    if (event.key === "ArrowRight") move(1);
    if (event.key === "ArrowLeft") move(-1);
  });

  try {
    const dismissed = sessionStorage.getItem(`${DISMISSED_PREFIX}${location.pathname}`) === "true";
    if (readAutoPreference() && !dismissed) openTutorial();
  } catch (error) {
    console.warn("Não foi possível ler o estado do tutorial nesta sessão.", error);
    if (readAutoPreference()) openTutorial();
  }
}

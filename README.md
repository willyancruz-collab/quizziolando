# QUIZZIOLANDO

Aplicação de quizzes ao vivo para escolas, feita com HTML, CSS e JavaScript sem framework. O Firebase oferece autenticação e sincronização em tempo real; o GitHub Pages publica a aplicação estática.

## Recursos já provisionados

- Projeto Firebase: `quizziolando-20261104-rio` (plano gratuito Spark; sem conta de faturamento vinculada).
- App Web Firebase já configurado em `site/firebase-config.js`.
- Cloud Firestore Standard em `southamerica-east1`, dentro da cota gratuita.
- Regras e índices do Firestore já publicados.
- Login por e-mail/senha e anônimo ativados. Google OAuth não foi ativado: requer escolher um e-mail de suporte público.
- Repositório público: [willyancruz-collab/quizziolando](https://github.com/willyancruz-collab/quizziolando).
- Domínio `willyancruz-collab.github.io` autorizado no Firebase Authentication.
- O código ainda precisa ser enviado ao GitHub; depois disso, o workflow publicará o site no GitHub Pages.

## Recursos

- Cadastro e login de professores por e-mail/senha, com código INEP de 8 dígitos.
- Dados de turmas, quizzes, provas e publicações separados pelo UID de cada professor autenticado.
- Criação de quizzes com quatro alternativas, tempo de 5 a 60 segundos e importação em linhas separadas por `|`.
- Sala de espera com PIN de seis dígitos e participantes sincronizados ao vivo.
- Entrada de alunos por PIN e apelido, usando autenticação anônima.
- Monitoramento opcional de mudança de aba, cópia/recorte/colagem e menu de contexto em quizzes/provas, com histórico em tempo real para o professor.
- Perfil de aluno com avatares e upload de foto para o Firebase Storage.
- Área do aluno com histórico de provas, rankings por partida, resumo de desempenho e troféus calculados pelas atividades concluídas.
- Aulas e atividades por turma, com códigos privados de ingresso, provas/quizzes existentes, comentários, respostas, reações e anexos com visualização no site.
- Controle master exclusivo para `willyancruz@prof.educacao.sp.gov.br` com e-mail verificado: lista de contas, ativação, desativação ou banimento no site, histórico de acessos e auditoria das ações.
- Presença aproximada de contas autenticadas com sinal nos últimos 5 minutos e histórico com retenção de 90 dias; não são coletados endereços IP. O painel remove registros expirados quando é aberto.
- Efeitos sonoros sintetizados pelo navegador, desativados por padrão e controlados pelo botão “Som”.
- Tutorial interativo por área, com opção para iniciar, pular, reabrir pelo botão fixo “Tutorial” e desativar a abertura automática.
- Ranking AuraMaster TI por curso/turma: soma os pontos de quizzes concluídos e concede medalhas digitais por posição (Diamante: 1º; Ouro: 2º–3º; Prata: 4º–10º; Bronze: demais participantes).
- Respostas, revelação do gabarito e placar em tempo real.
- Editor de quizzes com tempo por questão, avanço automático, lacunas, imagens no Firebase Storage e seleção de turma.
- Áreas de provas, PDF, registros exportáveis, BI e histórico de provas do aluno.
- Construtor de formulários de prova com múltipla escolha, caixas de seleção, respostas abertas, link/QR code, salvamento contínuo e respostas por aluno em tempo real; professores podem revisar respostas abertas e baixar ou imprimir cada entrega.
- Pontuação de resposta correta: `máximo(0, 100 - segundos decorridos)`.
- PWA instalável, com shell da aplicação em cache para abrir sem conexão. As funções Firebase precisam de internet.

## Configuração do Firebase

O projeto Firebase, o app Web e o banco já foram criados. Para republicar as regras ou índices:

```sh
firebase login
firebase deploy --only firestore:rules,firestore:indexes
```

Depois de inicializar o Firebase Storage no console, publique as regras dele separadamente:

```sh
firebase deploy --only storage
```

O cliente usa Firebase Web SDK modular v10 em `site/js/firebase-config.js`, que exporta Auth, Firestore e Storage. `site/firebase-config.js` mantém um reexport para compatibilidade com a aplicação existente. O bucket já está identificado pela configuração; para habilitar login Google, ative o provedor Google em **Authentication > Sign-in method**. Para upload, confirme que o Firebase Storage foi inicializado para o projeto antes de publicar `storage.rules`. Preferências não sensíveis, como desativar a abertura automática do tutorial, podem ser guardadas no `localStorage`; dados de atividade continuam no Firestore.

O Firebase Hosting está configurado em `firebase.json` para publicar `site` com URLs limpas (sem `.html`); os módulos reconhecem URLs limpas e caminhos terminados em `.html`. Publique por Hosting com `firebase deploy --only hosting`, ou mantenha o fluxo existente do GitHub Pages.

### Novas áreas

- Professor: `site/professor/dashboard.html`, `criar-quiz.html`, `criar-prova.html`, `aulas-atividades.html`, `bi.html` e `registros.html`.
- Aluno: `site/aluno/join.html`, `jogar.html` e `minhas-provas.html` (painel pessoal).
- Coleções adicionais: `users`, `questions`, `options`, `lacunas`, `turmas`, `classAccessCodes`, `matriculas`, `sessoesJogo`, `jogadores`, `rankingQuizzes`, `respostas` e `provas`. Publicações e comentários ficam em subcoleções de `turmas/{turmaId}`.
- Formulários publicados guardam o gabarito privado e as entregas em `provas/{provaId}/gabaritos` e `provas/{provaId}/respostasFormulario`; o professor acompanha e corrige pela página `site/professor/respostas-formulario.html`.
- Imagens de questões são carregadas em `questoes-imagens/{uid}/...`; o acesso é limitado pelas regras de Storage.
- Fotos de perfil são carregadas em `perfis-alunos/{uid}/avatar`; o upload requer que o Storage esteja inicializado. Os alertas do navegador são sinais para revisão humana e não comprovam fraude, nem impedem o uso de outro dispositivo ou navegador.
- A área do aluno usa autenticação anônima; o histórico fica associado ao UID anônimo do navegador e os rankings registram apelidos e pontuações das partidas.
- A contagem de presença representa UIDs autenticados recentemente, não pessoas únicas; uma pessoa pode usar mais de um dispositivo ou conta. As pontuações do ranking são calculadas no cliente e as medalhas são reconhecimento digital, não nota oficial nem prêmio físico.
- O Controle master bloqueia o acesso aos dados do site via regras e não desativa contas no Firebase Auth. O acesso master exige que o Firebase Auth marque o e-mail como verificado; a página inicial oferece o envio do link de verificação.
- As turmas existentes recebem um código de ingresso de 8 caracteres; anexos das aulas usam `aulas-atividades/{professorId}/{turmaId}/{publicacaoId}/...` no Storage. O professor precisa ativar o Firebase Storage no console do projeto antes de enviar arquivos.

## Executar localmente

Sirva a pasta `site` por HTTP (módulos Firebase e PWA não funcionam corretamente em `file://`). Com Python instalado:

```sh
python -m http.server 8000 --directory site
```

Abra `http://localhost:8000`. Também é possível usar a extensão Live Server do VS Code apontando para `site`.

## Publicar no GitHub Pages

1. O repositório público `willyancruz-collab/quizziolando` já foi criado.
2. Envie a branch `main` para o remoto configurado:

   ```sh
   git push -u origin main
   ```

3. No repositório, abra **Settings > Pages** e selecione **GitHub Actions** como origem de publicação, se necessário.
4. O push para `main` inicia o workflow **Deploy static app to GitHub Pages**; acompanhe a execução na aba **Actions**.
5. O domínio `willyancruz-collab.github.io` já está autorizado no Firebase Authentication.

O workflow `.github/workflows/pages.yml` publica somente a pasta `site`. Nenhum segredo do Firebase deve ser adicionado ao workflow ou ao repositório.

## Formato das perguntas

Cada pergunta ocupa uma linha, com sete campos separados por `|`:

```text
Quanto é 2 + 2?|3|4|5|6|2|20
```

Os campos são pergunta, quatro alternativas, número da alternativa correta (1–4) e tempo (5–60 segundos). Uma barra vertical não pode fazer parte do texto.

## Limites e segurança

As regras do Firestore separam perfis, quizzes, perguntas públicas e gabaritos privados. Estudantes só podem criar a própria resposta uma vez por pergunta; a resposta é bloqueada pelo Firestore depois do tempo configurado. O navegador do professor processa respostas e pontuação, então mantenha as credenciais de acesso à conta protegidas. Nunca coloque uma chave `service_account` ou credenciais administrativas no site.

A instalação PWA mantém os arquivos da interface disponíveis em cache; login, quizzes e salas ao vivo ainda exigem conexão e acesso ao Firebase.

### Custos

O projeto permanece no plano gratuito Spark, sem faturamento vinculado. GitHub Pages para repositório público não exige plano pago. O Firebase tem cotas gratuitas, não ilimitadas; não faça upgrade para Blaze nem vincule uma conta de faturamento. Se o uso ultrapassar as cotas do Spark, os recursos poderão parar de funcionar até o próximo período, em vez de gerar cobrança automática.

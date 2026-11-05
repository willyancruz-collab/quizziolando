# QUIZZIOLANDO

Aplicação de quizzes ao vivo para escolas, feita com HTML, CSS e JavaScript sem framework. O Firebase oferece autenticação e sincronização em tempo real; o GitHub Pages publica a aplicação estática.

## Recursos já provisionados

- Projeto Firebase: `quizziolando-20261104-rio` (plano gratuito Spark; sem conta de faturamento vinculada).
- App Web Firebase já configurado em `site/firebase-config.js`.
- Cloud Firestore Standard em `southamerica-east1`, dentro da cota gratuita.
- Regras e índices do Firestore já publicados.
- Login por e-mail/senha e anônimo ativados. Google OAuth não foi ativado: requer escolher um e-mail de suporte público.
- Nenhum repositório ou domínio GitHub Pages foi publicado ainda.

## Recursos

- Cadastro e login de professores por e-mail/senha, com código INEP de 8 dígitos.
- Criação de quizzes com quatro alternativas, tempo de 5 a 60 segundos e importação em linhas separadas por `|`.
- Sala de espera com PIN de seis dígitos e participantes sincronizados ao vivo.
- Entrada de alunos por PIN e apelido, usando autenticação anônima.
- Respostas, revelação do gabarito e placar em tempo real.
- Pontuação de resposta correta: `máximo(0, 100 - segundos decorridos)`.
- PWA instalável, com shell da aplicação em cache para abrir sem conexão. As funções Firebase precisam de internet.

## Configuração do Firebase

O projeto Firebase, o app Web e o banco já foram criados. Para republicar as regras ou índices:

```sh
firebase login
firebase deploy --only firestore:rules,firestore:indexes
```

## Executar localmente

Sirva a pasta `site` por HTTP (módulos Firebase e PWA não funcionam corretamente em `file://`). Com Python instalado:

```sh
python -m http.server 8000 --directory site
```

Abra `http://localhost:8000`. Também é possível usar a extensão Live Server do VS Code apontando para `site`.

## Publicar no GitHub Pages

1. Crie um repositório público `quizziolando` na conta/organização GitHub desejada.
2. Configure o remoto e envie a branch `main`:

   ```sh
   git remote add origin https://github.com/SEU_USUARIO_OU_ORG/quizziolando.git
   git push -u origin main
   ```

3. No repositório, abra **Settings > Pages** e selecione **GitHub Actions** como origem de publicação.
4. Faça um push para `main` ou execute manualmente o workflow **Deploy static app to GitHub Pages** na aba **Actions**.
5. Em Firebase **Authentication > Settings > Authorized domains**, adicione o domínio Pages (por exemplo, `seu-usuario.github.io`).

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

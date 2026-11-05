# QUIZZIOLANDO

Aplicação de quizzes ao vivo para escolas, feita com HTML, CSS e JavaScript sem framework. O Firebase oferece autenticação e sincronização em tempo real; o GitHub Pages publica a aplicação estática.

## Recursos

- Cadastro e login de professores por e-mail/senha ou Google, com código INEP de 8 dígitos.
- Criação de quizzes com quatro alternativas, tempo de 5 a 60 segundos e importação em linhas separadas por `|`.
- Sala de espera com PIN de seis dígitos e participantes sincronizados ao vivo.
- Entrada de alunos por PIN e apelido, usando autenticação anônima.
- Respostas, revelação do gabarito e placar em tempo real.
- Pontuação de resposta correta: `máximo(0, 100 - segundos decorridos)`.
- PWA instalável, com shell da aplicação em cache para abrir sem conexão. As funções Firebase precisam de internet.

## Configuração do Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/) e registre um app Web.
2. Copie a configuração do app Web para `site/firebase-config.js`. A configuração Firebase para web identifica o projeto, mas não é uma credencial de servidor.
3. Em **Authentication > Sign-in method**, habilite **E-mail/senha**, **Google** (opcional) e **Anônimo**.
4. Em **Authentication > Settings > Authorized domains**, adicione o domínio de publicação do GitHub Pages (por exemplo, `usuario.github.io`) e o domínio personalizado, se houver.
5. Crie o banco **Cloud Firestore** e publique as regras de `firestore.rules` e os índices de `firestore.indexes.json` com o Firebase CLI:

   ```sh
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules,firestore:indexes
   ```

## Executar localmente

Sirva a pasta `site` por HTTP (módulos Firebase e PWA não funcionam corretamente em `file://`). Com Python instalado:

```sh
python -m http.server 8000 --directory site
```

Abra `http://localhost:8000`. Também é possível usar a extensão Live Server do VS Code apontando para `site`.

## Publicar no GitHub Pages

1. Envie este projeto para um repositório GitHub na branch `main`.
2. No repositório, abra **Settings > Pages** e selecione **GitHub Actions** como origem de publicação.
3. Faça um push para `main` ou execute manualmente o workflow **Deploy static app to GitHub Pages** na aba **Actions**.
4. Copie o domínio publicado para a lista de domínios autorizados do Firebase Authentication.

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

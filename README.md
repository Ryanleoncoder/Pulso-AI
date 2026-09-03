# Pulso IA

Ferramenta de interação em tempo real criada para a atividade **[IA com propósito](https://github.com/Ryanleoncoder/ia-com-proposito)** — com participação pelo celular, apresentação em telão, controle do apresentador e registro dos resultados.

Quatro telas: participante (celular), apresentação (telão), controle do apresentador e resultados/evidências.

Stack: Vite + React + TypeScript + Supabase. Sem servidor próprio: o banco é a autorização, via Row Level Security.

---

## Sobre o nome

O nome **Pulso IA** pode enganar um pouco: este não é um sistema que usa inteligência artificial para analisar respostas ou tomar decisões.

O projeto nasceu como uma ferramenta de interação para a apresentação **[IA com propósito](https://github.com/Ryanleoncoder/ia-com-proposito)**, uma atividade sobre o uso de IA no trabalho, e foi desenvolvido com uma abordagem de desenvolvimento assistido por IA.

O "IA" no nome vem desse contexto de origem — não de uma dependência de modelos de inteligência artificial no funcionamento em tempo de execução do sistema.

Na prática, o Pulso coleta respostas anônimas, atualiza o telão em tempo real, gera nuvens de palavras, gráficos e registros da sessão para o apresentador.

---

## Estado atual

O backend usado na atividade acadêmica foi **suspenso após o encerramento da
sessão**. Este repositório não publica URL, UUID, chave ou credencial daquela
instância. Para executar o projeto, configure um projeto Supabase próprio pelas
instruções abaixo.

Cada deploy cria seus próprios valores. Ao rodar `npm run setup:supabase` (veja abaixo), o script imprime o código da sessão e os links das quatro telas. Os valores não ficam neste arquivo porque são específicos de cada instância e a senha do apresentador não deve entrar no histórico de git.

| Item | Valor |
|---|---|
| Projeto Supabase | *(o subdomínio da URL do seu projeto)* |
| Código da sessão | *(impresso pelo setup)* |
| Usuário do apresentador | `apresentador` |
| Senha | fora deste arquivo, de propósito (veja abaixo) |
| Sessão | *(UUID impresso pelo setup)* |

A senha não fica no repositório. Ela vale acesso total às telas de apresentador — ler todas as respostas, editar o roteiro, apagar — então não é coisa para histórico de git, que é permanente e público se o repositório for. Para trocar: Dashboard > Authentication > Users > `apresentador@pulso.local`.

Rotas locais (`npm run dev`):

```
Participante  http://localhost:5173/#/j/<CÓDIGO>
Controle      http://localhost:5173/#/c/<SESSION_ID>
Telão         http://localhost:5173/#/p/<SESSION_ID>
Resultados    http://localhost:5173/#/r/<SESSION_ID>
```

`npm run verificar -- suaSenha` roda 37 asserções contra o Supabase real: dois celulares anônimos entram, respondem, e cada regra de RLS é testada tanto pelo que deve permitir quanto pelo que deve barrar. Último resultado: 37 de 37.

Ele é **não destrutivo**: remove só os participantes que ele mesmo criou, e devolve roteiro e sessão ao estado exato de antes, inclusive se a sessão estiver no ar. Ainda assim, **não rode durante a apresentação**: ele abre e fecha perguntas, o que mexeria no telão na frente da sala.

---

## Duas coisas para fazer antes da reunião

### 1. Aumentar o limite de sign-in anônimo

**É o que mais provavelmente quebra ao vivo.**

O Supabase limita sign-ins anônimos **por IP, por hora**, e o padrão é **30**. Numa sala todo mundo sai pelo mesmo IP público do Wi-Fi. Com 30 pessoas, as últimas recebem `over_request_rate_limit` e não entram. Quem abrir em aba anônima consome outra cota.

Dashboard > Authentication > Rate Limits > **"Rate limit for anonymous users"**. Suba para algo folgado: 150 por hora para uma sala de 30.

A tela do participante já trata esse erro com mensagem clara e botão para tentar de novo, mas isso é consolo, não solução: quem foi barrado continua fora até a hora virar.

### 2. Não abrir o telão em `localhost`

O QR Code codifica o endereço da página em que o telão está aberto. Se for `localhost`, o QR aponta para `localhost` e **nenhum celular da sala consegue abrir** — `localhost` só existe dentro da sua máquina.

Abra o telão pelo endereço que o Vite imprime como **Network**, algo como `http://192.168.1.108:5173`. O telão avisa na tela se detectar `localhost`.

Se publicar o app em algum host, o problema desaparece: o QR passa a apontar para o domínio sozinho.

---

## Começar do zero em outro projeto

Dois caminhos. O primeiro é automático.

### A. Script

Crie `.env.local` na raiz (já está no `.gitignore`):

```
SUPABASE_ACCESS_TOKEN=sbp_...        # supabase.com/dashboard/account/tokens
SUPABASE_PROJECT_REF=xxxxxxxxxxxx    # o subdomínio da URL do projeto
PRESENTER_PASSWORD=                  # defina localmente, com 8 ou mais caracteres
PRESENTER_USER=apresentador          # opcional, este é o padrão
```

Depois:

```bash
npm install
npm run setup:supabase
npm run dev
```

O script aplica as migrações, liga o sign-in anônimo, cria a conta do apresentador, roda o seed e imprime o código da sessão com os links das quatro telas. Ele nunca grava a `service_role` em arquivo: busca em memória para criar o usuário e descarta.

### B. À mão pelo Dashboard

1. **Authentication > Sign In / Providers**: ligue **Anonymous sign-ins**.
2. **Authentication > Users**: crie a conta com o login exato `apresentador@pulso.local` (veja "O usuário do apresentador" abaixo).
3. **SQL Editor**: cole e rode os 9 arquivos de `supabase/migrations/` **em ordem numérica**, um por vez.
4. Rode `supabase/seed.sql`.
5. Crie `.env` copiando de `.env.example` e preencha URL, anon key e usuário.
6. `npm install && npm run dev`.

Código de acesso do seed: **PULSO1**. O QR Code é gerado sozinho na tela do telão enquanto nenhuma pergunta está aberta.

---

## Telas

| Rota | Tela | Quem entra |
|---|---|---|
| `/#/` | código de acesso | qualquer um |
| `/#/j/PULSO1` | participante | anônimo automático |
| `/#/admin` | lista de sessões | apresentador (senha) |
| `/#/c/:sessionId` | controle + editor do roteiro | apresentador |
| `/#/p/:sessionId` | telão | apresentador |
| `/#/r/:sessionId` | resultados e evidências | apresentador |

---

## O usuário do apresentador

Não existe e-mail neste projeto, nem do apresentador nem dos participantes.

O login é um **usuário**: `apresentador`, configurável em `VITE_PRESENTER_USER`. A tela pede **só a senha**.

Internamente o identificador vira `apresentador@pulso.local`. O Supabase Auth exige e-mail ou telefone, e `.local` é um domínio reservado que não existe na internet: esse endereço nunca recebe mensagem e não pertence a ninguém. É um identificador, não um contato.

A senha continua verificada com bcrypt pelo próprio Supabase Auth; não escrevemos criptografia nossa. Tabela própria com hash não é alternativa aqui: a RLS depende de `auth.uid()`, e emitir JWT exigiria o segredo do projeto no frontend, de volta ao problema da chave secreta.

---

## As duas chaves

A `anon` key vai no `.env` e é inlinada no bundle. Isso é por projeto: ela é pública por natureza, e quem protege os dados é a RLS.

A `service_role` **não entra em lugar nenhum do frontend**. Não é conservadorismo: qualquer `VITE_*` vira texto literal no `.js` que o navegador baixa, visível no F12, e a `service_role` ignora toda a RLS. Um participante com ela em mãos leria e apagaria as respostas de todos. O `vite.config.ts` derruba o build se encontrar uma chave secreta em variável `VITE_*`.

O apresentador tem poder de administrador **pela RLS** (`events.owner_id = auth.uid()`), usando a mesma anon key do participante. Mesma chave, permissões completamente diferentes.

---

## Modelo de identidade

| Papel | Autenticação | O que enxerga |
|---|---|---|
| Apresentador | usuário fixo + senha | tudo do próprio evento |
| Participante | `signInAnonymously()` | a pergunta ativa e suas alternativas |

O `auth.uid()` do usuário anônimo **é** o `anonymous_token`, o identificador salvo no navegador. Nada de nome, e-mail, matrícula ou IP é gravado.

A role `anon` (chave pública sem login) tem `REVOKE ALL` em todas as tabelas: sem sign-in anônimo, o cliente não fala com o banco.

---

## Regras que a RLS garante, não o frontend

- Participante **não lê `responses`**, nem a própria.
- Participante só grava resposta se: é participante da sessão, a sessão está `live`, a pergunta é a `active_question_id` e está `open`.
- Participante só vê a pergunta ativa ou perguntas já reveladas. Não dá para ler as próximas adiantado.
- Gabarito e explicação só aparecem depois de `results_visible = true`.
- Só o dono do evento altera `is_hidden`, e toda mudança gera linha em `moderation_actions` por trigger, sem confiar no cliente para registrar.
- Limites da nuvem de palavras, faixa da escala, alternativa inválida e máximo de seleções são validados **por trigger no banco**, não só no formulário.

---

## Quantas respostas cada pessoa dá

| Tipo | Por pessoa |
|---|---|
| nuvem de palavras | até `config.max_entries` entradas (padrão 3), sem repetir a mesma palavra |
| todos os outros | exatamente uma |

Nuvem aceitar várias entradas é o que faz a nuvem ficar rica numa sala pequena: 30 pessoas vezes 3 palavras dá material de sobra. Repetir a mesma palavra é barrado por pessoa, senão alguém sozinho infla um termo e a nuvem deixa de representar a sala.

Isso quebra o `UNIQUE (question_id, participant_id)` do plano original, porque a restrição precisa valer só para alguns tipos. Índice parcial não enxerga outra tabela, então `responses.question_type` é gravado pelo trigger e o índice único vira `where question_type <> 'word_cloud'`.

**O celular pergunta ao banco quantas já mandou** (`my_response_count`), em vez de guardar no `localStorage`. A RPC devolve só um número sobre o próprio participante, então não fere a regra de que ninguém lê resposta bruta. A versão com `localStorage` deu bug real: quando as respostas eram apagadas no servidor, o navegador continuava achando que tinha respondido e a pessoa ficava presa numa tela de "Pronto" enquanto a sala inteira seguia adiante.

---

## Três desvios do plano original

Todos por segurança:

1. **`question_answer_keys` é tabela separada:** Se `is_correct` ficasse em `question_options`, o participante, que precisa ler os rótulos para responder, leria também qual é a correta antes da revelação. A RLS dessa tabela só libera quando `results_visible = true`. A explicação da resposta mora aqui também.
2. **Descobrir sessão pelo código só via `rpc('join_session')`:** A política de `select` em `sessions` exige já ser participante ou dono. Sem isso, qualquer usuário anônimo listaria a tabela e varreria códigos de sessões ativas.
3. **`responses.bool_value` foi acrescentado:** O tipo `boolean` existia no plano sem coluna para guardar a resposta.

---

## Editar o roteiro ao vivo

Na tela de controle, **Editar roteiro** liga os controles de autoria: adicionar pergunta, editar, subir, descer e apagar. Serve para decidir na hora: "nuvem já foi, agora pergunta e resposta, agora encerramento".

Duas travas contra perda de evidência:
- **Apagar** é bloqueado se a pergunta já tem resposta.
- **Trocar o conjunto de alternativas** é bloqueado se já tem resposta, porque apagar uma alternativa apagaria em cascata os votos que apontam para ela. Enunciado, descrição e explicação seguem editáveis.

Reordenar exigiu tornar `UNIQUE (event_id, position)` **deferrable**: durante a troca as duas perguntas ocupam a mesma posição por um instante, e a restrição só é verificada no commit.

---

## Encerrar e reabrir

Encerrar fecha todas as perguntas, bloqueia novas respostas e zera a pergunta ativa. O telão passa a mostrar uma tela de fechamento com os números da sessão, e o celular agradece.

**Dá para reabrir** (`reopen_session`): a sessão volta para `waiting`, o telão exibe o QR Code de novo e o apresentador escolhe onde retomar. Nenhuma resposta é apagada, reabrir é retomar e não recomeçar. Sem isso, encerrar por engano no meio da reunião obrigaria a criar outra sessão, com outro código, e pedir para a sala inteira escanear o QR de novo.

---

## Dois bugs que só apareceram rodando de verdade

Ambos davam mensagens enganosas e valem registro, porque são armadilhas genéricas de Postgres com RLS:

1. **`INSERT ... RETURNING` também aplica a política de SELECT:** `submit_response` terminava com `returning id into v_response_id`. A linha era inserida, passava no `WITH CHECK`, e então era barrada ao ser devolvida, porque `responses_select` só libera para o dono da sessão. O erro dizia "new row violates row-level security policy", apontando para o INSERT, quando o problema era o RETURNING. Correção: o id é sorteado com `gen_random_uuid()` antes e enviado junto, sem pedir nada de volta. A regra "participante não lê resposta, nem a própria" continua intacta.
2. **Nomes de `returns table` viram variáveis PL/pgSQL:** `join_session` declara `returns table (session_id uuid, ...)`, e no `on conflict (session_id, ...)` o Postgres não sabia se `session_id` era a variável de saída ou a coluna: `column reference "session_id" is ambiguous`. Resolvido com `#variable_conflict use_column`.

---

## Realtime

Tudo na tela se atualiza sozinho, via Postgres Changes:

| Tela | Escuta |
|---|---|
| participante | `sessions` (pergunta ativa), `questions`, `question_options` |
| telão, controle | `responses`, `participants`, `sessions`, `questions` |
| lista de sessões | `sessions`, `participants`, `responses` |

`REPLICA IDENTITY FULL` nas tabelas publicadas, necessário para a RLS ser aplicada ao registro antigo em UPDATE e DELETE, como quando o apresentador oculta uma resposta.

A RLS vale no Realtime também: o celular do participante recebe mudança de `sessions` e `questions`, mas **não** recebe `responses`. Postgres Changes basta para uma sala; se virar milhares de pessoas, migrar para Broadcast.

As telas do apresentador recarregam o conjunto todo a cada mudança, em vez de aplicar deltas por evento. É deliberado: uma sala tem dezenas de respostas, não milhares, e delta é o tipo de coisa que dessincroniza no meio da reunião. Um debounce de 250 ms agrupa a rajada de eventos de uma mesma transação.

### Rede de segurança contra websocket morto

Realtime sozinho não basta em celular. A tela apaga, o Wi-Fi troca para 4G, o navegador congela a aba em segundo plano, e o websocket morre sem avisar. O participante perde o evento de troca de pergunta e fica parado na anterior.

Por isso toda tela também relê o estado direto do banco: ao voltar para a aba (`visibilitychange`), ao reconectar (`online`), quando o canal reporta `CHANNEL_ERROR` ou `TIMED_OUT`, e num intervalo curto (5 s no celular, 8 s nas telas do apresentador). A releitura só altera o estado quando algo mudou de fato, então não pisca a tela nem re-renderiza à toa.

---

## Nuvem de palavras

`normalize_answer()` no banco aplica, em ordem: minúsculas, remove acentos, remove pontuação, colapsa espaços duplicados. `Automação!`, `  automacao ` e `AUTOMAÇÃO` viram o mesmo termo `automacao`.

O layout (`src/lib/wordcloudLayout.ts`) é próprio, sem dependência: espiral com detecção de colisão, elipse 1.75 por 0.85 porque o telão é 16:9. As palavras entram da mais frequente para a menos frequente, então quem perde espaço é sempre a cauda. Se não couber, a fonte encolhe 22% e tenta de novo, até quatro vezes.

A função recebe a medição de texto por parâmetro justamente para ser testável fora do navegador.

Comparação abertura versus encerramento: as duas perguntas são `word_cloud`, uma com `phase = 'pre'` e outra `'post'`; a de encerramento tem `config.compare_with_position = 1`. O telão e a tela de resultados montam as duas lado a lado sozinhos, e a tela de resultados ainda lista os termos que só apareceram no fim.

---

## Cor nos gráficos

Paleta validada com o validador de paleta, todas as checagens PASS em claro e escuro:
- 2 séries categóricas (sim/não): `#2a78d6` e `#eb6834` no claro, `#3987e5` e `#d95926` no escuro
- rampa ordinal da escala 1 a 5: azul, degraus 250 a 650 no claro, 600 a 100 no escuro

Cor nunca carrega sentido sozinha: todo gráfico tem rótulo direto, a alternativa correta vem marcada com texto "resposta correta", e cada gráfico tem um "Ver como tabela". Na nuvem de palavras a frequência é o **tamanho**; a cor só dá hierarquia em três degraus legíveis do mesmo azul.

---

## Exportação

`v_export_responses` alimenta o CSV (separador `;` e BOM, que é o que o Excel em pt-BR abre certo). Traz `respondent_ref`: hash de 8 caracteres do identificador aleatório do navegador. Dá para ver que respostas vieram do mesmo aparelho, e nada além disso. Nenhuma coluna identifica pessoa.

A tela de resultados tem **Tela limpa**, que esconde botões para captura de tela.

Para gerar evidências em PNG sem alterar o banco, use a rota interna de captura
e o script com Playwright:

```bash
npx playwright install chromium
npm run exportar:png
npm run exportar:png -- --session <UUID> --theme dark
```

As imagens são gravadas em `exports/`, pasta ignorada pelo Git. A credencial do
apresentador deve estar em `PRESENTER_PASSWORD` no ambiente ou em `.env.local`;
ela nunca é aceita como argumento de linha de comando. O script consulta os
dados existentes e usa a tela `/export/:sessionId` com atualizações em tempo
real desativadas durante a captura.

---

## Estrutura do projeto

```
scripts/
  exportar-resultados-png.mjs  captura evidências PNG sem alterar o banco
  setup-supabase.mjs           configura o projeto pela Management API
  verificar.mjs                37 asserções contra o Supabase real
supabase/
  migrations/
    ..._120100_schema.sql      tipos, tabelas, índices
    ..._120200_functions.sql   helpers, normalização, triggers, RPCs
    ..._120300_views.sql       agregações e exportação
    ..._120400_rls.sql         Row Level Security
    ..._120500_realtime.sql    publicação Postgres Changes
    ..._120600_authoring.sql   edição do roteiro ao vivo
    ..._120700_hardening.sql   fecha o EXECUTE público das funções
    ..._120800_word_cloud_varias_entradas.sql
    ..._120900_reopen_session.sql
  seed.sql                     o evento e as 8 perguntas
src/
  lib/
    supabase.ts                cliente único, mensagens de erro
    router.tsx                 roteador de hash próprio
    sessionData.ts             carga + realtime das telas do apresentador
    wordcloudLayout.ts         layout da nuvem, puro e testável
    types.ts
  components/
    WordCloud.tsx  Charts.tsx  QuestionResult.tsx
    QrPanel.tsx    QuestionForm.tsx  PresenterGate.tsx
  screens/
    Home  Join  Present  Control  Results  ExportResults  Admin  Setup
```

---

## Sem react-router, de propósito

As duas advisories abertas do react-router 6 e 7 (open redirect por barra invertida em `<Link>` e `useNavigate`) atingem exatamente o único ponto onde este app navega com entrada do usuário: o campo de código. Com seis rotas estáticas, escrever `src/lib/router.tsx` custou 40 linhas, e a normalização de caminho só deixa passar caracteres seguros, então destino externo é impossível por construção.

Resultado atual: `npm audit` sem vulnerabilidades conhecidas.

---

## Fora de escopo, de propósito

Cadastro de participante, perfis, ranking, chat, IA analisando respostas, criação pública de eventos, app instalável, upload de arquivo, integração Teams.

---

## Licença

Código e documentação publicados para consulta e estudo, conforme os termos de
[LICENSE.md](LICENSE.md). O repositório é público, mas não é licenciado como
software open source.

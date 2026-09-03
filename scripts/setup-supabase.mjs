/**
 * Configura o projeto Supabase do zero: migrações, sign-in anônimo, usuário do
 * apresentador e seed. Usa só o fetch nativo do Node — nenhuma dependência.
 *
 * Antes de rodar, crie `.env.local` (já está no .gitignore) com:
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_...        <- supabase.com/dashboard/account/tokens
 *   SUPABASE_PROJECT_REF=xxxxxxxxxxxx    <- o subdomínio da URL do projeto
 *   PRESENTER_PASSWORD=umaSenhaQualquer
 *   PRESENTER_USER=apresentador          <- opcional, este é o padrão
 *
 * Nenhum e-mail pessoal é usado. O Supabase Auth exige e-mail ou telefone como
 * identificador, então o login vira `<usuario>@pulso.local` — endereço sintético
 * no domínio reservado .local, que nunca recebe mensagem.
 *
 * O access token e a service_role key ficam só em memória e no seu .env.local.
 * Nada disso encosta no bundle do frontend.
 *
 * Rode com:  npm run setup:supabase
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.supabase.com/v1';

/* ------------------------------------------------------------------ */
/* Configuração                                                        */
/* ------------------------------------------------------------------ */

function lerArquivoEnv(caminho) {
  if (!existsSync(caminho)) return {};
  const out = {};
  for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']/, '').replace(/["']$/, '');
  }
  return out;
}

const cfg = { ...lerArquivoEnv(join(raiz, '.env.local')), ...process.env };

const TOKEN = cfg.SUPABASE_ACCESS_TOKEN;
const REF = cfg.SUPABASE_PROJECT_REF;
const SENHA = cfg.PRESENTER_PASSWORD;

// Usuário, não e-mail. `.local` é domínio reservado — nunca sai da máquina.
const USUARIO = (cfg.PRESENTER_USER || 'apresentador')
  .toLowerCase()
  .replace(/[^a-z0-9._-]/g, '');
const LOGIN = `${USUARIO}@pulso.local`;

const faltando = [
  ['SUPABASE_ACCESS_TOKEN', TOKEN],
  ['SUPABASE_PROJECT_REF', REF],
  ['PRESENTER_PASSWORD', SENHA],
].filter(([, v]) => !v);

if (faltando.length) {
  console.error('\nFaltam variáveis em .env.local:\n');
  for (const [nome] of faltando) console.error('  ' + nome);
  console.error('\nVeja o comentário no topo de scripts/setup-supabase.mjs.\n');
  process.exit(1);
}

if (SENHA.length < 8) {
  console.error('\nPRESENTER_PASSWORD precisa de pelo menos 8 caracteres.\n');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const passo = (n, texto) => console.log(`\n[${n}] ${texto}`);
const ok = (texto) => console.log('    ok   ' + texto);
const aviso = (texto) => console.log('    !    ' + texto);

async function gerencia(caminho, opcoes = {}) {
  const resposta = await fetch(API + caminho, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(opcoes.headers ?? {}),
    },
  });

  const texto = await resposta.text();
  let corpo = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }

  if (!resposta.ok) {
    const detalhe = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    throw new Error(`${opcoes.method ?? 'GET'} ${caminho} -> HTTP ${resposta.status}: ${detalhe}`);
  }
  return corpo;
}

const rodarSql = (sql) =>
  gerencia(`/projects/${REF}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query: sql }),
  });

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

async function principal() {
  console.log(`\nConfigurando o projeto ${REF}\n${'='.repeat(46)}`);

  // ---------------------------------------------------------------- 1
  passo(1, 'Verificando acesso ao projeto');
  const projeto = await gerencia(`/projects/${REF}`);
  ok(`${projeto.name} (região ${projeto.region})`);

  // ---------------------------------------------------------------- 2
  passo(2, 'Aplicando as migrações');
  const pastaMigracoes = join(raiz, 'supabase', 'migrations');
  const arquivos = readdirSync(pastaMigracoes)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (arquivos.length === 0) throw new Error('Nenhuma migração encontrada.');

  for (const arquivo of arquivos) {
    const sql = readFileSync(join(pastaMigracoes, arquivo), 'utf8');
    await rodarSql(sql);
    ok(arquivo);
  }

  // ---------------------------------------------------------------- 3
  passo(3, 'Habilitando sign-in anônimo');
  try {
    await gerencia(`/projects/${REF}/config/auth`, {
      method: 'PATCH',
      body: JSON.stringify({
        external_anonymous_users_enabled: true,
        // Sem confirmação por e-mail: é um app de um dia, e o apresentador é
        // criado por aqui mesmo. O participante nunca informa e-mail.
        mailer_autoconfirm: true,
      }),
    });
    ok('anonymous sign-ins ligado');
  } catch (e) {
    aviso('não deu para ajustar pela API: ' + e.message);
    aviso('ligue à mão em Authentication > Sign In / Providers > Anonymous');
  }

  // ---------------------------------------------------------------- 4
  passo(4, 'Buscando as chaves do projeto');
  const chaves = await gerencia(`/projects/${REF}/api-keys?reveal=true`);
  const lista = Array.isArray(chaves) ? chaves : [];

  const achar = (...nomes) =>
    lista.find((k) => nomes.includes(k.name) || nomes.includes(k.type))?.api_key;

  const anonKey = achar('anon', 'publishable', 'legacy_anon');
  const serviceKey = achar('service_role', 'secret', 'legacy_service_role');

  if (!anonKey) throw new Error('Não achei a anon/publishable key na resposta da API.');
  ok('anon key obtida');
  if (serviceKey) ok('service_role obtida (fica só em memória, nunca em arquivo)');

  // ---------------------------------------------------------------- 5
  passo(5, `Criando o usuário do apresentador (${USUARIO})`);
  const urlProjeto = `https://${REF}.supabase.co`;

  if (!serviceKey) {
    aviso(`sem service_role, crie à mão em Authentication > Users com o login ${LOGIN}`);
  } else {
    const resposta = await fetch(`${urlProjeto}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: LOGIN, password: SENHA, email_confirm: true }),
    });

    if (resposta.ok) {
      ok(`${LOGIN} criado`);
    } else {
      const texto = await resposta.text();
      if (/already|exists|registered/i.test(texto)) {
        aviso(`${LOGIN} já existia — mantendo a senha atual`);
      } else {
        aviso(`falhou (HTTP ${resposta.status}): ${texto.slice(0, 200)}`);
      }
    }
  }

  // ---------------------------------------------------------------- 6
  passo(6, 'Rodando o seed (evento, sessão e perguntas)');
  let seed = readFileSync(join(raiz, 'supabase', 'seed.sql'), 'utf8');
  // Alinha o login do seed com o apresentador que acabamos de criar.
  seed = seed.replace(
    /v_owner_login\s+text\s*:=\s*'[^']*'/,
    `v_owner_login text := '${LOGIN.replace(/'/g, "''")}'`,
  );

  try {
    await rodarSql(seed);
    ok('evento, sessão e 8 perguntas inseridos');
  } catch (e) {
    if (/já tem respostas/i.test(e.message)) {
      aviso('o evento já existe e tem respostas — seed preservado, nada foi apagado');
    } else {
      throw e;
    }
  }

  // ---------------------------------------------------------------- 7
  passo(7, 'Conferindo o resultado');
  const conferencia = await rodarSql(`
    select
      (select count(*) from public.events)     as eventos,
      (select count(*) from public.sessions)   as sessoes,
      (select count(*) from public.questions)  as perguntas,
      (select access_code from public.sessions order by created_at desc limit 1) as codigo,
      (select id::text from public.sessions order by created_at desc limit 1)    as session_id
  `);
  const r = Array.isArray(conferencia) ? conferencia[0] : conferencia;
  ok(`${r.eventos} evento(s), ${r.sessoes} sessão(ões), ${r.perguntas} pergunta(s)`);

  // ---------------------------------------------------------------- 8
  const caminhoEnv = join(raiz, '.env');
  const conteudoEnv =
    `VITE_SUPABASE_URL=${urlProjeto}\n` +
    `VITE_SUPABASE_ANON_KEY=${anonKey}\n` +
    `VITE_PRESENTER_USER=${USUARIO}\n`;

  if (!existsSync(caminhoEnv)) {
    writeFileSync(caminhoEnv, conteudoEnv, 'utf8');
    passo(8, '.env criado');
  } else {
    passo(8, '.env já existe — confira se bate com isto:');
    console.log('\n' + conteudoEnv);
  }

  console.log(`
${'='.repeat(46)}
PRONTO

  Código da sessão : ${r.codigo}
  Controle         : http://localhost:5173/#/c/${r.session_id}
  Telão            : http://localhost:5173/#/p/${r.session_id}
  Resultados       : http://localhost:5173/#/r/${r.session_id}
  Participante     : http://localhost:5173/#/j/${r.codigo}

  Login do apresentador: usuário "${USUARIO}", só a senha.

  npm run dev
`);
}

principal().catch((e) => {
  console.error('\nFALHOU: ' + e.message + '\n');
  process.exit(1);
});

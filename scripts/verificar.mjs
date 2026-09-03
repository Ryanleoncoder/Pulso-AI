/**
 * Teste de ponta a ponta contra o Supabase real, usando só a anon key —
 * exatamente o que o navegador faz.
 *
 * Simula dois celulares entrando na sessão, respondendo, e confere que a RLS
 * barra o que tem de barrar. No fim apaga tudo que criou e devolve a sessão ao
 * estado inicial, para a reunião de verdade começar limpa.
 *
 *   npm run verificar
 *
 * Lê VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY do .env, e a senha do
 * apresentador de PRESENTER_PASSWORD (.env.local) ou do primeiro argumento.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function lerEnv(arquivo) {
  const caminho = join(raiz, arquivo);
  if (!existsSync(caminho)) return {};
  const out = {};
  for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']/, '').replace(/["']$/, '');
  }
  return out;
}

const cfg = { ...lerEnv('.env'), ...lerEnv('.env.local'), ...process.env };

const URL = cfg.VITE_SUPABASE_URL;
const KEY = cfg.VITE_SUPABASE_ANON_KEY;
const USUARIO = cfg.VITE_PRESENTER_USER || 'apresentador';
const SENHA = process.argv[2] || cfg.PRESENTER_PASSWORD;

if (!URL || !KEY) {
  console.error('Faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY no .env');
  process.exit(1);
}
if (!SENHA) {
  console.error('Informe a senha: npm run verificar -- suaSenha');
  process.exit(1);
}

/* ------------------------------------------------------------------ */

let falhas = 0;
let passes = 0;

function checar(nome, ok, detalhe = '') {
  if (ok) {
    passes++;
    console.log(`  PASS  ${nome}${detalhe ? '  (' + detalhe + ')' : ''}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? '  -> ' + detalhe : ''}`);
  }
}

const secao = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

async function api(caminho, { token, method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: KEY,
    Authorization: `Bearer ${token || KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;

  const r = await fetch(URL + caminho, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    j = t;
  }
  return { status: r.status, ok: r.ok, body: j };
}

const rpc = (nome, args, token) =>
  api(`/rest/v1/rpc/${nome}`, { token, method: 'POST', body: args });

/* ------------------------------------------------------------------ */

async function principal() {
  console.log(`\nVerificando ${URL}\n${'='.repeat(52)}`);

  // ---------------------------------------------------------------- auth
  secao('1. Autenticação');

  const login = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: `${USUARIO}@pulso.local`, password: SENHA },
  });
  checar('apresentador entra com usuário e senha', login.ok, JSON.stringify(login.body).slice(0, 120));
  if (!login.ok) {
    console.log('\nSem login do apresentador não dá para continuar.\n');
    process.exit(1);
  }
  const apres = login.body.access_token;

  const anons = [];
  for (const rotulo of ['celular A', 'celular B']) {
    const r = await api('/auth/v1/signup', { method: 'POST', body: {} });
    if (!r.ok) {
      checar(`${rotulo} entra anonimamente`, false, JSON.stringify(r.body).slice(0, 160));
      console.log(
        '\n>>> Ligue "Anonymous Sign-Ins" em Authentication > Sign In / Providers e rode de novo.\n',
      );
      process.exit(1);
    }
    checar(`${rotulo} entra anonimamente`, true);
    anons.push(r.body.access_token);
  }
  const [celA, celB] = anons;

  // ------------------------------------------------------------- sessão
  secao('2. Entrar na sessão pelo código');

  const overview = await api('/rest/v1/v_session_overview?select=*', { token: apres });
  const sessao = overview.body?.[0];
  checar('apresentador enxerga a sessão', Boolean(sessao));
  if (!sessao) process.exit(1);

  const perguntas = (
    await api(
      `/rest/v1/questions?select=*&event_id=eq.${sessao.event_id}&order=position.asc`,
      { token: apres },
    )
  ).body;
  const nuvem = perguntas.find((q) => q.type === 'word_cloud' && q.phase === 'pre');
  const escolha = perguntas.find((q) => q.type === 'multiple_choice');

  // Sem número fixo: o roteiro cresce durante a preparação, e "são exatamente N
  // perguntas" quebraria a cada pergunta nova sem apontar defeito nenhum. O que
  // importa é o apresentador enxergar o roteiro e ele ter os tipos que o teste
  // exercita.
  checar(
    'apresentador lê o roteiro completo',
    perguntas.length > 0 && Boolean(nuvem) && Boolean(escolha),
    `${perguntas.length} perguntas`,
  );

  const posicoes = perguntas.map((q) => q.position);
  checar(
    'posições são únicas e sequenciais',
    new Set(posicoes).size === posicoes.length &&
      posicoes.every((p, i) => p === i + 1),
    posicoes.join(','),
  );

  // Estado exato de antes, para devolver tudo como estava no fim. O teste pode
  // rodar com a sessão no ar e com gente respondendo — nada aqui pode alterar
  // o roteiro nem apagar resposta de quem não é do teste.
  const estadoInicial = {
    status: sessao.status,
    active_question_id: sessao.active_question_id,
    started_at: sessao.started_at,
    finished_at: sessao.finished_at,
    perguntas: perguntas.map((q) => ({
      id: q.id,
      status: q.status,
      results_visible: q.results_visible,
    })),
  };

  if (sessao.status === 'finished') {
    console.log(
      '\n  A sessão está ENCERRADA, então ninguém consegue entrar e o teste não roda.\n' +
        '  Reabra em Controle > Reabrir sessão, ou chame rpc reopen_session.\n',
    );
    process.exit(1);
  }

  if (sessao.answers > 0) {
    console.log(
      `\n  ATENÇÃO: esta sessão já tem ${sessao.answers} resposta(s) de verdade.\n` +
        '  O teste não vai apagá-las — só remove os participantes que ele mesmo criar.\n',
    );
  }

  // Só os participantes criados aqui são removidos no fim.
  const participantesDoTeste = [];
  const entradas = [];
  for (const [rotulo, tok] of [['celular A', celA], ['celular B', celB]]) {
    const r = await rpc('join_session', { p_access_code: sessao.access_code }, tok);
    const linha = Array.isArray(r.body) ? r.body[0] : r.body;
    checar(`${rotulo} entra com o código ${sessao.access_code}`, Boolean(linha?.participant_id));
    if (linha?.participant_id) participantesDoTeste.push(linha.participant_id);
    entradas.push(linha);
  }

  const codigoErrado = await rpc('join_session', { p_access_code: 'XXXXXX' }, celA);
  checar('código inválido é recusado', !codigoErrado.ok);

  // -------------------------------------------------------- nuvem de palavras
  secao('3. Nuvem de palavras');

  // Fecha explicitamente antes de testar o bloqueio. A sessão pode chegar aqui
  // com esta mesma pergunta já aberta de um uso anterior, e aí o teste estaria
  // apenas confirmando a própria suposição.
  await rpc('close_question', { p_question_id: nuvem.id }, apres);

  const antesDeAbrir = await rpc(
    'submit_response',
    { p_session_id: sessao.session_id, p_question_id: nuvem.id, p_answer_text: 'cedo demais' },
    celA,
  );
  checar('responder com a pergunta fechada é bloqueado pela RLS', !antesDeAbrir.ok);

  await rpc('open_question', { p_session_id: sessao.session_id, p_question_id: nuvem.id }, apres);
  const vista = await api(`/rest/v1/questions?select=id,prompt,status&id=eq.${nuvem.id}`, {
    token: celA,
  });
  checar('participante passa a enxergar a pergunta ativa', vista.body?.length === 1);

  const r1 = await rpc(
    'submit_response',
    { p_session_id: sessao.session_id, p_question_id: nuvem.id, p_answer_text: 'Automação!' },
    celA,
  );
  checar('celular A responde "Automação!"', r1.ok, JSON.stringify(r1.body).slice(0, 120));

  const r2 = await rpc(
    'submit_response',
    { p_session_id: sessao.session_id, p_question_id: nuvem.id, p_answer_text: '  automacao  ' },
    celB,
  );
  checar('celular B responde "  automacao  "', r2.ok, JSON.stringify(r2.body).slice(0, 120));

  // Nuvem de palavras aceita várias entradas por pessoa (max_entries, padrão 3).
  const segunda = await rpc(
    'submit_response',
    { p_session_id: sessao.session_id, p_question_id: nuvem.id, p_answer_text: 'agilidade' },
    celA,
  );
  checar('celular A manda uma segunda palavra', segunda.ok, JSON.stringify(segunda.body).slice(0, 120));

  const repetida = await rpc(
    'submit_response',
    { p_session_id: sessao.session_id, p_question_id: nuvem.id, p_answer_text: 'AGILIDADE!' },
    celA,
  );
  checar('a mesma palavra repetida pela mesma pessoa é recusada', !repetida.ok);

  const terceira = await rpc(
    'submit_response',
    { p_session_id: sessao.session_id, p_question_id: nuvem.id, p_answer_text: 'futuro' },
    celA,
  );
  checar('celular A chega na terceira palavra', terceira.ok);

  const quarta = await rpc(
    'submit_response',
    { p_session_id: sessao.session_id, p_question_id: nuvem.id, p_answer_text: 'excedente' },
    celA,
  );
  checar('a quarta palavra estoura o limite e é recusada', !quarta.ok);

  const longa = await rpc(
    'submit_response',
    {
      p_session_id: sessao.session_id,
      p_question_id: nuvem.id,
      p_answer_text: 'uma frase bem longa com muitas palavras',
    },
    celB,
  );
  checar('mais de 3 palavras é recusado pelo trigger', !longa.ok);

  const termos = (
    await api(`/rest/v1/v_word_cloud?select=*&question_id=eq.${nuvem.id}`, { token: apres })
  ).body;
  const automacao = termos.find((t) => t.term === 'automacao');
  checar(
    'normalização junta "Automação!" e "  automacao  " no mesmo termo',
    automacao?.weight >= 2,
    termos.map((t) => `${t.term}:${t.weight}`).join(' '),
  );
  checar(
    'as palavras extras do celular A entraram na nuvem',
    termos.some((t) => t.term === 'agilidade') && termos.some((t) => t.term === 'futuro'),
    termos.map((t) => `${t.term}:${t.weight}`).join(' '),
  );

  // ------------------------------------------------------------- escolha
  secao('4. Múltipla escolha e limite de seleções');

  await rpc('open_question', { p_session_id: sessao.session_id, p_question_id: escolha.id }, apres);
  const alternativas = (
    await api(
      `/rest/v1/question_options?select=id,label&question_id=eq.${escolha.id}&order=position.asc`,
      { token: celA },
    )
  ).body;
  checar('participante lê as alternativas', alternativas.length === 6, `${alternativas.length}`);
  if (alternativas.length < 2) {
    console.log('\n  Sem alternativas visíveis não dá para continuar.\n');
    process.exit(1);
  }

  // Contagem de antes: pode haver voto de gente de verdade nesta sessão.
  const votosAntes = (
    await api(`/rest/v1/v_option_results?select=votes&question_id=eq.${escolha.id}`, {
      token: apres,
    })
  ).body.reduce((s, v) => s + v.votes, 0);

  const duas = await rpc(
    'submit_response',
    {
      p_session_id: sessao.session_id,
      p_question_id: escolha.id,
      p_option_ids: [alternativas[0].id, alternativas[1].id],
    },
    celA,
  );
  checar('celular A marca 2 alternativas (limite = 2)', duas.ok, JSON.stringify(duas.body).slice(0, 120));

  const tres = await rpc(
    'submit_response',
    {
      p_session_id: sessao.session_id,
      p_question_id: escolha.id,
      p_option_ids: [alternativas[0].id, alternativas[1].id, alternativas[2].id],
    },
    celB,
  );
  checar('3 alternativas é recusado pelo trigger', !tres.ok);

  const votos = (
    await api(`/rest/v1/v_option_results?select=*&question_id=eq.${escolha.id}`, { token: apres })
  ).body;
  const total = votos.reduce((s, v) => s + v.votes, 0);
  checar(
    'view de votos inclui alternativas com zero e contou as 2 marcações',
    votos.length === 6 && total - votosAntes === 2,
    `antes=${votosAntes} depois=${total}`,
  );

  // --------------------------------------------------------------- RLS
  secao('5. O que a RLS tem de barrar');

  const lerRespostas = await api('/rest/v1/responses?select=*', { token: celA });
  checar(
    'participante NÃO lê responses (nem a própria)',
    Array.isArray(lerRespostas.body) && lerRespostas.body.length === 0,
    JSON.stringify(lerRespostas.body).slice(0, 100),
  );

  const varrerSessoes = await api('/rest/v1/sessions?select=access_code', { token: celA });
  const soAMinha =
    Array.isArray(varrerSessoes.body) &&
    varrerSessoes.body.every((s) => s.access_code === sessao.access_code);
  checar('participante não varre códigos de outras sessões', soAMinha);

  // Gabarito: escondido antes da revelação, visível depois. Testa os dois lados
  // numa pergunta específica — varrer a tabela inteira daria falso negativo se o
  // apresentador já tiver revelado alguma outra.
  const comGabarito = perguntas.find((q) => q.type === 'boolean');

  await rpc('set_results_visible', { p_question_id: comGabarito.id, p_visible: false }, apres);
  await rpc('open_question', { p_session_id: sessao.session_id, p_question_id: comGabarito.id }, apres);

  const antesDaRevelacao = await api(
    `/rest/v1/question_answer_keys?select=*&question_id=eq.${comGabarito.id}`,
    { token: celA },
  );
  checar(
    'gabarito escondido enquanto o resultado não foi revelado',
    Array.isArray(antesDaRevelacao.body) && antesDaRevelacao.body.length === 0,
    JSON.stringify(antesDaRevelacao.body).slice(0, 100),
  );

  await rpc('set_results_visible', { p_question_id: comGabarito.id, p_visible: true }, apres);

  const depoisDaRevelacao = await api(
    `/rest/v1/question_answer_keys?select=*&question_id=eq.${comGabarito.id}`,
    { token: celA },
  );
  checar(
    'gabarito e explicação aparecem depois da revelação',
    depoisDaRevelacao.body?.length === 1 && Boolean(depoisDaRevelacao.body[0].explanation),
    `${depoisDaRevelacao.body?.length ?? 0} linha(s)`,
  );

  const semLogin = await api('/rest/v1/questions?select=*');
  checar(
    'a anon key sem login não lê nada',
    !semLogin.ok || (Array.isArray(semLogin.body) && semLogin.body.length === 0),
    `HTTP ${semLogin.status}`,
  );

  const tentaAbrir = await rpc(
    'open_question',
    { p_session_id: sessao.session_id, p_question_id: nuvem.id },
    celA,
  );
  checar('participante não abre pergunta', !tentaAbrir.ok);

  const tentaOcultar = await rpc(
    'set_response_hidden',
    { p_response_id: r1.body, p_hidden: true },
    celA,
  );
  checar('participante não oculta resposta', !tentaOcultar.ok);

  // -------------------------------------------------------- moderação
  secao('6. Moderação e auditoria');

  const ocultar = await rpc(
    'set_response_hidden',
    { p_response_id: r1.body, p_hidden: true, p_reason: 'teste automatizado' },
    apres,
  );
  checar('apresentador oculta resposta', ocultar.ok);

  const depois = (
    await api(`/rest/v1/v_word_cloud?select=*&question_id=eq.${nuvem.id}`, { token: apres })
  ).body;
  checar(
    'resposta oculta sai da nuvem',
    depois.find((t) => t.term === 'automacao')?.weight === 1,
    depois.map((t) => `${t.term}:${t.weight}`).join(' '),
  );

  // Procura o registro desta ocultação, não o total: a sessão pode ter
  // moderações antigas de outra rodada.
  const trilha = (
    await api(`/rest/v1/moderation_actions?select=*&response_id=eq.${r1.body}`, { token: apres })
  ).body;
  checar(
    'ocultação virou registro em moderation_actions',
    Array.isArray(trilha) &&
      trilha.some((m) => m.action === 'hide' && m.reason === 'teste automatizado'),
    JSON.stringify(trilha).slice(0, 140),
  );

  // -------------------------------------------------------- exportação
  secao('7. Exportação');

  const exportar = (await api('/rest/v1/v_export_responses?select=*', { token: apres })).body;
  const semIdentificacao = exportar.every(
    (l) => !('participant_id' in l) && !('anonymous_token' in l),
  );
  checar('CSV não traz identificação do participante', semIdentificacao);
  checar('CSV traz pseudônimo estável', exportar.every((l) => l.respondent_ref?.length === 8));

  // ---------------------------------------------------------- limpeza
  secao('8. Desfazendo exatamente o que o teste criou');

  // Só os participantes deste teste. As respostas deles somem em cascata; as de
  // participantes reais ficam intactas. Já apaguei dados de verdade uma vez por
  // apagar por sessão em vez de por participante — não de novo.
  for (const pid of participantesDoTeste) {
    await api(`/rest/v1/participants?id=eq.${pid}`, { token: apres, method: 'DELETE' });
  }

  // Roteiro e sessão voltam ao estado exato de antes, não a um estado "limpo"
  // inventado — a sessão pode estar no ar.
  for (const q of estadoInicial.perguntas) {
    await api(`/rest/v1/questions?id=eq.${q.id}`, {
      token: apres,
      method: 'PATCH',
      body: { status: q.status, results_visible: q.results_visible },
    });
  }
  await api(`/rest/v1/sessions?id=eq.${sessao.session_id}`, {
    token: apres,
    method: 'PATCH',
    body: {
      status: estadoInicial.status,
      active_question_id: estadoInicial.active_question_id,
      started_at: estadoInicial.started_at,
      finished_at: estadoInicial.finished_at,
    },
  });

  const final = (
    await api(`/rest/v1/v_session_overview?select=*&session_id=eq.${sessao.session_id}`, {
      token: apres,
    })
  ).body[0];

  checar(
    'sessão devolvida ao estado de antes',
    final.status === estadoInicial.status &&
      final.active_question_id === estadoInicial.active_question_id,
    `status=${final.status} pergunta_ativa=${final.active_question_id}`,
  );
  checar(
    'respostas de participantes reais preservadas',
    final.answers === sessao.answers,
    `antes=${sessao.answers} depois=${final.answers}`,
  );

  console.log(`\n${'='.repeat(52)}`);
  console.log(`${passes} passaram, ${falhas} falharam\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

principal().catch((e) => {
  console.error('\nERRO: ' + e.stack + '\n');
  process.exit(1);
});

#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { createServer, loadEnv } from 'vite';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ajuda() {
  console.log(`
Exporta os resultados do Pulso para PNG, sem alterar o banco.

Uso:
  npm run exportar:png
  npm run exportar:png -- --session <uuid>
  npm run exportar:png -- --theme dark
  npm run exportar:png -- --duration-minutes 86
  npm run exportar:png -- --output <pasta> --width 1920 --height 1080

Opções:
  -s, --session <uuid>  Exporta só esta sessão (pode repetir)
  -o, --output <pasta> Pasta de saída; o padrão cria exports/resultados-<data>
      --width <px>      Largura de cada PNG (padrão: 1920)
      --height <px>     Altura de cada PNG (padrão: 1080)
      --theme <tema>    dark ou light (padrão: dark)
      --duration-minutes <n>
                        Substitui a duração de uma única sessão só no resumo
      --headed          Mostra o navegador enquanto captura
  -h, --help            Mostra esta ajuda

Credencial:
  Defina PRESENTER_PASSWORD no ambiente ou em .env.local. Por compatibilidade,
  o script também reconhece as variáveis locais senha2 e senha. A credencial não é aceita
  como argumento para não ficar salva no histórico do terminal.
`);
}

function inteiroPositivo(valor, nome) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`${nome} precisa ser um inteiro positivo.`);
  }
  return numero;
}

function lerArgumentos(argv) {
  const opcoes = {
    sessions: [],
    output: null,
    width: null,
    height: null,
    durationMinutes: null,
    theme: null,
    headed: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opcoes.help = true;
    else if (arg === '--headed') opcoes.headed = true;
    else if (arg === '-s' || arg === '--session') {
      const id = argv[++i];
      if (!id || !UUID.test(id)) throw new Error('Informe um UUID válido depois de --session.');
      opcoes.sessions.push(id);
    } else if (arg === '-o' || arg === '--output') {
      opcoes.output = argv[++i] ?? null;
      if (!opcoes.output) throw new Error('Informe uma pasta depois de --output.');
    } else if (arg === '--width') {
      opcoes.width = inteiroPositivo(argv[++i], '--width');
    } else if (arg === '--height') {
      opcoes.height = inteiroPositivo(argv[++i], '--height');
    } else if (arg === '--duration-minutes') {
      opcoes.durationMinutes = inteiroPositivo(argv[++i], '--duration-minutes');
    } else if (arg === '--theme') {
      const tema = argv[++i];
      if (tema !== 'dark' && tema !== 'light') {
        throw new Error('--theme precisa ser dark ou light.');
      }
      opcoes.theme = tema;
    } else {
      throw new Error(`Opção desconhecida: ${arg}`);
    }
  }

  return opcoes;
}

function loginDoApresentador(env) {
  const usuario = env.VITE_PRESENTER_USER || env.PRESENTER_USER || 'apresentador';
  return usuario.includes('@') ? usuario : `${usuario}@pulso.local`;
}

function obterSenha(env) {
  return env.PRESENTER_PASSWORD || env.senha2 || env.senha || '';
}

function nomeSeguro(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sessao';
}

function instanteParaPasta() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function buscarSessoes(env, ids) {
  const url = env.VITE_SUPABASE_URL;
  const chave = env.VITE_SUPABASE_ANON_KEY;
  const senha = obterSenha(env);

  if (!url || !chave) {
    throw new Error('VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY precisam estar em .env.');
  }
  if (!senha) {
    throw new Error('Defina PRESENTER_PASSWORD em .env.local ou no ambiente antes de exportar.');
  }

  const supabase = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { error: erroLogin } = await supabase.auth.signInWithPassword({
    email: loginDoApresentador(env),
    password: senha,
  });
  if (erroLogin) throw new Error(`Não foi possível entrar como apresentador: ${erroLogin.message}`);

  let consulta = supabase
    .from('v_session_overview')
    .select('session_id,event_title,access_code,answers,started_at')
    .order('started_at', { ascending: true, nullsFirst: true });

  consulta = ids.length > 0 ? consulta.in('session_id', ids) : consulta.gt('answers', 0);
  let resultado;
  try {
    resultado = await consulta;
  } finally {
    await supabase.auth.signOut({ scope: 'local' });
  }

  const { data, error } = resultado;

  if (error) throw new Error(`Não foi possível listar as sessões: ${error.message}`);

  const sessoes = data ?? [];
  if (ids.length > 0) {
    const encontradas = new Set(sessoes.map((s) => s.session_id));
    const ausentes = ids.filter((id) => !encontradas.has(id));
    if (ausentes.length > 0) {
      throw new Error(`Sessão não encontrada ou sem permissão: ${ausentes.join(', ')}`);
    }
  }

  return sessoes;
}

async function esperarLayout(page) {
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
    await new Promise((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
    });
  });
  await page.waitForTimeout(250);
}

async function autenticarNaTelaSeNecessario(page, senha) {
  const deck = page.locator('[data-export-ready="true"]');
  const campo = page.locator('input[type="password"]');
  const estado = await Promise.race([
    deck.waitFor({ state: 'visible' }).then(() => 'pronto'),
    campo.waitFor({ state: 'visible' }).then(() => 'login'),
  ]);
  if (estado === 'pronto') return;

  await campo.fill(senha);
  await page.locator('form button[type="submit"]').click();

  const alerta = page.locator('form .alert');
  const resultado = await Promise.race([
    deck.waitFor({ state: 'visible' }).then(() => 'pronto'),
    alerta.waitFor({ state: 'visible' }).then(() => 'erro'),
  ]);
  if (resultado === 'erro') {
    throw new Error(`Falha no login da tela: ${(await alerta.textContent())?.trim() || 'credencial recusada'}`);
  }
}

async function encerrarSessaoTemporaria(page) {
  const botao = page.locator('[data-export-signout]');
  if ((await botao.count()) === 0) return;

  await botao.evaluate((elemento) => elemento.click());
  await page.locator('input[type="password"]').waitFor({ state: 'visible', timeout: 15_000 });
}

async function validarSemCortes(tela, arquivo) {
  const problema = await tela.evaluate((elemento) => {
    const limite = elemento.getBoundingClientRect();
    const candidatos = [elemento, ...elemento.querySelectorAll('*')];

    for (const candidato of candidatos) {
      const estilo = getComputedStyle(candidato);
      if (estilo.display === 'none' || estilo.visibility === 'hidden') continue;
      const caixa = candidato.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) continue;
      if (
        caixa.left < limite.left - 1 ||
        caixa.top < limite.top - 1 ||
        caixa.right > limite.right + 1 ||
        caixa.bottom > limite.bottom + 1
      ) {
        return {
          tag: candidato.tagName.toLowerCase(),
          classe: typeof candidato.className === 'string' ? candidato.className : '',
          texto: (candidato.textContent || '').trim().slice(0, 80),
        };
      }
    }
    return null;
  });

  if (problema) {
    throw new Error(
      `A tela ${arquivo} teria conteúdo cortado (${problema.tag}.${problema.classe}: ${problema.texto}). ` +
        'Aumente a altura da exportação ou reduza o conteúdo antes de gerar o PDF.',
    );
  }
}

async function capturarSessao({
  page,
  baseUrl,
  sessao,
  pastaRaiz,
  senha,
  width,
  height,
  durationMinutes,
  theme,
}) {
  const query = durationMinutes ? `?durationMinutes=${durationMinutes}` : '';
  await page.goto(`${baseUrl}/${query}#/export/${sessao.session_id}`, { waitUntil: 'domcontentloaded' });
  await autenticarNaTelaSeNecessario(page, senha);

  const deck = page.locator('[data-export-ready="true"]');
  await deck.waitFor({ state: 'visible', timeout: 60_000 });
  await page.evaluate((tema) => document.documentElement.setAttribute('data-theme', tema), theme);
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}' +
      '.tooltip{display:none!important}',
  });
  await esperarLayout(page);

  const pastaDaSessao = resolve(
    pastaRaiz,
    `${nomeSeguro(sessao.access_code)}-${sessao.session_id.slice(0, 8)}`,
  );
  await mkdir(pastaDaSessao, { recursive: true });

  const telas = page.locator('[data-export-slide]');
  const total = await telas.count();
  const arquivos = [];

  for (let i = 0; i < total; i += 1) {
    const tela = telas.nth(i);
    const nome = nomeSeguro((await tela.getAttribute('data-export-filename')) || `tela-${i + 1}.png`);
    const arquivo = nome.endsWith('.png') ? nome : `${nome}.png`;
    await validarSemCortes(tela, arquivo);
    await tela.screenshot({ path: resolve(pastaDaSessao, arquivo), animations: 'disabled' });
    arquivos.push(arquivo);
    console.log(`  ✓ ${arquivo}`);
  }

  await writeFile(
    resolve(pastaDaSessao, 'manifest.json'),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        event_title: sessao.event_title,
        access_code: sessao.access_code,
        session_id: sessao.session_id,
        viewport: { width, height },
        duration_minutes: durationMinutes,
        theme,
        files: arquivos,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return { pasta: pastaDaSessao, total };
}

async function executar() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  if (opcoes.help) {
    ajuda();
    return;
  }

  const env = { ...loadEnv('development', raiz, ''), ...process.env };
  const width = opcoes.width ?? inteiroPositivo(env.PULSO_EXPORT_WIDTH || '1920', 'PULSO_EXPORT_WIDTH');
  const height = opcoes.height ?? inteiroPositivo(env.PULSO_EXPORT_HEIGHT || '1080', 'PULSO_EXPORT_HEIGHT');
  const port = inteiroPositivo(env.PULSO_EXPORT_PORT || '4174', 'PULSO_EXPORT_PORT');
  const durationMinutes =
    opcoes.durationMinutes ??
    (env.PULSO_EXPORT_DURATION_MINUTES
      ? inteiroPositivo(env.PULSO_EXPORT_DURATION_MINUTES, 'PULSO_EXPORT_DURATION_MINUTES')
      : null);
  const theme = opcoes.theme ?? env.PULSO_EXPORT_THEME ?? 'dark';
  if (theme !== 'dark' && theme !== 'light') {
    throw new Error('PULSO_EXPORT_THEME precisa ser dark ou light.');
  }
  const pastaRaiz = opcoes.output
    ? resolve(raiz, opcoes.output)
    : resolve(raiz, 'exports', `resultados-${instanteParaPasta()}`);

  console.log('Autenticando e procurando sessões com respostas…');
  const sessoes = await buscarSessoes(env, opcoes.sessions);
  if (sessoes.length === 0) {
    console.log('Nenhuma sessão com respostas válidas foi encontrada.');
    return;
  }
  if (durationMinutes !== null && sessoes.length !== 1) {
    throw new Error('--duration-minutes só pode ser usado quando exatamente uma sessão é exportada.');
  }

  await mkdir(pastaRaiz, { recursive: true });
  const servidor = await createServer({
    root: raiz,
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true },
  });

  let browser;
  try {
    await servidor.listen();
    try {
      browser = await chromium.launch({ headless: !opcoes.headed });
    } catch (error) {
      if (String(error).includes('Executable doesn\'t exist')) {
        throw new Error('O Chromium do Playwright não está instalado. Rode: npx playwright install chromium');
      }
      throw error;
    }

    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: theme,
      reducedMotion: 'reduce',
      locale: 'pt-BR',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);

    const baseUrl = `http://127.0.0.1:${port}`;
    let totalDeTelas = 0;
    try {
      for (const sessao of sessoes) {
        console.log(`Exportando ${sessao.event_title} (${sessao.access_code})…`);
        const resultado = await capturarSessao({
          page,
          baseUrl,
          sessao,
          pastaRaiz,
          senha: obterSenha(env),
          width,
          height,
          durationMinutes,
          theme,
        });
        totalDeTelas += resultado.total;
      }
    } finally {
      await encerrarSessaoTemporaria(page).catch((error) => {
        console.warn(`Aviso: não foi possível encerrar a sessão temporária: ${error.message}`);
      });
      await context.close();
    }

    console.log(`\nPronto: ${totalDeTelas} PNG(s) em ${pastaRaiz}`);
  } finally {
    if (browser) await browser.close();
    await servidor.close();
  }
}

executar().catch((error) => {
  console.error(`\nErro: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

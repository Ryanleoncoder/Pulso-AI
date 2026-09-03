import { useState } from 'react';
import { useParams } from '../lib/router';
import { BotaoSair, PresenterGate } from '../components/PresenterGate';
import { ResultadoDaPergunta } from '../components/QuestionResult';
import { WordCloud } from '../components/WordCloud';
import { useSessionData, type SessionData } from '../lib/sessionData';
import { mensagemDeErro, supabase } from '../lib/supabase';
import { NOME_DA_FASE, NOME_DO_TIPO, type ExportRow } from '../lib/types';

export function Results() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <PresenterGate>
      <Relatorio sessionId={sessionId} />
    </PresenterGate>
  );
}

/** Separador ponto e vírgula e BOM: é o que o Excel em pt-BR abre certo. */
function paraCsv(rows: ExportRow[]): string {
  const colunas: (keyof ExportRow)[] = [
    'access_code',
    'question_position',
    'phase',
    'question_type',
    'prompt',
    'respondent_ref',
    'answer',
    'normalized_text',
    'is_hidden',
    'created_at',
  ];

  const escapar = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const linhas = [colunas.join(';')];
  for (const row of rows) linhas.push(colunas.map((c) => escapar(row[c])).join(';'));
  return '﻿' + linhas.join('\r\n');
}

function baixar(nome: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function duracao(inicio: string | null, fim: string | null): string {
  if (!inicio) return '—';
  const ms = new Date(fim ?? Date.now()).getTime() - new Date(inicio).getTime();
  const minutos = Math.max(0, Math.round(ms / 60000));
  return `${minutos} min`;
}

function Relatorio({ sessionId }: { sessionId: string | undefined }) {
  const { data, carregando, erro } = useSessionData(sessionId);
  const [limpo, setLimpo] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [erroExport, setErroExport] = useState<string | null>(null);

  const overview = data.overview;

  async function exportar() {
    if (!sessionId || !overview) return;
    setExportando(true);
    setErroExport(null);

    const { data: rows, error } = await supabase
      .from('v_export_responses')
      .select('*')
      .eq('session_id', sessionId)
      .order('question_position', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      setErroExport(mensagemDeErro(error));
      setExportando(false);
      return;
    }

    baixar(`pulso-ia-${overview.access_code}.csv`, paraCsv((rows ?? []) as ExportRow[]));
    setExportando(false);
  }

  if (erro) {
    return (
      <div className="shell shell--narrow">
        <div className="alert">{erro}</div>
      </div>
    );
  }

  if (carregando || !overview) {
    return (
      <div className="shell">
        <p className="muted">Carregando os resultados…</p>
      </div>
    );
  }

  return (
    <div className={limpo ? 'shell clean' : 'shell'}>
      <div className="row row--between">
        <div className="stack stack--tight">
          <span className="eyebrow">Resultados e evidências</span>
          <h1 style={{ fontSize: 28 }}>{overview.event_title}</h1>
        </div>
        <div className="row no-print">
          <button className="btn-small" onClick={() => setLimpo(!limpo)}>
            {limpo ? 'Mostrar controles' : 'Tela limpa'}
          </button>
          <button className="btn-small" disabled={exportando} onClick={() => void exportar()}>
            {exportando ? 'Gerando…' : 'Exportar CSV'}
          </button>
          <BotaoSair />
        </div>
      </div>

      {erroExport && <div className="alert">{erroExport}</div>}

      <div className="tiles">
        <div className="tile">
          <div className="tile__value">{overview.participants}</div>
          <div className="tile__label">participantes</div>
        </div>
        <div className="tile">
          <div className="tile__value">{overview.answers}</div>
          <div className="tile__label">respostas válidas</div>
        </div>
        <div className="tile">
          <div className="tile__value">{data.questions.length}</div>
          <div className="tile__label">perguntas no roteiro</div>
        </div>
        <div className="tile">
          <div className="tile__value">{duracao(overview.started_at, overview.finished_at)}</div>
          <div className="tile__label">duração</div>
        </div>
      </div>

      <ComparacaoNuvens data={data} />

      <div className="report">
        {data.questions.map((q) => {
          const p = data.progress[q.id];
          if (!p || p.answers === 0) return null;
          return (
            <div key={q.id} className="card stack">
              <div className="stack stack--tight">
                <div className="row">
                  <span className="pill">{NOME_DA_FASE[q.phase]}</span>
                  <span className="pill">{NOME_DO_TIPO[q.type]}</span>
                  <span className="muted">
                    {p.answers} {p.answers === 1 ? 'resposta' : 'respostas'}
                    {p.hidden_answers > 0 && ` · ${p.hidden_answers} ocultas`}
                  </span>
                </div>
                <h2 style={{ fontSize: 21 }}>
                  {q.position}. {q.prompt}
                </h2>
              </div>
              <ResultadoDaPergunta question={{ ...q, results_visible: true }} data={data} cloudHeight={300} />
            </div>
          );
        })}
      </div>

      <p className="muted">
        Nenhuma coluna identifica quem respondeu. O <code>respondent_ref</code> do CSV é um
        hash do identificador aleatório do navegador — serve para ver que respostas vieram do
        mesmo aparelho, e nada além disso.
      </p>
    </div>
  );
}

/**
 * A evidência principal da atividade: a mesma pergunta antes e depois.
 * Aparece automaticamente se existir uma nuvem em `pre` e outra em `post`.
 */
function ComparacaoNuvens({ data }: { data: SessionData }) {
  const nuvens = data.questions.filter((q) => q.type === 'word_cloud');
  const antes = nuvens.find((q) => q.phase === 'pre');
  const depois = nuvens.find((q) => q.phase === 'post');

  if (!antes || !depois) return null;

  const itens = (id: string) =>
    (data.wordCloud[id] ?? []).map((r) => ({
      term: r.term,
      label: r.sample_text || r.term,
      weight: r.weight,
    }));

  const antesItens = itens(antes.id);
  const depoisItens = itens(depois.id);
  if (antesItens.length === 0 && depoisItens.length === 0) return null;

  const novos = depoisItens.filter((d) => !antesItens.some((a) => a.term === d.term));

  return (
    <div className="card stack">
      <div className="stack stack--tight">
        <span className="eyebrow">Mudança de percepção</span>
        <h2 style={{ fontSize: 21 }}>Antes e depois do encontro</h2>
      </div>

      <div className="compare">
        <div className="stack stack--tight">
          <span className="muted">{antes.prompt}</span>
          <WordCloud items={antesItens} height={280} maxFont={54} />
        </div>
        <div className="stack stack--tight">
          <span className="muted">{depois.prompt}</span>
          <WordCloud items={depoisItens} height={280} maxFont={54} />
        </div>
      </div>

      {novos.length > 0 && (
        <p className="secondary">
          <strong>{novos.length}</strong>{' '}
          {novos.length === 1 ? 'termo novo apareceu' : 'termos novos apareceram'} no
          encerramento:{' '}
          {novos
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 8)
            .map((t) => t.label)
            .join(', ')}
          .
        </p>
      )}
    </div>
  );
}

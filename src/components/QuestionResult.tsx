import type { SessionData } from '../lib/sessionData';
import type { Question } from '../lib/types';
import { Bars, Counter, Histogram, type BarItem } from './Charts';
import { WordCloud } from './WordCloud';

interface Props {
  question: Question;
  data: SessionData;
  /** altura da nuvem de palavras; o telão usa mais que o relatório */
  cloudHeight?: number;
  /** false = mostra apenas o contador, sem revelar o resultado */
  revealed?: boolean;
}

export function ResultadoDaPergunta({
  question: q,
  data,
  cloudHeight = 420,
  revealed = true,
}: Props) {
  const respostas = data.progress[q.id]?.answers ?? 0;
  const gabarito = data.answerKeys[q.id];

  if (!revealed && q.type !== 'swipe_card') {
    return (
      <Counter
        value={respostas}
        label={respostas === 1 ? 'resposta recebida' : 'respostas recebidas'}
      />
    );
  }

  const explicacao =
    gabarito?.explanation && q.results_visible ? (
      <div className="alert alert--ok" style={{ lineHeight: 1.5 }}>
        <strong>Por quê:</strong> {gabarito.explanation}
      </div>
    ) : null;

  switch (q.type) {
    case 'word_cloud': {
      const termos = (data.wordCloud[q.id] ?? []).map((r) => ({
        term: r.term,
        label: r.sample_text || r.term,
        weight: r.weight,
      }));
      return (
        <div className="stack">
          <WordCloud items={termos} height={cloudHeight} />
        </div>
      );
    }

    case 'single_choice':
    case 'multiple_choice': {
      const linhas = [...(data.optionResults[q.id] ?? [])].sort(
        (a, b) => b.votes - a.votes || a.position - b.position,
      );
      const itens: BarItem[] = linhas.map((r) => ({
        id: r.option_id,
        label: r.label,
        value: r.votes,
        correct: gabarito?.correct_option_ids?.includes(r.option_id) ?? false,
      }));
      return (
        <div className="stack">
          <Bars
            items={itens}
            total={Math.max(1, respostas)}
            revealCorrect={q.results_visible}
          />
          <span className="muted">
            {q.type === 'multiple_choice'
              ? `Percentual sobre ${respostas} ${respostas === 1 ? 'pessoa' : 'pessoas'} que responderam (podia marcar mais de uma).`
              : `${respostas} ${respostas === 1 ? 'resposta' : 'respostas'}.`}
          </span>
          {explicacao}
        </div>
      );
    }

    case 'boolean': {
      const r = data.booleanResults[q.id];
      const sim = r?.yes_count ?? 0;
      const nao = r?.no_count ?? 0;
      const itens: BarItem[] = [
        {
          id: 'sim',
          label: q.config.yes_label ?? 'Sim',
          value: sim,
          color: 'var(--series-1)',
          correct: gabarito?.correct_boolean === true,
        },
        {
          id: 'nao',
          label: q.config.no_label ?? 'Não',
          value: nao,
          color: 'var(--series-2)',
          correct: gabarito?.correct_boolean === false,
        },
      ];
      return (
        <div className="stack">
          <Bars items={itens} total={Math.max(1, sim + nao)} revealCorrect={q.results_visible} />
          {explicacao}
        </div>
      );
    }

    case 'scale': {
      const min = q.config.min ?? 1;
      const max = q.config.max ?? 5;
      const contagem: Record<number, number> = {};
      for (const r of data.scaleResults[q.id] ?? []) contagem[r.value] = r.total;
      const resumo = data.scaleSummary[q.id];
      return (
        <Histogram
          counts={contagem}
          min={min}
          max={max}
          minLabel={q.config.min_label}
          maxLabel={q.config.max_label}
          average={resumo ? Number(resumo.average) : null}
          total={resumo?.total ?? 0}
        />
      );
    }

    case 'open_text': {
      const textos = (data.openText[q.id] ?? []).filter((t) => !t.is_hidden);
      if (textos.length === 0) {
        return <p className="muted">Aguardando as primeiras respostas…</p>;
      }
      return (
        <div className="stack stack--tight">
          {textos.map((t) => (
            <div key={t.response_id} className="card" style={{ padding: '14px 16px' }}>
              {t.answer_text}
            </div>
          ))}
          <span className="muted">
            {textos.length} {textos.length === 1 ? 'resposta' : 'respostas'}.
          </span>
        </div>
      );
    }

    case 'swipe_card': {
      const opcoesLista = data.options[q.id] ?? [];
      const resultados = data.optionResults[q.id] ?? [];
      const vMap: Record<string, number> = {};
      for (const r of resultados) vMap[r.option_id] = r.votes;
      const mostrarGabarito = revealed && q.results_visible;

      return (
        <div className="stack">
          <div className="swipe-results-grid">
            {opcoesLista.map((o) => {
              const aprovados = vMap[o.id] ?? 0;
              const pct = respostas > 0 ? Math.round((aprovados / respostas) * 100) : 0;
              const ehCorretoAprovar = gabarito?.correct_option_ids?.includes(o.id) ?? false;

              const match = o.label.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*(.*)$/u);
              const emoji = match ? match[1] : '';
              const titulo = match ? match[2] : o.label;

              return (
                <div
                  key={o.id}
                  className={`swipe-result-card ${
                    mostrarGabarito
                      ? ehCorretoAprovar
                        ? 'swipe-result-card--correct'
                        : 'swipe-result-card--incorrect'
                      : ''
                  }`}
                >
                  <div className="swipe-result-card__header">
                    {emoji && <span className="swipe-result-card__emoji">{emoji}</span>}
                    <span className="swipe-result-card__title">{titulo}</span>
                  </div>

                  {o.description && (
                    <p className="swipe-result-card__desc">{o.description}</p>
                  )}

                  <div className="swipe-result-card__stats">
                    <div className="swipe-result-card__bar-track">
                      <div
                        className="swipe-result-card__bar-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="swipe-result-card__pct">
                      {pct}% ({aprovados} de {respostas} {respostas === 1 ? 'pessoa' : 'pessoas'})
                    </span>
                  </div>

                  {mostrarGabarito && (
                    <div
                      className={`swipe-result-card__badge ${
                        ehCorretoAprovar
                          ? 'swipe-result-card__badge--right'
                          : 'swipe-result-card__badge--wrong'
                      }`}
                    >
                      {ehCorretoAprovar ? '✓ PODE ENVIAR' : '✕ NÃO ENVIAR'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <span className="muted" style={{ textAlign: 'center' }}>
            {respostas} {respostas === 1 ? 'pessoa respondeu' : 'pessoas responderam'}.
          </span>

          {explicacao}
        </div>
      );
    }

    default:
      return null;
  }
}

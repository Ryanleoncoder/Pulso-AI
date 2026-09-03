import { useEffect, useState } from 'react';
import { useParams } from '../lib/router';
import { PresenterGate } from '../components/PresenterGate';
import { QrPanel } from '../components/QrPanel';
import { ResultadoDaPergunta } from '../components/QuestionResult';
import { WordCloud } from '../components/WordCloud';
import { useSessionData } from '../lib/sessionData';
import type { Question } from '../lib/types';

export function Present() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <PresenterGate>
      <Telao sessionId={sessionId} />
    </PresenterGate>
  );
}

function useTema() {
  const [tema, setTema] = useState<'auto' | 'light' | 'dark'>('auto');
  useEffect(() => {
    const root = document.documentElement;
    if (tema === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', tema);
  }, [tema]);
  return { tema, setTema };
}

function Telao({ sessionId }: { sessionId: string | undefined }) {
  const { data, carregando, erro } = useSessionData(sessionId);
  const { tema, setTema } = useTema();

  const overview = data.overview;
  const ativa = data.questions.find((q) => q.id === overview?.active_question_id) ?? null;

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
        <p className="muted">Carregando o telão…</p>
      </div>
    );
  }

  // Sessão encerrada tem tela própria. Sem isto o telão cairia no ramo "sem
  // pergunta" e voltaria a exibir o QR Code, convidando a sala a entrar numa
  // sessão que já fechou.
  if (overview.status === 'finished') {
    const respostas = data.questions.reduce(
      (soma, q) => soma + (data.progress[q.id]?.answers ?? 0),
      0,
    );
    return (
      <div className="stage">
        <div className="row row--between">
          <span className="eyebrow">{overview.event_title}</span>
          <span className="pill">encerrada</span>
        </div>

        <div className="stage__body" style={{ alignItems: 'center', textAlign: 'center' }}>
          <div className="stack">
            <h1 className="stage__prompt" style={{ maxWidth: 'none' }}>
              Obrigado pela participação
            </h1>
            <div className="tiles" style={{ marginTop: 12 }}>
              <div className="tile">
                <div className="tile__value">{overview.participants}</div>
                <div className="tile__label">participaram</div>
              </div>
              <div className="tile">
                <div className="tile__value">{respostas}</div>
                <div className="tile__label">respostas</div>
              </div>
              <div className="tile">
                <div className="tile__value">{data.questions.length}</div>
                <div className="tile__label">perguntas</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const semPergunta = !ativa || overview.status === 'waiting' || overview.status === 'draft';

  return (
    <div className="stage">
      <div className="row row--between">
        <span className="eyebrow">{overview.event_title}</span>
        <div className="row no-print">
          <span className="pill" title={`${overview.participants} entraram nesta sessão no total`}>
            {overview.participants_online}{' '}
            {overview.participants_online === 1 ? 'presente' : 'presentes'}
          </span>
          <button
            className="btn-small"
            onClick={() => setTema(tema === 'dark' ? 'light' : 'dark')}
            title="Alterna claro e escuro — projetor em sala clara pede o tema claro"
          >
            {tema === 'dark' ? 'Claro' : 'Escuro'}
          </button>
          <button
            className="btn-small"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen();
            }}
          >
            Tela cheia
          </button>
        </div>
      </div>

      {semPergunta ? (
        <div className="stage__body" style={{ alignItems: 'center' }}>
          <QrPanel code={overview.access_code} size={320} />
        </div>
      ) : (
        <>
          <div className="stack stack--tight">
            <h1 className="stage__prompt">{ativa.prompt}</h1>
            {ativa.description && <p className="secondary">{ativa.description}</p>}
          </div>

          <div className="stage__body">
            {ativa.results_visible ? (
              <Comparacao pergunta={ativa} data={data} />
            ) : (
              <ResultadoDaPergunta question={ativa} data={data} revealed={false} />
            )}
          </div>

          <div className="stage__footer no-print">
            <span>
              Código <strong>{overview.access_code}</strong>
            </span>
            <span>
              {/* Nuvem aceita várias palavras por pessoa, então "de N pessoas"
                  não faz sentido ali — vira contagem de respostas. */}
              {ativa.type === 'word_cloud'
                ? `${data.progress[ativa.id]?.answers ?? 0} palavras enviadas`
                : `${data.progress[ativa.id]?.answers ?? 0} de ${overview.participants_online} responderam`}
            </span>
            <span>
              {ativa.results_visible ? 'Resultado na tela' : 'Resultado oculto'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Quando a pergunta traz `compare_with_position` no config e as duas são nuvem
 * de palavras, o telão mostra abertura e encerramento lado a lado — é a
 * evidência de mudança de percepção.
 */
function Comparacao({
  pergunta,
  data,
}: {
  pergunta: Question;
  data: ReturnType<typeof useSessionData>['data'];
}) {
  const posicaoPar = pergunta.config.compare_with_position;
  const par = posicaoPar
    ? data.questions.find((q) => q.position === posicaoPar && q.type === 'word_cloud')
    : undefined;

  if (pergunta.type !== 'word_cloud' || !par) {
    return <ResultadoDaPergunta question={pergunta} data={data} cloudHeight={440} />;
  }

  const nuvem = (id: string) =>
    (data.wordCloud[id] ?? []).map((r) => ({
      term: r.term,
      label: r.sample_text || r.term,
      weight: r.weight,
    }));

  return (
    <div className="compare">
      <div className="stack stack--tight">
        <span className="eyebrow">Antes — pergunta {par.position}</span>
        <WordCloud items={nuvem(par.id)} height={340} maxFont={62} />
      </div>
      <div className="stack stack--tight">
        <span className="eyebrow">Depois — pergunta {pergunta.position}</span>
        <WordCloud items={nuvem(pergunta.id)} height={340} maxFont={62} />
      </div>
    </div>
  );
}

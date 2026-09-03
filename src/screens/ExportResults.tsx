import type { ReactNode } from 'react';
import { PresenterGate } from '../components/PresenterGate';
import { ResultadoDaPergunta } from '../components/QuestionResult';
import { WordCloud } from '../components/WordCloud';
import { useParams } from '../lib/router';
import { useSessionData, type SessionData } from '../lib/sessionData';
import { supabase } from '../lib/supabase';
import {
  NOME_DA_FASE,
  NOME_DO_TIPO,
  type OpenTextRow,
  type Question,
} from '../lib/types';

const RESPOSTAS_ABERTAS_POR_TELA = 6;

export function ExportResults() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <PresenterGate>
      <>
        <DeckDeResultados sessionId={sessionId} />
        <button
          type="button"
          hidden
          data-export-signout
          onClick={() => void supabase.auth.signOut({ scope: 'local' })}
        >
          Encerrar sessão temporária
        </button>
      </>
    </PresenterGate>
  );
}

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function formatarDuracao(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const restante = minutos % 60;
  return restante > 0 ? `${horas}h${String(restante).padStart(2, '0')}` : `${horas}h`;
}

function duracao(inicio: string | null, fim: string | null, minutosInformados: number | null): string {
  if (minutosInformados !== null) return formatarDuracao(minutosInformados);
  if (!inicio || !fim) return '—';
  const ms = new Date(fim).getTime() - new Date(inicio).getTime();
  return formatarDuracao(Math.max(0, Math.round(ms / 60_000)));
}

function dividir<T>(itens: T[], tamanho: number): T[][] {
  const partes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) partes.push(itens.slice(i, i + tamanho));
  return partes;
}

function nomeDaTela(pergunta: Question, pagina?: number): string {
  const posicao = String(pergunta.position).padStart(2, '0');
  const sufixo = pagina ? `-pagina-${String(pagina).padStart(2, '0')}` : '';
  return `${posicao}-${slug(pergunta.prompt) || 'resultado'}${sufixo}.png`;
}

function Tela({
  arquivo,
  children,
}: {
  arquivo: string;
  children: ReactNode;
}) {
  return (
    <section className="stage capture-slide" data-export-slide data-export-filename={arquivo}>
      {children}
    </section>
  );
}

function DeckDeResultados({ sessionId }: { sessionId: string | undefined }) {
  const { data, carregando, erro } = useSessionData(sessionId, { live: false });
  const overview = data.overview;

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
        <p className="muted">Preparando as telas para exportação…</p>
      </div>
    );
  }

  const respondidas = data.questions.filter((q) => (data.progress[q.id]?.answers ?? 0) > 0);
  const duracaoParam = new URLSearchParams(window.location.search).get('durationMinutes');
  const duracaoInformada = duracaoParam && /^\d+$/.test(duracaoParam) ? Number(duracaoParam) : null;

  return (
    <main
      className="capture-deck"
      data-export-ready="true"
      data-export-session={overview.session_id}
      data-export-code={overview.access_code}
    >
      <Tela arquivo="00-resumo.png">
        <div className="row row--between">
          <span className="eyebrow">{overview.event_title}</span>
          <span className="pill">resultados</span>
        </div>

        <div className="stage__body capture-summary">
          <div className="stack">
            <div className="stack stack--tight">
              <span className="eyebrow">Pulso da turma</span>
              <h1 className="stage__prompt" style={{ maxWidth: 'none' }}>
                Resultados do encontro
              </h1>
            </div>
            <div className="tiles capture-summary__tiles">
              <div className="tile">
                <div className="tile__value">{overview.participants}</div>
                <div className="tile__label">participantes</div>
              </div>
              <div className="tile">
                <div className="tile__value">{overview.answers}</div>
                <div className="tile__label">respostas válidas</div>
              </div>
              <div className="tile">
                <div className="tile__value">{respondidas.length}</div>
                <div className="tile__label">perguntas respondidas</div>
              </div>
              <div className="tile">
                <div className="tile__value capture-summary__duration">
                  {duracao(overview.started_at, overview.finished_at, duracaoInformada)}
                </div>
                <div className="tile__label">duração do encontro</div>
              </div>
            </div>
          </div>
        </div>

        <div className="stage__footer">
          <span>Código {overview.access_code}</span>
          <span>Gerado a partir das respostas salvas</span>
        </div>
      </Tela>

      {respondidas.flatMap((pergunta) =>
        telasDaPergunta(pergunta, data, overview.event_title, overview.access_code),
      )}
    </main>
  );
}

function telasDaPergunta(
  pergunta: Question,
  data: SessionData,
  tituloDoEvento: string,
  codigo: string,
): ReactNode[] {
  const progresso = data.progress[pergunta.id];
  const total = progresso?.answers ?? 0;

  if (pergunta.type !== 'open_text') {
    return [
      <TelaDePergunta
        key={pergunta.id}
        arquivo={nomeDaTela(pergunta)}
        pergunta={pergunta}
        data={data}
        tituloDoEvento={tituloDoEvento}
        codigo={codigo}
        total={total}
      />,
    ];
  }

  const respostas = (data.openText[pergunta.id] ?? []).filter((r) => !r.is_hidden);
  const paginas = dividir(respostas, RESPOSTAS_ABERTAS_POR_TELA);

  return (paginas.length > 0 ? paginas : [[]]).map((pagina, indice) => (
    <TelaDePergunta
      key={`${pergunta.id}-${indice}`}
      arquivo={nomeDaTela(pergunta, indice + 1)}
      pergunta={pergunta}
      data={data}
      tituloDoEvento={tituloDoEvento}
      codigo={codigo}
      total={total}
      respostasAbertas={pagina}
      pagina={indice + 1}
      totalDePaginas={Math.max(1, paginas.length)}
    />
  ));
}

function TelaDePergunta({
  arquivo,
  pergunta,
  data,
  tituloDoEvento,
  codigo,
  total,
  respostasAbertas,
  pagina,
  totalDePaginas,
}: {
  arquivo: string;
  pergunta: Question;
  data: SessionData;
  tituloDoEvento: string;
  codigo: string;
  total: number;
  respostasAbertas?: OpenTextRow[];
  pagina?: number;
  totalDePaginas?: number;
}) {
  return (
    <Tela arquivo={arquivo}>
      <div className="row row--between">
        <span className="eyebrow">{tituloDoEvento}</span>
        <div className="row">
          <span className="pill">{NOME_DA_FASE[pergunta.phase]}</span>
          <span className="pill">{NOME_DO_TIPO[pergunta.type]}</span>
        </div>
      </div>

      <div className="stack stack--tight">
        <h1 className="stage__prompt">
          {pergunta.position}. {pergunta.prompt}
        </h1>
        {pergunta.description && <p className="secondary">{pergunta.description}</p>}
      </div>

      <div className="stage__body capture-result">
        {respostasAbertas ? (
          <RespostasAbertas respostas={respostasAbertas} />
        ) : (
          <ResultadoOuComparacao pergunta={pergunta} data={data} />
        )}
      </div>

      <div className="stage__footer">
        <span>Código {codigo}</span>
        <span>
          {total} {total === 1 ? 'resposta válida' : 'respostas válidas'}
        </span>
        <span>
          Pergunta {pergunta.position}
          {totalDePaginas && totalDePaginas > 1 ? ` · página ${pagina} de ${totalDePaginas}` : ''}
        </span>
      </div>
    </Tela>
  );
}

function RespostasAbertas({ respostas }: { respostas: OpenTextRow[] }) {
  if (respostas.length === 0) return <p className="muted">Nenhuma resposta válida.</p>;

  return (
    <div className="capture-open-text">
      {respostas.map((resposta) => (
        <blockquote key={resposta.response_id} className="card capture-open-text__answer">
          {resposta.answer_text}
        </blockquote>
      ))}
    </div>
  );
}

function ResultadoOuComparacao({ pergunta, data }: { pergunta: Question; data: SessionData }) {
  const posicaoPar = pergunta.config.compare_with_position;
  const par = posicaoPar
    ? data.questions.find((q) => q.position === posicaoPar && q.type === 'word_cloud')
    : undefined;

  if (pergunta.type !== 'word_cloud' || !par) {
    return (
      <ResultadoDaPergunta
        question={{ ...pergunta, results_visible: true }}
        data={data}
        cloudHeight={420}
      />
    );
  }

  const itens = (id: string) =>
    (data.wordCloud[id] ?? []).map((r) => ({
      term: r.term,
      label: r.sample_text || r.term,
      weight: r.weight,
    }));

  return (
    <div className="compare">
      <div className="stack stack--tight">
        <span className="eyebrow">Antes — pergunta {par.position}</span>
        <WordCloud items={itens(par.id)} height={340} maxFont={62} />
      </div>
      <div className="stack stack--tight">
        <span className="eyebrow">Depois — pergunta {pergunta.position}</span>
        <WordCloud items={itens(pergunta.id)} height={340} maxFont={62} />
      </div>
    </div>
  );
}

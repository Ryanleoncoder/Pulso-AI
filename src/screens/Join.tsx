import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from '../lib/router';
import { supabase, mensagemDeErro } from '../lib/supabase';
import { SwipeCards } from '../components/SwipeCards';
import type { JoinResult, Question, QuestionOption, SessionStatus } from '../lib/types';

type Fase = 'iniciando' | 'codigo' | 'sala';

/**
 * Quantas respostas a pessoa ainda pode mandar nesta pergunta.
 *
 * Nuvem de palavras aceita várias entradas por pessoa (`max_entries`, padrão 3)
 * — é o que faz a nuvem ficar rica numa sala pequena. As demais perguntas
 * aceitam uma só, garantido pelo índice único no banco.
 */
function limiteDeEnvios(q: Question): number {
  if (q.type === 'word_cloud') return q.config.max_entries ?? 3;
  return 1;
}

/**
 * Quantas EU já mandei, perguntando ao banco.
 *
 * Isto já morou no localStorage, e foi fonte de bug: quando as respostas eram
 * apagadas no servidor, o navegador continuava achando que tinha respondido e a
 * pessoa ficava presa na tela de "Pronto". A RPC devolve só um número sobre o
 * próprio participante — não fere a regra de que ninguém lê resposta bruta — e
 * o banco vira a fonte da verdade.
 */
async function contarMeusEnvios(sessionId: string, questionId: string): Promise<number> {
  const { data, error } = await supabase.rpc('my_response_count', {
    p_session_id: sessionId,
    p_question_id: questionId,
  });
  if (error) return 0;
  return typeof data === 'number' ? data : 0;
}

export function Join() {
  const { code: codeParam } = useParams<{ code?: string }>();

  const [fase, setFase] = useState<Fase>('iniciando');
  const [entrada, setEntrada] = useState((codeParam ?? '').toUpperCase());
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  const [sessao, setSessao] = useState<JoinResult | null>(null);
  const [status, setStatus] = useState<SessionStatus>('waiting');
  const [perguntaAtivaId, setPerguntaAtivaId] = useState<string | null>(null);

  const [pergunta, setPergunta] = useState<Question | null>(null);
  const [opcoes, setOpcoes] = useState<QuestionOption[]>([]);
  const [enviadas, setEnviadas] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);

  // ---------------------------------------------------------------- entrar

  /** Garante uma sessão anônima. Devolve a mensagem de erro, ou null se deu certo. */
  const garantirSessaoAnonima = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return null;

    const { error } = await supabase.auth.signInAnonymously();
    if (!error) return null;

    return (error as { code?: string }).code === 'over_request_rate_limit'
      ? 'Muitas entradas a partir desta rede em pouco tempo. Aguarde um minuto e toque em Entrar de novo.'
      : 'Não foi possível iniciar a sessão anônima. Verifique se "Anonymous sign-ins" está habilitado no Supabase.';
  }, []);

  const entrar = useCallback(async (codigo: string) => {
    const limpo = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (limpo.length < 4) {
      setErro('Digite o código da sessão.');
      return;
    }
    setEntrando(true);
    setErro(null);

    // Se a primeira tentativa de sessão anônima falhou (limite de taxa, rede),
    // este é o ponto de nova tentativa: o participante tocou em Entrar.
    const erroAuth = await garantirSessaoAnonima();
    if (erroAuth) {
      setErro(erroAuth);
      setFase('codigo');
      setEntrando(false);
      return;
    }

    const { data, error } = await supabase.rpc('join_session', { p_access_code: limpo });

    if (error) {
      setErro(mensagemDeErro(error));
      setFase('codigo');
      setEntrando(false);
      return;
    }

    const linha = (Array.isArray(data) ? data[0] : data) as JoinResult | undefined;
    if (!linha) {
      setErro('Código inválido ou sessão não disponível.');
      setFase('codigo');
      setEntrando(false);
      return;
    }

    setSessao(linha);
    setStatus(linha.status);
    setPerguntaAtivaId(linha.active_question_id);
    setFase('sala');
    setEntrando(false);
  }, [garantirSessaoAnonima]);

  // Autenticação anônima: é o "identificador salvo no navegador".
  useEffect(() => {
    let cancelado = false;

    (async () => {
      // O Supabase limita sign-ins anônimos por IP por hora. Numa sala, todo
      // mundo sai pelo mesmo IP — então esse erro é plausível de verdade.
      const erroAuth = await garantirSessaoAnonima();
      if (cancelado) return;

      if (erroAuth) {
        setErro(erroAuth);
        setFase('codigo');
        return;
      }

      if (codeParam) await entrar(codeParam);
      else setFase('codigo');
    })();

    return () => {
      cancelado = true;
    };
  }, [codeParam, entrar, garantirSessaoAnonima]);

  // ------------------------------------------------------------- realtime

  /**
   * Relê o estado da sessão direto do banco.
   *
   * O realtime sozinho não basta no celular: a tela apaga, o Wi-Fi troca para
   * 4G, o navegador congela a aba em segundo plano — e o websocket morre sem
   * avisar. Quando isso acontece o participante perde o evento de troca de
   * pergunta e fica parado na anterior. Esta função é a rede de segurança;
   * roda ao voltar para a aba, ao reconectar, e num intervalo curto.
   *
   * Só mexe no estado quando algo mudou de verdade, para não re-renderizar
   * (e não piscar a tela) a cada verificação.
   */
  const sincronizar = useCallback(async () => {
    if (!sessao) return;

    const { data: s } = await supabase
      .from('sessions')
      .select('status, active_question_id')
      .eq('id', sessao.session_id)
      .maybeSingle();

    if (!s) return;

    setStatus((atual) => (atual === s.status ? atual : (s.status as SessionStatus)));
    setPerguntaAtivaId((atual) =>
      atual === s.active_question_id ? atual : s.active_question_id,
    );

    if (!s.active_question_id) return;

    const { data: q } = await supabase
      .from('questions')
      .select('*')
      .eq('id', s.active_question_id)
      .maybeSingle();

    if (!q) return;
    const nova = q as Question;
    setPergunta((atual) =>
      atual &&
      atual.id === nova.id &&
      atual.status === nova.status &&
      atual.results_visible === nova.results_visible &&
      atual.prompt === nova.prompt
        ? atual
        : nova,
    );

    // Reconfere no banco quantas eu já mandei — cobre o caso de o apresentador
    // apagar respostas, ou de a pessoa ter respondido em outro aparelho.
    const n = await contarMeusEnvios(sessao.session_id, nova.id);
    setEnviadas((atual) => (atual === n ? atual : n));
  }, [sessao]);

  useEffect(() => {
    if (!sessao) return;

    const aoVoltar = () => {
      if (document.visibilityState !== 'visible') return;
      void sincronizar();
      void supabase.rpc('heartbeat', { p_session_id: sessao.session_id });
    };

    // Sinal de vida. `participants` só cresce — é registro de entrada, não lista
    // de presença. Sem isto, o telão contaria como presente quem já foi embora,
    // e o "X de Y responderam" ficaria sempre parecendo pouco.
    const bater = () => {
      void supabase.rpc('heartbeat', { p_session_id: sessao.session_id });
    };

    bater();
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    window.addEventListener('online', aoVoltar);
    const intervalo = window.setInterval(() => void sincronizar(), 5000);
    const pulso = window.setInterval(bater, 20000);

    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      window.removeEventListener('online', aoVoltar);
      window.clearInterval(intervalo);
      window.clearInterval(pulso);
    };
  }, [sessao, sincronizar]);

  useEffect(() => {
    if (!sessao) return;
    const canal = supabase.channel(`pulso-participante-${sessao.session_id}`);

    canal.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'sessions',
        filter: `id=eq.${sessao.session_id}`,
      },
      (payload) => {
        const nova = payload.new as { status: SessionStatus; active_question_id: string | null };
        setStatus(nova.status);
        setPerguntaAtivaId(nova.active_question_id);
      },
    );

    canal.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'questions',
        filter: `event_id=eq.${sessao.event_id}`,
      },
      (payload) => {
        const nova = payload.new as Question;
        setPergunta((atual) => (atual && atual.id === nova.id ? { ...atual, ...nova } : atual));
      },
    );

    // Se o canal cair ou reconectar, resincroniza na hora em vez de esperar o
    // próximo tique do intervalo.
    canal.subscribe((estado) => {
      if (estado === 'SUBSCRIBED' || estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
        void sincronizar();
      }
    });

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [sessao, sincronizar]);

  // ------------------------------------------------- carregar pergunta ativa

  useEffect(() => {
    // Estado da pergunta anterior não pode vazar para a próxima.
    setAviso(null);
    setEnviadas(0);

    if (!perguntaAtivaId) {
      setPergunta(null);
      setOpcoes([]);
      return;
    }
    let cancelado = false;

    async function carregar() {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('id', perguntaAtivaId)
        .maybeSingle();

      if (cancelado) return;
      if (error || !data) {
        setPergunta(null);
        setOpcoes([]);
        return;
      }
      const q = data as Question;
      setPergunta(q);

      if (sessao) {
        const n = await contarMeusEnvios(sessao.session_id, q.id);
        if (!cancelado) setEnviadas(n);
      }

      if (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'swipe_card') {
        const { data: opts } = await supabase
          .from('question_options')
          .select('*')
          .eq('question_id', q.id)
          .order('position', { ascending: true });
        if (!cancelado) setOpcoes((opts ?? []) as QuestionOption[]);
      } else {
        setOpcoes([]);
      }
    }

    void carregar();

    // Realtime na pergunta que está no ar: se o apresentador ajustar as
    // alternativas com a pergunta já aberta, o celular acompanha sem recarregar.
    const canal = supabase.channel(`pulso-pergunta-${perguntaAtivaId}`);
    canal.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'question_options',
        filter: `question_id=eq.${perguntaAtivaId}`,
      },
      () => void carregar(),
    );
    canal.subscribe();

    return () => {
      cancelado = true;
      void supabase.removeChannel(canal);
    };
  }, [perguntaAtivaId, sessao]);

  function aoEnviar(jaExistia: boolean) {
    if (jaExistia) {
      // O banco recusou por duplicata. Não conta como envio novo.
      setAviso(
        pergunta?.type === 'word_cloud'
          ? 'Você já enviou essa palavra. Escolha outra.'
          : 'Sua resposta anterior continua valendo — cada pessoa responde uma vez por pergunta, então o que você digitou agora não foi gravado.',
      );
      void sincronizar();
      return;
    }
    setAviso(null);
    setEnviadas((n) => n + 1);
  }

  // ---------------------------------------------------------------- telas

  if (fase === 'iniciando') {
    return (
      <div className="shell shell--narrow">
        <p className="muted">Preparando…</p>
      </div>
    );
  }

  if (fase === 'codigo' || !sessao) {
    return (
      <div className="shell shell--narrow">
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            void entrar(entrada);
          }}
        >
          <div className="stack stack--tight">
            <span className="eyebrow">Pulso IA</span>
            <h1>Código da sessão</h1>
            <p className="secondary">
              Digite o código que está no telão. Não precisa criar conta.
            </p>
          </div>

          {erro && <div className="alert">{erro}</div>}

          <input
            className="code-input"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={6}
            value={entrada}
            onChange={(e) =>
              setEntrada(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
            }
            aria-label="Código da sessão"
          />

          <button className="btn-primary" type="submit" disabled={entrando}>
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="muted">
            Nenhum nome, e-mail ou matrícula é gravado. Sua resposta não fica ligada a você.
          </p>
        </form>
      </div>
    );
  }

  if (status === 'finished') {
    return (
      <div className="shell shell--narrow">
        <div className="card stack">
          <h1>Obrigado por participar</h1>
          <p className="secondary">A sessão foi encerrada.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell shell--narrow">
      <div className="row row--between">
        <span className="eyebrow">{sessao.event_title}</span>
        <span className={status === 'live' ? 'pill pill--live' : 'pill'}>
          {status === 'live' ? 'ao vivo' : 'aguardando'}
        </span>
      </div>

      {!pergunta && (
        <div className="card stack">
          <h1>Você está dentro</h1>
          <p className="secondary">
            Aguarde a primeira pergunta aparecer no telão. Ela chega aqui automaticamente.
          </p>
        </div>
      )}

      {pergunta && enviadas >= limiteDeEnvios(pergunta) && (
        <div className="card stack">
          <div className="stack stack--tight">
            <span className="eyebrow">
              {pergunta.type === 'word_cloud' && enviadas > 1
                ? `${enviadas} palavras enviadas`
                : 'Resposta enviada'}
            </span>
            <h1>Pronto</h1>
          </div>
          <p className="secondary">
            {pergunta.type === 'word_cloud'
              ? 'Você já mandou todas as suas palavras. Aguarde a próxima pergunta — ela aparece sozinha.'
              : 'Sua resposta foi registrada. Aguarde a próxima pergunta — ela aparece sozinha.'}
          </p>

          {aviso && <div className="alert">{aviso}</div>}
        </div>
      )}

      {pergunta && enviadas < limiteDeEnvios(pergunta) && pergunta.status !== 'open' && (
        <div className="card stack">
          <h1>{pergunta.prompt}</h1>
          <p className="secondary">Esta pergunta foi encerrada. Aguarde a próxima.</p>
        </div>
      )}

      {pergunta && enviadas < limiteDeEnvios(pergunta) && pergunta.status === 'open' && (
        <Formulario
          // A chave inclui o contador: depois de mandar uma palavra, o
          // formulário remonta limpo e pronto para a próxima.
          key={`${pergunta.id}-${enviadas}`}
          pergunta={pergunta}
          opcoes={opcoes}
          sessionId={sessao.session_id}
          jaEnviadas={enviadas}
          limite={limiteDeEnvios(pergunta)}
          aviso={aviso}
          onEnviada={aoEnviar}
        />
      )}
    </div>
  );
}

// =====================================================================
// Formulário de resposta
// =====================================================================

interface FormProps {
  pergunta: Question;
  opcoes: QuestionOption[];
  sessionId: string;
  /** quantas esta pessoa já mandou nesta pergunta (nuvem aceita várias) */
  jaEnviadas: number;
  limite: number;
  aviso: string | null;
  /** jaExistia = o banco recusou por duplicata; a resposta anterior é que vale. */
  onEnviada: (jaExistia: boolean) => void;
}

function Formulario({
  pergunta: q,
  opcoes,
  sessionId,
  jaEnviadas,
  limite,
  aviso,
  onEnviada,
}: FormProps) {
  const [texto, setTexto] = useState('');
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [booleano, setBooleano] = useState<boolean | null>(null);
  const [nota, setNota] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const maxChars = q.config.max_chars ?? (q.type === 'word_cloud' ? 30 : 280);
  const maxPalavras = q.config.max_words ?? 3;
  const maxSelecoes = q.config.max_selections ?? (q.type === 'single_choice' ? 1 : 99);
  const min = q.config.min ?? 1;
  const max = q.config.max ?? 5;

  const palavras = useMemo(
    () => texto.trim().split(/\s+/).filter(Boolean).length,
    [texto],
  );

  const palavrasDemais = q.type === 'word_cloud' && palavras > maxPalavras;

  const podeEnviar = (() => {
    if (enviando) return false;
    switch (q.type) {
      case 'word_cloud':
        return palavras > 0 && !palavrasDemais;
      case 'open_text':
        return texto.trim().length > 0;
      case 'single_choice':
      case 'multiple_choice':
        return selecionadas.length > 0;
      case 'boolean':
        return booleano !== null;
      case 'scale':
        return nota !== null;
      default:
        return false;
    }
  })();

  function alternar(optionId: string) {
    setSelecionadas((atual) => {
      if (atual.includes(optionId)) return atual.filter((id) => id !== optionId);
      if (q.type === 'single_choice') return [optionId];
      if (atual.length >= maxSelecoes) return atual;
      return [...atual, optionId];
    });
  }

  async function enviar() {
    setEnviando(true);
    setErro(null);

    const { error } = await supabase.rpc('submit_response', {
      p_session_id: sessionId,
      p_question_id: q.id,
      p_answer_text:
        q.type === 'word_cloud' || q.type === 'open_text' ? texto.trim() : null,
      p_numeric_value: q.type === 'scale' ? nota : null,
      p_bool_value: q.type === 'boolean' ? booleano : null,
      p_option_ids:
        q.type === 'single_choice' || q.type === 'multiple_choice' ? selecionadas : null,
    });

    if (error) {
      // Duplicata: a resposta já estava no banco. Conta como enviada, mas a
      // tela precisa dizer que o texto novo NÃO substituiu o anterior — a
      // restrição UNIQUE (question_id, participant_id) é uma resposta por
      // pessoa por pergunta, de propósito.
      if ((error as { code?: string }).code === '23505') {
        onEnviada(true);
        return;
      }
      setErro(mensagemDeErro(error));
      setEnviando(false);
      return;
    }

    onEnviada(false);
  }

  const [enviandoSwipe, setEnviandoSwipe] = useState(false);

  async function enviarSwipe(approvedIds: string[]) {
    setEnviandoSwipe(true);
    setErro(null);

    const { error } = await supabase.rpc('submit_response', {
      p_session_id: sessionId,
      p_question_id: q.id,
      p_answer_text: null,
      p_numeric_value: null,
      p_bool_value: null,
      p_option_ids: approvedIds,
    });

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        onEnviada(true);
        return;
      }
      setErro(mensagemDeErro(error));
      setEnviandoSwipe(false);
      return;
    }

    onEnviada(false);
  }

  if (q.type === 'swipe_card') {
    return (
      <div className="card stack">
        <div className="stack stack--tight">
          <h1 style={{ fontSize: 24 }}>{q.prompt}</h1>
          {q.description && <p className="muted">{q.description}</p>}
        </div>

        {aviso && <div className="alert">{aviso}</div>}
        {erro && <div className="alert">{erro}</div>}

        {enviandoSwipe ? (
          <p className="muted" style={{ textAlign: 'center' }}>Enviando…</p>
        ) : (
          <SwipeCards
            opcoes={opcoes}
            rightLabel={q.config.right_label ?? 'Pode enviar'}
            leftLabel={q.config.left_label ?? 'Não enviar'}
            onComplete={(ids) => void enviarSwipe(ids)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="card stack">
      <div className="stack stack--tight">
        <h1 style={{ fontSize: 24 }}>{q.prompt}</h1>
        {q.description && <p className="muted">{q.description}</p>}
        {q.type === 'word_cloud' && limite > 1 && (
          <span className="muted">
            {jaEnviadas === 0
              ? `Você pode mandar até ${limite} palavras.`
              : `${jaEnviadas} de ${limite} enviadas — mande mais ${limite - jaEnviadas}.`}
          </span>
        )}
      </div>

      {aviso && <div className="alert">{aviso}</div>}
      {erro && <div className="alert">{erro}</div>}

      {q.type === 'word_cloud' && (
        <div className="stack stack--tight">
          <input
            type="text"
            value={texto}
            maxLength={maxChars}
            autoFocus
            placeholder="Sua palavra"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && podeEnviar) void enviar();
            }}
          />
          <div className="row row--between">
            <span className="muted">
              {palavras}/{maxPalavras} {maxPalavras === 1 ? 'palavra' : 'palavras'}
            </span>
            <span className="muted">
              {texto.length}/{maxChars}
            </span>
          </div>
          {palavrasDemais && (
            <span style={{ color: 'var(--critical)', fontSize: 14 }}>
              Use no máximo {maxPalavras} palavras.
            </span>
          )}
        </div>
      )}

      {q.type === 'open_text' && (
        <div className="stack stack--tight">
          <textarea
            value={texto}
            maxLength={maxChars}
            autoFocus
            placeholder="Escreva sua resposta"
            onChange={(e) => setTexto(e.target.value)}
          />
          <span className="muted" style={{ textAlign: 'right' }}>
            {texto.length}/{maxChars}
          </span>
        </div>
      )}

      {(q.type === 'single_choice' || q.type === 'multiple_choice') && (
        <div className="stack stack--tight">
          {opcoes.map((o) => {
            const ativo = selecionadas.includes(o.id);
            const bloqueado =
              !ativo && q.type === 'multiple_choice' && selecionadas.length >= maxSelecoes;
            return (
              <button
                key={o.id}
                type="button"
                className="choice"
                aria-pressed={ativo}
                disabled={bloqueado}
                onClick={() => alternar(o.id)}
              >
                <span
                  className={
                    q.type === 'single_choice' ? 'choice__mark choice__mark--round' : 'choice__mark'
                  }
                  aria-hidden="true"
                >
                  {ativo ? '✓' : ''}
                </span>
                <span>{o.label}</span>
              </button>
            );
          })}
          {q.type === 'multiple_choice' && (
            <span className="muted">
              {selecionadas.length}/{maxSelecoes} selecionadas
            </span>
          )}
        </div>
      )}

      {q.type === 'boolean' && (
        <div className="row">
          <button
            type="button"
            className="choice big-choice"
            aria-pressed={booleano === true}
            onClick={() => setBooleano(true)}
            style={{ justifyContent: 'center' }}
          >
            {q.config.yes_label ?? 'Sim'}
          </button>
          <button
            type="button"
            className="choice big-choice"
            aria-pressed={booleano === false}
            onClick={() => setBooleano(false)}
            style={{ justifyContent: 'center' }}
          >
            {q.config.no_label ?? 'Não'}
          </button>
        </div>
      )}

      {q.type === 'scale' && (
        <div className="stack stack--tight">
          <div className="scale-row">
            {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((v) => (
              <button
                key={v}
                type="button"
                className="choice"
                aria-pressed={nota === v}
                onClick={() => setNota(v)}
                style={{ justifyContent: 'center' }}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="row row--between">
            <span className="muted">{q.config.min_label ?? min}</span>
            <span className="muted">{q.config.max_label ?? max}</span>
          </div>
        </div>
      )}

      <button className="btn-primary" disabled={!podeEnviar} onClick={() => void enviar()}>
        {enviando
          ? 'Enviando…'
          : q.type === 'word_cloud' && jaEnviadas > 0
            ? 'Enviar mais uma'
            : 'Enviar resposta'}
      </button>

      <span className="muted">
        {q.type === 'word_cloud' && limite > 1
          ? `Até ${limite} palavras por pessoa, sem repetir.`
          : 'Você responde uma vez por pergunta.'}
      </span>
    </div>
  );
}

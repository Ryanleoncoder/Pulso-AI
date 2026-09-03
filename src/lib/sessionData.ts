import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, mensagemDeErro } from './supabase';
import type {
  AnswerKey,
  BooleanResultRow,
  OpenTextRow,
  OptionResultRow,
  Question,
  QuestionOption,
  QuestionProgress,
  ScaleResultRow,
  ScaleSummaryRow,
  SessionOverview,
  WordCloudRow,
} from './types';

export interface SessionData {
  overview: SessionOverview | null;
  questions: Question[];
  options: Record<string, QuestionOption[]>;
  answerKeys: Record<string, AnswerKey>;
  progress: Record<string, QuestionProgress>;
  wordCloud: Record<string, WordCloudRow[]>;
  optionResults: Record<string, OptionResultRow[]>;
  booleanResults: Record<string, BooleanResultRow>;
  scaleResults: Record<string, ScaleResultRow[]>;
  scaleSummary: Record<string, ScaleSummaryRow>;
  openText: Record<string, OpenTextRow[]>;
}

const VAZIO: SessionData = {
  overview: null,
  questions: [],
  options: {},
  answerKeys: {},
  progress: {},
  wordCloud: {},
  optionResults: {},
  booleanResults: {},
  scaleResults: {},
  scaleSummary: {},
  openText: {},
};

function agrupar<T>(rows: T[], chave: (row: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const row of rows) {
    const k = chave(row);
    (out[k] ??= []).push(row);
  }
  return out;
}

function indexar<T>(rows: T[], chave: (row: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const row of rows) out[chave(row)] = row;
  return out;
}

async function carregar(sessionId: string): Promise<SessionData> {
  const { data: overview, error: erroOverview } = await supabase
    .from('v_session_overview')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (erroOverview) throw erroOverview;
  if (!overview) throw new Error('Sessão não encontrada, ou você não é o dono deste evento.');

  const ov = overview as SessionOverview;

  const [
    perguntas,
    progresso,
    nuvem,
    opcoesResultado,
    booleanos,
    escala,
    escalaResumo,
    textos,
  ] = await Promise.all([
    supabase
      .from('questions')
      .select('*')
      .eq('event_id', ov.event_id)
      .order('position', { ascending: true }),
    supabase.from('v_question_progress').select('*').eq('session_id', sessionId),
    supabase.from('v_word_cloud').select('*').eq('session_id', sessionId),
    supabase.from('v_option_results').select('*').eq('session_id', sessionId),
    supabase.from('v_boolean_results').select('*').eq('session_id', sessionId),
    supabase.from('v_scale_results').select('*').eq('session_id', sessionId),
    supabase.from('v_scale_summary').select('*').eq('session_id', sessionId),
    supabase
      .from('v_open_text_responses')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false }),
  ]);

  for (const r of [perguntas, progresso, nuvem, opcoesResultado, booleanos, escala, escalaResumo, textos]) {
    if (r.error) throw r.error;
  }

  const listaPerguntas = (perguntas.data ?? []) as Question[];
  const ids = listaPerguntas.map((q) => q.id);

  const [opcoes, gabaritos] = await Promise.all([
    ids.length
      ? supabase
          .from('question_options')
          .select('*')
          .in('question_id', ids)
          .order('position', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase.from('question_answer_keys').select('*').in('question_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (opcoes.error) throw opcoes.error;
  if (gabaritos.error) throw gabaritos.error;

  return {
    overview: ov,
    questions: listaPerguntas,
    options: agrupar((opcoes.data ?? []) as QuestionOption[], (o) => o.question_id),
    answerKeys: indexar((gabaritos.data ?? []) as AnswerKey[], (k) => k.question_id),
    progress: indexar((progresso.data ?? []) as QuestionProgress[], (p) => p.question_id),
    wordCloud: agrupar((nuvem.data ?? []) as WordCloudRow[], (r) => r.question_id),
    optionResults: agrupar((opcoesResultado.data ?? []) as OptionResultRow[], (r) => r.question_id),
    booleanResults: indexar((booleanos.data ?? []) as BooleanResultRow[], (r) => r.question_id),
    scaleResults: agrupar((escala.data ?? []) as ScaleResultRow[], (r) => r.question_id),
    scaleSummary: indexar((escalaResumo.data ?? []) as ScaleSummaryRow[], (r) => r.question_id),
    openText: agrupar((textos.data ?? []) as OpenTextRow[], (r) => r.question_id),
  };
}

/**
 * Carrega tudo o que as telas do apresentador precisam e recarrega quando
 * qualquer coisa muda no banco.
 *
 * Recarregar tudo a cada mudança é deliberado: uma sala tem dezenas de
 * respostas, não milhares. Aplicar deltas por evento seria mais rápido e muito
 * mais fácil de deixar dessincronizado no meio da reunião.
 *
 * O debounce agrupa a rajada de eventos de uma mesma transação (a resposta e
 * as alternativas escolhidas chegam separadas) numa recarga só.
 */
export function useSessionData(
  sessionId: string | undefined,
  { live = true }: { live?: boolean } = {},
) {
  const [data, setData] = useState<SessionData>(VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const vivo = useRef(true);

  const recarregar = useCallback(async () => {
    if (!sessionId) return;
    try {
      const proximo = await carregar(sessionId);
      if (vivo.current) {
        setData(proximo);
        setErro(null);
      }
    } catch (e) {
      if (vivo.current) setErro(mensagemDeErro(e));
    } finally {
      if (vivo.current) setCarregando(false);
    }
  }, [sessionId]);

  const agendarRecarga = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void recarregar();
    }, 250);
  }, [recarregar]);

  useEffect(() => {
    vivo.current = true;
    setCarregando(true);
    void recarregar();
    return () => {
      vivo.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [recarregar]);

  useEffect(() => {
    if (!sessionId || !live) return;
    const eventId = data.overview?.event_id;

    const canal = supabase.channel(`pulso-apresentador-${sessionId}`);

    canal.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'responses', filter: `session_id=eq.${sessionId}` },
      agendarRecarga,
    );
    canal.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'participants', filter: `session_id=eq.${sessionId}` },
      agendarRecarga,
    );
    canal.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
      agendarRecarga,
    );
    if (eventId) {
      canal.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'questions', filter: `event_id=eq.${eventId}` },
        agendarRecarga,
      );
    }

    // Mesma rede de segurança do participante: o telão pode ficar horas aberto
    // num segundo monitor, e o websocket cai sem avisar quando a máquina
    // suspende ou a rede oscila.
    canal.subscribe((estado) => {
      if (estado === 'SUBSCRIBED' || estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
        agendarRecarga();
      }
    });

    const aoVoltar = () => {
      if (document.visibilityState === 'visible') agendarRecarga();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', aoVoltar);
    const intervalo = window.setInterval(agendarRecarga, 8000);

    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', aoVoltar);
      window.clearInterval(intervalo);
      void supabase.removeChannel(canal);
    };
  }, [sessionId, data.overview?.event_id, agendarRecarga, live]);

  return { data, carregando, erro, recarregar };
}

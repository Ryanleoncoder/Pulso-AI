export type QuestionType =
  | 'word_cloud'
  | 'single_choice'
  | 'multiple_choice'
  | 'boolean'
  | 'scale'
  | 'open_text'
  | 'swipe_card';

export type QuestionPhase = 'pre' | 'live' | 'post';
export type QuestionStatus = 'draft' | 'open' | 'closed';
export type SessionStatus = 'draft' | 'waiting' | 'live' | 'finished';

export interface QuestionConfig {
  max_chars?: number;
  max_words?: number;
  /** nuvem de palavras: quantas entradas cada pessoa pode mandar */
  max_entries?: number;
  max_selections?: number;
  min?: number;
  max?: number;
  min_label?: string;
  max_label?: string;
  yes_label?: string;
  no_label?: string;
  compare_with_position?: number;
  /** swipe_card: rótulo do lado direito (aprovar) */
  right_label?: string;
  /** swipe_card: rótulo do lado esquerdo (rejeitar) */
  left_label?: string;
}

export interface Question {
  id: string;
  event_id: string;
  type: QuestionType;
  phase: QuestionPhase;
  prompt: string;
  description: string | null;
  position: number;
  status: QuestionStatus;
  results_visible: boolean;
  config: QuestionConfig;
}

export interface QuestionOption {
  id: string;
  question_id: string;
  label: string;
  /** swipe_card: descrição detalhada do card */
  description: string | null;
  position: number;
}

export interface AnswerKey {
  question_id: string;
  correct_option_ids: string[];
  correct_boolean: boolean | null;
  explanation: string | null;
}

/** Retorno de rpc('join_session'). */
export interface JoinResult {
  session_id: string;
  event_id: string;
  event_title: string;
  event_description: string | null;
  status: SessionStatus;
  active_question_id: string | null;
  participant_id: string;
}

export interface SessionOverview {
  session_id: string;
  event_id: string;
  event_title: string;
  access_code: string;
  status: SessionStatus;
  active_question_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  /** todo mundo que já entrou nesta sessão; nunca diminui */
  participants: number;
  /** deu sinal de vida nos últimos 90 s — é quem está na sala agora */
  participants_online: number;
  answers: number;
}

export interface QuestionProgress {
  session_id: string;
  question_id: string;
  position: number;
  phase: QuestionPhase;
  type: QuestionType;
  prompt: string;
  status: QuestionStatus;
  results_visible: boolean;
  answers: number;
  hidden_answers: number;
}

export interface WordCloudRow {
  session_id: string;
  question_id: string;
  term: string;
  sample_text: string;
  weight: number;
}

export interface OptionResultRow {
  session_id: string;
  question_id: string;
  option_id: string;
  label: string;
  position: number;
  votes: number;
}

export interface BooleanResultRow {
  session_id: string;
  question_id: string;
  yes_count: number;
  no_count: number;
  total: number;
}

export interface ScaleResultRow {
  session_id: string;
  question_id: string;
  value: number;
  total: number;
}

export interface ScaleSummaryRow {
  session_id: string;
  question_id: string;
  average: number;
  total: number;
}

export interface OpenTextRow {
  response_id: string;
  session_id: string;
  question_id: string;
  answer_text: string;
  is_hidden: boolean;
  created_at: string;
}

export interface ExportRow {
  session_id: string;
  access_code: string;
  event_title: string;
  question_position: number;
  phase: QuestionPhase;
  question_type: QuestionType;
  prompt: string;
  respondent_ref: string;
  answer: string | null;
  normalized_text: string | null;
  is_hidden: boolean;
  created_at: string;
}

export interface SwipeResultRow {
  session_id: string;
  question_id: string;
  option_id: string;
  label: string;
  description: string | null;
  position: number;
  approved: number;
  total_respondents: number;
  correct_answer_is_right: boolean | null;
}

export const NOME_DO_TIPO: Record<QuestionType, string> = {
  word_cloud: 'Nuvem de palavras',
  single_choice: 'Escolha única',
  multiple_choice: 'Múltipla escolha',
  boolean: 'Sim ou não',
  scale: 'Escala',
  open_text: 'Texto aberto',
  swipe_card: 'Cards (swipe)',
};

export const NOME_DA_FASE: Record<QuestionPhase, string> = {
  pre: 'Abertura',
  live: 'Ao vivo',
  post: 'Encerramento',
};

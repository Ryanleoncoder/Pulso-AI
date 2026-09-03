import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** false = falta o .env. A UI mostra a tela de configuração em vez de quebrar. */
export const configurado = Boolean(url && anonKey);

/**
 * Usuário do apresentador — um nome, não um e-mail.
 *
 * O Supabase Auth exige e-mail ou telefone como identificador, então montamos um
 * endereço sintético no domínio reservado `.local`: `apresentador@pulso.local`.
 * Ele nunca recebe mensagem e não é o e-mail de ninguém. Nenhum dado pessoal
 * entra aqui.
 *
 * A senha continua verificada com bcrypt pelo próprio Supabase Auth — não
 * escrevemos criptografia nossa. O nome do usuário não é segredo; a senha é.
 */
export const DOMINIO_INTERNO = 'pulso.local';

export const USUARIO_APRESENTADOR =
  import.meta.env.VITE_PRESENTER_USER || 'apresentador';

export const loginDoApresentador = () => `${USUARIO_APRESENTADOR}@${DOMINIO_INTERNO}`;

// Um único cliente para as quatro telas. O participante entra com
// signInAnonymously(); o apresentador com a senha. Quem já está logado como
// apresentador também consegue entrar como participante (join_session aceita
// qualquer usuário autenticado) — útil para testar numa máquina só.
export const supabase: SupabaseClient = createClient(
  url || 'http://localhost:54321',
  anonKey || 'chave-ausente',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'pulso-ia-auth',
    },
  },
);

/** Mensagem de erro legível a partir do que o Postgres/PostgREST devolveu. */
export function mensagemDeErro(err: unknown): string {
  if (!err) return 'Erro desconhecido.';
  const e = err as { code?: string; message?: string; details?: string };

  // unique_violation em (question_id, participant_id)
  if (e.code === '23505') return 'Você já respondeu esta pergunta.';
  if (e.message === 'Invalid login credentials') return 'Senha incorreta.';
  if (e.code === '42501') return e.message ?? 'Sem permissão para esta ação.';
  if (e.message) return e.message;
  return e.details ?? 'Erro desconhecido.';
}

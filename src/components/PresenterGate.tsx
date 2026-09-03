import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  USUARIO_APRESENTADOR,
  loginDoApresentador,
  supabase,
  mensagemDeErro,
} from '../lib/supabase';

interface Props {
  children: ReactNode;
}

function ehAnonimo(session: Session | null): boolean {
  if (!session) return false;
  const user = session.user as { is_anonymous?: boolean };
  return user.is_anonymous === true;
}

/**
 * As telas de apresentação, controle e resultados leem `responses`, e a RLS só
 * libera isso para o dono do evento. Então elas exigem login de verdade —
 * usuário anônimo é bloqueado aqui com opção de sair e logar.
 */
export function PresenterGate({ children }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Só senha. O identificador é o usuário fixo (VITE_PRESENTER_USER), que não é
  // segredo — e a senha continua verificada com bcrypt pelo Supabase Auth.
  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginDoApresentador(),
      password: senha,
    });
    if (error) setErro(mensagemDeErro(error));
    setEnviando(false);
  }

  if (carregando) {
    return (
      <div className="shell shell--narrow">
        <p className="muted">Carregando…</p>
      </div>
    );
  }

  if (session && ehAnonimo(session)) {
    return (
      <div className="shell shell--narrow">
        <div className="card stack">
          <h1>Você está como participante</h1>
          <p className="secondary">
            Este navegador tem uma sessão anônima ativa. As telas do apresentador precisam
            de login. Saia da sessão anônima para continuar.
          </p>
          <button
            className="btn-primary"
            onClick={async () => {
              await supabase.auth.signOut();
            }}
          >
            Sair da sessão anônima
          </button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="shell shell--narrow">
        <form className="card stack" onSubmit={entrar}>
          <div className="stack stack--tight">
            <span className="eyebrow">Pulso IA</span>
            <h1>Entrar como apresentador</h1>
          </div>
          {erro && <div className="alert">{erro}</div>}
          <label className="stack stack--tight">
            <span className="muted">Usuário</span>
            <input type="text" value={USUARIO_APRESENTADOR} readOnly tabIndex={-1} />
          </label>
          <label className="stack stack--tight">
            <span className="muted">Senha</span>
            <input
              type="password"
              value={senha}
              autoComplete="current-password"
              autoFocus
              required
              onChange={(e) => setSenha(e.target.value)}
            />
          </label>
          <button className="btn-primary" type="submit" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}

export function BotaoSair() {
  return (
    <button
      className="btn-small no-print"
      onClick={async () => {
        await supabase.auth.signOut();
      }}
    >
      Sair
    </button>
  );
}

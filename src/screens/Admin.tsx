import { useEffect, useState } from 'react';
import { LinkButton } from '../lib/router';
import { BotaoSair, PresenterGate } from '../components/PresenterGate';
import { mensagemDeErro, supabase } from '../lib/supabase';
import type { SessionOverview } from '../lib/types';

export function Admin() {
  return (
    <PresenterGate>
      <Lista />
    </PresenterGate>
  );
}

function Lista() {
  const [sessoes, setSessoes] = useState<SessionOverview[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancelado = false;

    async function carregar() {
      const { data, error } = await supabase
        .from('v_session_overview')
        .select('*')
        .order('started_at', { ascending: false, nullsFirst: true });

      if (cancelado) return;
      if (error) setErro(mensagemDeErro(error));
      else setSessoes((data ?? []) as SessionOverview[]);
      setCarregando(false);
    }

    void carregar();

    // Contadores de participante e resposta atualizam sozinhos nesta lista.
    const canal = supabase.channel('pulso-admin-sessoes');
    for (const tabela of ['sessions', 'participants', 'responses'] as const) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabela }, () =>
        void carregar(),
      );
    }
    canal.subscribe();

    return () => {
      cancelado = true;
      void supabase.removeChannel(canal);
    };
  }, []);

  return (
    <div className="shell">
      <div className="row row--between">
        <div className="stack stack--tight">
          <span className="eyebrow">Pulso IA</span>
          <h1 style={{ fontSize: 26 }}>Suas sessões</h1>
        </div>
        <BotaoSair />
      </div>

      {erro && <div className="alert">{erro}</div>}
      {carregando && <p className="muted">Carregando…</p>}

      {!carregando && sessoes.length === 0 && (
        <div className="card stack">
          <strong>Nenhuma sessão ainda</strong>
          <span className="muted">
            Rode <code>supabase/seed.sql</code> no SQL Editor para criar o evento e a sessão.
          </span>
        </div>
      )}

      <div className="qlist">
        {sessoes.map((s) => (
          <div key={s.session_id} className="qitem">
            <div className="qitem__body">
              <span className="qitem__prompt">{s.event_title}</span>
              <div className="row">
                <span className={s.status === 'live' ? 'pill pill--live' : 'pill'}>{s.status}</span>
                <span className="pill">código {s.access_code}</span>
                <span className="muted">
                  {s.participants_online} na sala · {s.participants} entraram ·{' '}
                  {s.answers} respostas
                </span>
              </div>
            </div>
            <div className="row">
              <LinkButton className="btn-small btn-primary" to={`/c/${s.session_id}`}>
                Controle
              </LinkButton>
              <LinkButton className="btn-small" to={`/p/${s.session_id}`} blank>
                Telão
              </LinkButton>
              <LinkButton className="btn-small" to={`/r/${s.session_id}`}>
                Resultados
              </LinkButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { LinkButton, useParams } from '../lib/router';
import { BotaoSair, PresenterGate } from '../components/PresenterGate';
import { QuestionForm } from '../components/QuestionForm';
import { useSessionData, type SessionData } from '../lib/sessionData';
import { mensagemDeErro, supabase } from '../lib/supabase';
import { NOME_DA_FASE, NOME_DO_TIPO, type Question } from '../lib/types';

export function Control() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <PresenterGate>
      <Painel sessionId={sessionId} />
    </PresenterGate>
  );
}

function Painel({ sessionId }: { sessionId: string | undefined }) {
  const { data, carregando, erro, recarregar } = useSessionData(sessionId);
  const [acaoErro, setAcaoErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [zerando, setZerando] = useState(false);
  const [modalZerarAberto, setModalZerarAberto] = useState(false);
  const [codigoConfirmacao, setCodigoConfirmacao] = useState('');
  const [editando, setEditando] = useState(false);
  const [emEdicao, setEmEdicao] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);

  const overview = data.overview;

  // PromiseLike e não Promise: o builder do PostgREST é thenable, não Promise.
  async function acao(fn: () => PromiseLike<{ error: unknown }>) {
    setOcupado(true);
    setAcaoErro(null);
    const { error } = await fn();
    if (error) setAcaoErro(mensagemDeErro(error));
    await recarregar();
    setOcupado(false);
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
        <p className="muted">Carregando o controle…</p>
      </div>
    );
  }

  const ativa = data.questions.find((q) => q.id === overview.active_question_id) ?? null;
  const indiceAtivo = ativa ? data.questions.findIndex((q) => q.id === ativa.id) : -1;
  const anterior = indiceAtivo > 0 ? data.questions[indiceAtivo - 1] : null;
  const proxima =
    indiceAtivo >= 0 && indiceAtivo < data.questions.length - 1
      ? data.questions[indiceAtivo + 1]
      : data.questions[0] ?? null;

  const abrir = (q: Question) =>
    acao(() =>
      supabase.rpc('open_question', { p_session_id: overview.session_id, p_question_id: q.id }),
    );

  const encerrar = (q: Question) => acao(() => supabase.rpc('close_question', { p_question_id: q.id }));

  const revelar = (q: Question, visivel: boolean) =>
    acao(() => supabase.rpc('set_results_visible', { p_question_id: q.id, p_visible: visivel }));

  const temGabarito = (q: Question) => {
    const ak = data.answerKeys[q.id];
    if (!ak) return false;
    if (ak.correct_boolean !== null && ak.correct_boolean !== undefined) return true;
    if (ak.correct_option_ids && ak.correct_option_ids.length > 0) return true;
    return false;
  };

  return (
    <div className="shell">
      <div className="row row--between">
        <div className="stack stack--tight">
          <span className="eyebrow">Controle · {overview.event_title}</span>
          <div className="row">
            <span className={overview.status === 'live' ? 'pill pill--live' : 'pill'}>
              {overview.status}
            </span>
            <span className="pill">código {overview.access_code}</span>
            <span className="pill pill--live">
              {overview.participants_online} na sala agora
            </span>
            <span className="pill" title="Total de quem já entrou; nunca diminui">
              {overview.participants} entraram
            </span>
          </div>
        </div>
        <div className="row">
          <LinkButton className="btn-small" to={`/p/${overview.session_id}`} blank>
            Abrir telão
          </LinkButton>
          <LinkButton className="btn-small" to={`/r/${overview.session_id}`} blank>
            Resultados
          </LinkButton>
          <BotaoSair />
        </div>
      </div>

      {acaoErro && <div className="alert">{acaoErro}</div>}

      {/* ---------------------------------------------------- navegação ---- */}
      <div className="card stack">
        <div className="row row--between" style={{ gap: 16 }}>
          <div className="stack stack--tight grow">
            <span className="eyebrow">Pergunta na tela</span>
            <strong style={{ fontSize: 18, lineHeight: 1.3 }}>
              {ativa ? `${ativa.position}. ${ativa.prompt}` : 'Nenhuma — o telão mostra o QR Code'}
            </strong>
          </div>

          {/* Seletor direto para ir para qualquer pergunta instantaneamente */}
          <div className="row" style={{ minWidth: 260 }}>
            <select
              id="select-pergunta"
              style={{ minHeight: 42, padding: '6px 12px', fontSize: 14, fontWeight: 550 }}
              value={ativa?.id ?? ''}
              onChange={(e) => {
                const targetId = e.target.value;
                if (!targetId) return;
                const selectedQ = data.questions.find((q) => q.id === targetId);
                if (selectedQ) void abrir(selectedQ);
              }}
              disabled={ocupado}
              aria-label="Ir direto para pergunta"
            >
              <option value="">-- Ir direto para pergunta --</option>
              {data.questions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.position}. {q.prompt.slice(0, 45)}... ({NOME_DO_TIPO[q.type]}
                  {temGabarito(q) ? ' · 🎯 Gabarito' : ''})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row">
          <button disabled={ocupado || !anterior} onClick={() => anterior && void abrir(anterior)}>
            ← Anterior
          </button>
          <button
            className="btn-primary"
            disabled={ocupado || !proxima}
            onClick={() => proxima && void abrir(proxima)}
          >
            {ativa ? 'Próxima →' : 'Começar →'}
          </button>

          <div className="grow" />

          {ativa && (
            <>
              <button
                disabled={ocupado || ativa.status !== 'open'}
                onClick={() => void encerrar(ativa)}
              >
                Encerrar respostas
              </button>
              <button
                className={ativa.results_visible ? '' : 'btn-primary'}
                disabled={ocupado}
                onClick={() => void revelar(ativa, !ativa.results_visible)}
              >
                {ativa.results_visible
                  ? 'Ocultar resultado'
                  : temGabarito(ativa)
                  ? 'Revelar gabarito 🎯'
                  : 'Revelar resultado 📊'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* --------------------------------------------------- moderação ----- */}
      {ativa && (ativa.type === 'word_cloud' || ativa.type === 'open_text') && (
        <Moderacao pergunta={ativa} data={data} onMudou={recarregar} />
      )}

      {/* ------------------------------------------------ lista completa --- */}
      <div className="stack">
        <div className="row row--between">
          <span className="eyebrow">Roteiro (clique em qualquer pergunta para mostrar)</span>
          <button
            className="btn-small"
            onClick={() => {
              setEditando(!editando);
              setEmEdicao(null);
              setAdicionando(false);
            }}
          >
            {editando ? 'Concluir edição' : 'Editar roteiro'}
          </button>
        </div>

        <div className="qlist">
          {data.questions.map((q) => {
            const p = data.progress[q.id];
            const eAtiva = q.id === overview.active_question_id;
            const temRespostas = (p?.answers ?? 0) + (p?.hidden_answers ?? 0) > 0;
            const possuiGabarito = temGabarito(q);

            if (emEdicao === q.id) {
              return (
                <QuestionForm
                  key={q.id}
                  eventId={overview.event_id}
                  question={q}
                  options={data.options[q.id] ?? []}
                  answerKey={data.answerKeys[q.id]}
                  temRespostas={temRespostas}
                  onCancelar={() => setEmEdicao(null)}
                  onSalvo={() => {
                    setEmEdicao(null);
                    void recarregar();
                  }}
                />
              );
            }

            return (
              <div
                key={q.id}
                className={eAtiva ? 'qitem qitem--active' : 'qitem'}
                style={{ cursor: editando ? 'default' : 'pointer' }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return;
                  if (!editando && !eAtiva && !ocupado) void abrir(q);
                }}
              >
                <span className="qitem__num">{q.position}</span>
                <div className="qitem__body">
                  <span className="qitem__prompt">{q.prompt}</span>
                  <div className="row">
                    <span className="pill">{NOME_DO_TIPO[q.type]}</span>
                    <span className="pill">{NOME_DA_FASE[q.phase]}</span>
                    {possuiGabarito ? (
                      <span className="pill pill--live" title="Esta pergunta tem resposta certa no gabarito">
                        🎯 Tem gabarito
                      </span>
                    ) : (
                      <span className="pill" title="Pesquisa de opinião sem resposta certa/errada">
                        📊 Opinião
                      </span>
                    )}
                    <span className="pill">{q.status}</span>
                    {q.results_visible && <span className="pill">resultado à vista</span>}
                    <span className="muted">
                      {p?.answers ?? 0} respostas
                      {(p?.hidden_answers ?? 0) > 0 && ` · ${p?.hidden_answers} ocultas`}
                    </span>
                  </div>
                </div>

                <div className="row">
                  {editando ? (
                    <>
                      <button
                        className="btn-small"
                        disabled={ocupado}
                        title="Subir no roteiro"
                        onClick={() =>
                          void acao(() =>
                            supabase.rpc('move_question', {
                              p_question_id: q.id,
                              p_delta: -1,
                            }),
                          )
                        }
                      >
                        ↑
                      </button>
                      <button
                        className="btn-small"
                        disabled={ocupado}
                        title="Descer no roteiro"
                        onClick={() =>
                          void acao(() =>
                            supabase.rpc('move_question', {
                              p_question_id: q.id,
                              p_delta: 1,
                            }),
                          )
                        }
                      >
                        ↓
                      </button>
                      <button className="btn-small" onClick={() => setEmEdicao(q.id)}>
                        Editar
                      </button>
                      <button
                        className="btn-small btn-danger"
                        disabled={ocupado || temRespostas}
                        title={
                          temRespostas
                            ? 'Já tem resposta — apagar destruiria a evidência'
                            : 'Apagar pergunta'
                        }
                        onClick={() => {
                          if (!window.confirm(`Apagar a pergunta "${q.prompt}"?`)) return;
                          void acao(() =>
                            supabase.rpc('delete_question', { p_question_id: q.id }),
                          );
                        }}
                      >
                        Apagar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={eAtiva ? 'btn-small' : 'btn-small btn-primary'}
                        disabled={ocupado || eAtiva}
                        onClick={() => void abrir(q)}
                      >
                        {eAtiva ? 'No ar' : 'Abrir no telão'}
                      </button>
                      <button
                        className="btn-small"
                        disabled={ocupado}
                        onClick={() => void revelar(q, !q.results_visible)}
                      >
                        {q.results_visible
                          ? 'Ocultar'
                          : possuiGabarito
                          ? 'Revelar gabarito 🎯'
                          : 'Revelar 📊'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {editando &&
          (adicionando ? (
            <QuestionForm
              eventId={overview.event_id}
              temRespostas={false}
              onCancelar={() => setAdicionando(false)}
              onSalvo={() => {
                setAdicionando(false);
                void recarregar();
              }}
            />
          ) : (
            <button className="btn-primary" onClick={() => setAdicionando(true)}>
              + Adicionar pergunta
            </button>
          ))}
      </div>

      {/* ---------------------------------------------------- encerrar ----- */}
      <div className="card row row--between">
        {overview.status === 'finished' ? (
          <>
            <div className="stack stack--tight">
              <strong>Sessão encerrada</strong>
              <span className="muted">
                Ninguém consegue entrar nem responder. Reabrir volta a sessão para a tela de
                espera com o QR Code, sem apagar nenhuma resposta.
              </span>
            </div>
            <button
              className="btn-primary"
              disabled={ocupado}
              onClick={() =>
                void acao(() =>
                  supabase.rpc('reopen_session', { p_session_id: overview.session_id }),
                )
              }
            >
              Reabrir sessão
            </button>
          </>
        ) : (
          <>
            <div className="stack stack--tight">
              <strong>Encerrar a sessão</strong>
              <span className="muted">
                Fecha todas as perguntas e bloqueia novas respostas. Os resultados continuam
                disponíveis na tela de evidências, e dá para reabrir depois.
              </span>
            </div>
            <button
              className="btn-danger"
              disabled={ocupado}
              onClick={() => {
                if (!window.confirm('Encerrar a sessão? Ninguém mais consegue responder.')) return;
                void acao(() =>
                  supabase.rpc('finish_session', { p_session_id: overview.session_id }),
                );
              }}
            >
              Encerrar sessão
            </button>
          </>
        )}
      </div>

      {/* ------------------------------------------------------ zerar ------ */}
      <div className="card row row--between">
        <div className="stack stack--tight">
          <strong>Zerar a sessão</strong>
          <span className="muted">
            Apaga <strong>todas</strong> as respostas e participantes, e devolve as perguntas
            ao início. É para limpar os testes antes da reunião de verdade. Não dá para
            desfazer — exporte o CSV antes se quiser guardar o que já foi respondido.
          </span>
        </div>
        <button
          className="btn-danger"
          disabled={ocupado || zerando}
          onClick={() => {
            setCodigoConfirmacao('');
            setModalZerarAberto(true);
          }}
        >
          Zerar sessão
        </button>
      </div>

      {/* Modal de confirmação personalizado para zerar a sessão */}
      {modalZerarAberto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 16,
          }}
          onClick={() => setModalZerarAberto(false)}
        >
          <div
            className="card stack shell--narrow"
            style={{ width: '100%', maxWidth: 440, background: 'var(--surface-1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="stack stack--tight">
              <span className="eyebrow" style={{ color: 'var(--critical)' }}>⚠️ Ação Irreversível</span>
              <h2>Zerar a sessão?</h2>
              <p className="secondary" style={{ fontSize: 14 }}>
                Isto apaga <strong>{overview.answers} resposta(s)</strong> e <strong>{overview.participants} participante(s)</strong>, devolvendo a sessão ao início.
              </p>
            </div>

            <div className="stack stack--tight">
              <label htmlFor="confirm-code-input" className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
                Para confirmar, digite o código <strong>{overview.access_code}</strong>:
              </label>
              <input
                id="confirm-code-input"
                className="code-input"
                type="text"
                autoFocus
                maxLength={6}
                value={codigoConfirmacao}
                onChange={(e) => setCodigoConfirmacao(e.target.value.toUpperCase())}
                placeholder={overview.access_code}
              />
            </div>

            <div className="row row--between" style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setModalZerarAberto(false)}
                disabled={zerando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={codigoConfirmacao !== overview.access_code || zerando}
                onClick={() => {
                  setZerando(true);
                  void acao(async () => {
                    const r = await supabase.rpc('reset_session', {
                      p_session_id: overview.session_id,
                      p_confirm_code: codigoConfirmacao,
                    });
                    setZerando(false);
                    setModalZerarAberto(false);
                    return r;
                  });
                }}
              >
                {zerando ? 'Zerando…' : 'Sim, Zerar Sessão'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Moderacao({
  pergunta,
  data,
  onMudou,
}: {
  pergunta: Question;
  data: SessionData;
  onMudou: () => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const respostas = data.openText[pergunta.id] ?? [];

  async function alternar(responseId: string, ocultar: boolean) {
    setOcupado(responseId);
    await supabase.rpc('set_response_hidden', {
      p_response_id: responseId,
      p_hidden: ocultar,
      p_reason: ocultar ? 'conteúdo inadequado' : null,
    });
    onMudou();
    setOcupado(null);
  }

  return (
    <div className="card stack">
      <div className="row row--between">
        <span className="eyebrow">Moderação</span>
        <span className="muted">
          Ocultar remove do telão na hora. A ação fica registrada em moderation_actions.
        </span>
      </div>

      {respostas.length === 0 && <p className="muted">Nenhuma resposta ainda.</p>}

      <div className="mod-list">
        {respostas.map((r) => (
          <div
            key={r.response_id}
            className={r.is_hidden ? 'mod-item mod-item--hidden' : 'mod-item'}
          >
            <span className="mod-item__text">{r.answer_text}</span>
            <button
              className="btn-small"
              disabled={ocupado === r.response_id}
              onClick={() => void alternar(r.response_id, !r.is_hidden)}
            >
              {r.is_hidden ? 'Reexibir' : 'Ocultar'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

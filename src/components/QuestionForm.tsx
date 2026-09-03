import { useState } from 'react';
import { mensagemDeErro, supabase } from '../lib/supabase';
import {
  NOME_DA_FASE,
  NOME_DO_TIPO,
  type AnswerKey,
  type Question,
  type QuestionConfig,
  type QuestionOption,
  type QuestionPhase,
  type QuestionType,
} from '../lib/types';

interface Props {
  eventId: string;
  /** presente = edição; ausente = nova pergunta */
  question?: Question;
  options?: QuestionOption[];
  answerKey?: AnswerKey;
  /** já tem resposta gravada: trava o que destruiria evidência */
  temRespostas: boolean;
  onSalvo: () => void;
  onCancelar: () => void;
}

const TIPOS: QuestionType[] = [
  'word_cloud',
  'single_choice',
  'multiple_choice',
  'boolean',
  'scale',
  'open_text',
];

const FASES: QuestionPhase[] = ['pre', 'live', 'post'];

const ehEscolha = (t: QuestionType) => t === 'single_choice' || t === 'multiple_choice';

function configPadrao(tipo: QuestionType): QuestionConfig {
  switch (tipo) {
    case 'word_cloud':
      return { max_chars: 30, max_words: 3, max_entries: 3 };
    case 'open_text':
      return { max_chars: 280 };
    case 'scale':
      return { min: 1, max: 5, min_label: 'Discordo', max_label: 'Concordo' };
    case 'multiple_choice':
      return { max_selections: 2 };
    case 'boolean':
      return { yes_label: 'Sim', no_label: 'Não' };
    default:
      return {};
  }
}

export function QuestionForm({
  eventId,
  question,
  options = [],
  answerKey,
  temRespostas,
  onSalvo,
  onCancelar,
}: Props) {
  const editando = Boolean(question);

  const [tipo, setTipo] = useState<QuestionType>(question?.type ?? 'word_cloud');
  const [fase, setFase] = useState<QuestionPhase>(question?.phase ?? 'live');
  const [enunciado, setEnunciado] = useState(question?.prompt ?? '');
  const [descricao, setDescricao] = useState(question?.description ?? '');
  const [config, setConfig] = useState<QuestionConfig>(
    question?.config ?? configPadrao(question?.type ?? 'word_cloud'),
  );
  const [alternativas, setAlternativas] = useState(options.map((o) => o.label).join('\n'));
  const [corretas, setCorretas] = useState<number[]>(() => {
    const ids = answerKey?.correct_option_ids ?? [];
    return options.map((o, i) => (ids.includes(o.id) ? i + 1 : 0)).filter((n) => n > 0);
  });
  const [corretoBooleano, setCorretoBooleano] = useState<boolean | null>(
    answerKey?.correct_boolean ?? null,
  );
  const [explicacao, setExplicacao] = useState(answerKey?.explanation ?? '');

  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const labels = alternativas
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  function trocarTipo(novo: QuestionType) {
    setTipo(novo);
    setConfig(configPadrao(novo));
    setCorretas([]);
    setCorretoBooleano(null);
  }

  function alternarCorreta(indice1: number) {
    setCorretas((atual) => {
      if (atual.includes(indice1)) return atual.filter((n) => n !== indice1);
      if (tipo === 'single_choice') return [indice1];
      return [...atual, indice1];
    });
  }

  async function salvar() {
    setErro(null);

    if (!enunciado.trim()) {
      setErro('Escreva o enunciado da pergunta.');
      return;
    }
    if (ehEscolha(tipo) && labels.length < 2) {
      setErro('Uma pergunta de escolha precisa de pelo menos duas alternativas.');
      return;
    }

    setSalvando(true);

    try {
      if (!editando) {
        const { error } = await supabase.rpc('create_question', {
          p_event_id: eventId,
          p_type: tipo,
          p_prompt: enunciado.trim(),
          p_phase: fase,
          p_description: descricao.trim() || null,
          p_config: config,
          p_options: ehEscolha(tipo) ? labels : null,
          p_correct_indexes: ehEscolha(tipo) && corretas.length ? corretas : null,
          p_correct_boolean: tipo === 'boolean' ? corretoBooleano : null,
          p_explanation: explicacao.trim() || null,
        });
        if (error) throw error;
      } else {
        const q = question!;

        const { error: erroUpdate } = await supabase
          .from('questions')
          .update({
            type: temRespostas ? q.type : tipo,
            phase: fase,
            prompt: enunciado.trim(),
            description: descricao.trim() || null,
            config,
          })
          .eq('id', q.id);
        if (erroUpdate) throw erroUpdate;

        // Trocar o conjunto de alternativas apagaria os votos em cascata, então
        // só acontece enquanto a pergunta não tem resposta.
        if (ehEscolha(tipo) && !temRespostas) {
          const { error } = await supabase.rpc('replace_question_options', {
            p_question_id: q.id,
            p_labels: labels,
            p_correct_indexes: corretas.length ? corretas : null,
          });
          if (error) throw error;
        } else if (ehEscolha(tipo) && temRespostas) {
          // Só o gabarito, apontando para as alternativas que já existem.
          const ids = corretas.map((n) => options[n - 1]?.id).filter(Boolean) as string[];
          const { error } = await supabase.from('question_answer_keys').upsert({
            question_id: q.id,
            correct_option_ids: ids,
            explanation: explicacao.trim() || null,
          });
          if (error) throw error;
        }

        if (tipo === 'boolean' || explicacao.trim()) {
          const { error } = await supabase.from('question_answer_keys').upsert({
            question_id: q.id,
            correct_boolean: tipo === 'boolean' ? corretoBooleano : null,
            correct_option_ids: answerKey?.correct_option_ids ?? [],
            explanation: explicacao.trim() || null,
          });
          if (error) throw error;
        }
      }

      onSalvo();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card stack">
      <div className="row row--between">
        <strong>{editando ? `Editar pergunta ${question!.position}` : 'Nova pergunta'}</strong>
        <button className="btn-small" onClick={onCancelar}>
          Cancelar
        </button>
      </div>

      {erro && <div className="alert">{erro}</div>}

      {temRespostas && (
        <div className="alert">
          Esta pergunta já tem resposta. Você pode ajustar enunciado, descrição e explicação —
          mas não trocar o tipo nem o conjunto de alternativas, porque isso apagaria os votos
          já registrados.
        </div>
      )}

      <div className="row">
        <label className="stack stack--tight grow">
          <span className="muted">Tipo</span>
          <select
            value={tipo}
            disabled={editando && temRespostas}
            onChange={(e) => trocarTipo(e.target.value as QuestionType)}
            style={{ minHeight: 44, padding: '10px 12px' }}
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {NOME_DO_TIPO[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="stack stack--tight grow">
          <span className="muted">Momento</span>
          <select
            value={fase}
            onChange={(e) => setFase(e.target.value as QuestionPhase)}
            style={{ minHeight: 44, padding: '10px 12px' }}
          >
            {FASES.map((f) => (
              <option key={f} value={f}>
                {NOME_DA_FASE[f]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="stack stack--tight">
        <span className="muted">Enunciado</span>
        <input type="text" value={enunciado} onChange={(e) => setEnunciado(e.target.value)} />
      </label>

      <label className="stack stack--tight">
        <span className="muted">Descrição (opcional)</span>
        <input type="text" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </label>

      {/* ------------------------------------------------ config por tipo -- */}

      {tipo === 'word_cloud' && (
        <div className="row">
          <label className="stack stack--tight grow">
            <span className="muted">Máximo de caracteres</span>
            <input
              type="text"
              inputMode="numeric"
              value={config.max_chars ?? 30}
              onChange={(e) =>
                setConfig({ ...config, max_chars: Number(e.target.value) || 30 })
              }
            />
          </label>
          <label className="stack stack--tight grow">
            <span className="muted">Palavras por resposta</span>
            <input
              type="text"
              inputMode="numeric"
              value={config.max_words ?? 3}
              onChange={(e) => setConfig({ ...config, max_words: Number(e.target.value) || 3 })}
            />
          </label>
          <label className="stack stack--tight grow">
            <span className="muted">Respostas por pessoa</span>
            <input
              type="text"
              inputMode="numeric"
              value={config.max_entries ?? 3}
              onChange={(e) => setConfig({ ...config, max_entries: Number(e.target.value) || 1 })}
            />
          </label>
        </div>
      )}

      {tipo === 'open_text' && (
        <label className="stack stack--tight">
          <span className="muted">Máximo de caracteres</span>
          <input
            type="text"
            inputMode="numeric"
            value={config.max_chars ?? 280}
            onChange={(e) => setConfig({ ...config, max_chars: Number(e.target.value) || 280 })}
          />
        </label>
      )}

      {tipo === 'scale' && (
        <>
          <div className="row">
            <label className="stack stack--tight grow">
              <span className="muted">De</span>
              <input
                type="text"
                inputMode="numeric"
                value={config.min ?? 1}
                onChange={(e) => setConfig({ ...config, min: Number(e.target.value) || 1 })}
              />
            </label>
            <label className="stack stack--tight grow">
              <span className="muted">Até</span>
              <input
                type="text"
                inputMode="numeric"
                value={config.max ?? 5}
                onChange={(e) => setConfig({ ...config, max: Number(e.target.value) || 5 })}
              />
            </label>
          </div>
          <div className="row">
            <label className="stack stack--tight grow">
              <span className="muted">Rótulo do menor</span>
              <input
                type="text"
                value={config.min_label ?? ''}
                onChange={(e) => setConfig({ ...config, min_label: e.target.value })}
              />
            </label>
            <label className="stack stack--tight grow">
              <span className="muted">Rótulo do maior</span>
              <input
                type="text"
                value={config.max_label ?? ''}
                onChange={(e) => setConfig({ ...config, max_label: e.target.value })}
              />
            </label>
          </div>
        </>
      )}

      {tipo === 'multiple_choice' && (
        <label className="stack stack--tight">
          <span className="muted">Quantas alternativas cada pessoa pode marcar</span>
          <input
            type="text"
            inputMode="numeric"
            value={config.max_selections ?? 2}
            onChange={(e) =>
              setConfig({ ...config, max_selections: Number(e.target.value) || 1 })
            }
          />
        </label>
      )}

      {ehEscolha(tipo) && (
        <div className="stack stack--tight">
          <span className="muted">Alternativas — uma por linha</span>
          <textarea
            value={alternativas}
            disabled={editando && temRespostas}
            placeholder={'Primeira alternativa\nSegunda alternativa'}
            onChange={(e) => setAlternativas(e.target.value)}
          />
          {labels.length > 0 && (
            <div className="stack stack--tight">
              <span className="muted">
                Resposta correta (opcional — deixe em branco se não houver)
              </span>
              {labels.map((l, i) => (
                <button
                  key={`${i}-${l}`}
                  type="button"
                  className="choice"
                  aria-pressed={corretas.includes(i + 1)}
                  onClick={() => alternarCorreta(i + 1)}
                >
                  <span className="choice__mark choice__mark--round" aria-hidden="true">
                    {corretas.includes(i + 1) ? '✓' : ''}
                  </span>
                  <span>{l}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tipo === 'boolean' && (
        <div className="stack stack--tight">
          <div className="row">
            <label className="stack stack--tight grow">
              <span className="muted">Rótulo do sim</span>
              <input
                type="text"
                value={config.yes_label ?? 'Sim'}
                onChange={(e) => setConfig({ ...config, yes_label: e.target.value })}
              />
            </label>
            <label className="stack stack--tight grow">
              <span className="muted">Rótulo do não</span>
              <input
                type="text"
                value={config.no_label ?? 'Não'}
                onChange={(e) => setConfig({ ...config, no_label: e.target.value })}
              />
            </label>
          </div>
          <span className="muted">Resposta correta (opcional)</span>
          <div className="row">
            {[
              { rotulo: config.yes_label ?? 'Sim', valor: true },
              { rotulo: config.no_label ?? 'Não', valor: false },
              { rotulo: 'Não tem resposta certa', valor: null },
            ].map((op) => (
              <button
                key={String(op.valor)}
                type="button"
                className="choice"
                aria-pressed={corretoBooleano === op.valor}
                onClick={() => setCorretoBooleano(op.valor)}
                style={{ justifyContent: 'center' }}
              >
                {op.rotulo}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="stack stack--tight">
        <span className="muted">
          Explicação — aparece no telão junto com o resultado, quando você revela
        </span>
        <textarea value={explicacao} onChange={(e) => setExplicacao(e.target.value)} />
      </label>

      <button className="btn-primary" disabled={salvando} onClick={() => void salvar()}>
        {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Adicionar ao roteiro'}
      </button>
    </div>
  );
}

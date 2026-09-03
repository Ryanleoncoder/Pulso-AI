import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuestionOption } from '../lib/types';

interface SwipeCardsProps {
  opcoes: QuestionOption[];
  rightLabel: string;
  leftLabel: string;
  onComplete: (approvedIds: string[]) => void;
}

/**
 * Cards estilo Tinder: arraste para direita (aprovar) ou esquerda (rejeitar).
 * Em desktop, botões de seta aparecem para quem não tem touch.
 *
 * Por baixo é só uma escolha binária por card. Os IDs dos cards arrastados
 * para a direita são enviados como `p_option_ids` no submit_response.
 */
export function SwipeCards({ opcoes, rightLabel, leftLabel, onComplete }: SwipeCardsProps) {
  const [indice, setIndice] = useState(0);
  const [aprovados, setAprovados] = useState<string[]>([]);
  const [direcao, setDirecao] = useState<'left' | 'right' | null>(null);
  const [saindo, setSaindo] = useState(false);
  const [arrasto, setArrasto] = useState({ x: 0, y: 0, arrastando: false });
  const [wiggle, setWiggle] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const inicioRef = useRef({ x: 0, y: 0, t: 0 });

  useEffect(() => {
    if (indice === 0) {
      setWiggle(true);
      const timer = setTimeout(() => setWiggle(false), 2400);
      return () => clearTimeout(timer);
    } else {
      setWiggle(false);
    }
  }, [indice]);

  const cardAtual = opcoes[indice] ?? null;
  const total = opcoes.length;
  const acabou = indice >= total;

  // Separar emoji do label: formato esperado "🔑 Senhas e tokens"
  const parseLabel = useCallback((label: string) => {
    const match = label.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*(.*)$/u);
    if (match) return { emoji: match[1], titulo: match[2] };
    return { emoji: '', titulo: label };
  }, []);

  const decidir = useCallback((dir: 'left' | 'right') => {
    if (saindo || acabou) return;
    setDirecao(dir);
    setSaindo(true);

    if (dir === 'right' && cardAtual) {
      setAprovados(prev => [...prev, cardAtual.id]);
    }

    setTimeout(() => {
      setIndice(prev => {
        const proximo = prev + 1;
        if (proximo >= total) {
          // Agendar callback para depois do render
          setTimeout(() => {
            onComplete(dir === 'right' && cardAtual
              ? [...aprovados, cardAtual.id]
              : aprovados);
          }, 0);
        }
        return proximo;
      });
      setDirecao(null);
      setSaindo(false);
      setArrasto({ x: 0, y: 0, arrastando: false });
    }, 350);
  }, [saindo, acabou, cardAtual, total, aprovados, onComplete]);

  // Completar quando acabar os cards
  useEffect(() => {
    if (acabou && indice === total) {
      onComplete(aprovados);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acabou]);

  // Touch/mouse handlers
  const onStart = useCallback((clientX: number, clientY: number) => {
    inicioRef.current = { x: clientX, y: clientY, t: Date.now() };
    setArrasto({ x: 0, y: 0, arrastando: true });
  }, []);

  const onMove = useCallback((clientX: number, clientY: number) => {
    if (!arrasto.arrastando) return;
    const dx = clientX - inicioRef.current.x;
    const dy = clientY - inicioRef.current.y;
    setArrasto({ x: dx, y: dy, arrastando: true });
  }, [arrasto.arrastando]);

  const onEnd = useCallback(() => {
    if (!arrasto.arrastando) return;
    const threshold = 80;
    if (arrasto.x > threshold) {
      decidir('right');
    } else if (arrasto.x < -threshold) {
      decidir('left');
    } else {
      setArrasto({ x: 0, y: 0, arrastando: false });
    }
  }, [arrasto, decidir]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') decidir('right');
      else if (e.key === 'ArrowLeft') decidir('left');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [decidir]);

  if (acabou) {
    return (
      <div className="swipe-done">
        <div className="swipe-done__icon">✓</div>
        <p>Todas as escolhas foram feitas!</p>
      </div>
    );
  }

  if (!cardAtual) return null;

  const { emoji, titulo } = parseLabel(cardAtual.label);
  const rotacao = saindo
    ? (direcao === 'right' ? 15 : -15)
    : (arrasto.x / 12);
  const deslocX = saindo
    ? (direcao === 'right' ? 600 : -600)
    : arrasto.x;
  const opacidade = saindo ? 0 : 1;

  // Indicadores visuais de direção durante o arrasto
  const intensidade = Math.min(Math.abs(arrasto.x) / 120, 1);
  const mostrarDireita = arrasto.x > 30 || direcao === 'right';
  const mostrarEsquerda = arrasto.x < -30 || direcao === 'left';

  return (
    <div className="swipe-container">
      {/* Indicador visual destacado para arrastar */}
      <div className="swipe-hint-badge">
        <span>👈 Arraste para o lado ou clique nos botões 👉</span>
      </div>

      {/* Contador */}
      <div className="swipe-counter">
        <span className="eyebrow">{indice + 1} de {total}</span>
      </div>

      {/* Labels de direção */}
      <div className="swipe-labels">
        <span
          className="swipe-label swipe-label--left"
          style={{ opacity: mostrarEsquerda ? intensidade : 0.7 }}
        >
          ✕ {leftLabel}
        </span>
        <span
          className="swipe-label swipe-label--right"
          style={{ opacity: mostrarDireita ? intensidade : 0.7 }}
        >
          ✓ {rightLabel}
        </span>
      </div>

      {/* Card */}
      <div
        className="swipe-stage"
        onTouchStart={(e) => onStart(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={(e) => onMove(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={onEnd}
        onMouseDown={(e) => { e.preventDefault(); onStart(e.clientX, e.clientY); }}
        onMouseMove={(e) => { if (arrasto.arrastando) onMove(e.clientX, e.clientY); }}
        onMouseUp={onEnd}
        onMouseLeave={() => { if (arrasto.arrastando) onEnd(); }}
      >
        {/* Seta indicadora esquerda */}
        <div className="swipe-side-arrow swipe-side-arrow--left">
          ‹
        </div>

        {/* Próximo card (preview atrás) */}
        {indice + 1 < total && (() => {
          const prox = opcoes[indice + 1];
          const { emoji: proxEmoji, titulo: proxTitulo } = parseLabel(prox.label);
          return (
            <div className="swipe-card swipe-card--next">
              {proxEmoji && <span className="swipe-card__emoji">{proxEmoji}</span>}
              <span className="swipe-card__titulo">{proxTitulo}</span>
            </div>
          );
        })()}

        <div
          ref={cardRef}
          className={`swipe-card ${wiggle ? 'swipe-card--hint' : ''} ${mostrarDireita ? 'swipe-card--approve' : ''} ${mostrarEsquerda ? 'swipe-card--reject' : ''}`}
          style={{
            transform: `translateX(${deslocX}px) rotate(${rotacao}deg)`,
            opacity: opacidade,
            transition: saindo ? 'transform 0.35s ease-out, opacity 0.35s ease-out' : (arrasto.arrastando ? 'none' : 'transform 0.3s ease, opacity 0.3s ease'),
            cursor: arrasto.arrastando ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          <div className="swipe-card__swipe-cue">
            <span>‹  Arraste  ›</span>
          </div>

          {emoji && <span className="swipe-card__emoji">{emoji}</span>}
          <span className="swipe-card__titulo">{titulo}</span>
          {cardAtual.description && (
            <p className="swipe-card__desc">{cardAtual.description}</p>
          )}
        </div>

        {/* Seta indicadora direita */}
        <div className="swipe-side-arrow swipe-side-arrow--right">
          ›
        </div>
      </div>

      {/* Botões de seta para desktop */}
      <div className="swipe-buttons">
        <button
          type="button"
          className="swipe-btn swipe-btn--left"
          onClick={() => decidir('left')}
          disabled={saindo}
          aria-label={leftLabel}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>{leftLabel}</span>
        </button>
        <button
          type="button"
          className="swipe-btn swipe-btn--right"
          onClick={() => decidir('right')}
          disabled={saindo}
          aria-label={rightLabel}
        >
          <span>{rightLabel}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>

      {/* Dica de swipe */}
      <p className="muted" style={{ textAlign: 'center' }}>
        Arraste o card ou use as setas · ← →
      </p>
    </div>
  );
}

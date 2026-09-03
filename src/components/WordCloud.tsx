import { useEffect, useMemo, useRef, useState } from 'react';
import {
  colorForRank,
  layoutWords,
  type Measure,
  type WordCloudItem,
} from '../lib/wordcloudLayout';

export type { WordCloudItem };

interface Props {
  items: WordCloudItem[];
  height?: number;
  minFont?: number;
  maxFont?: number;
  emptyLabel?: string;
}

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

let sharedCtx: CanvasRenderingContext2D | null = null;

/** Medição real via canvas — só isto depende do navegador. */
const medirNoCanvas: Measure = (text, fontSize) => {
  if (!sharedCtx) sharedCtx = document.createElement('canvas').getContext('2d');
  if (!sharedCtx) return text.length * fontSize * 0.55;
  sharedCtx.font = `700 ${fontSize}px ${FONT_STACK}`;
  return sharedCtx.measureText(text).width;
};

export function WordCloud({
  items,
  height = 420,
  minFont = 16,
  maxFont = 92,
  emptyLabel = 'Aguardando as primeiras respostas…',
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0]?.contentRect.width ?? 0));
    });
    obs.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => obs.disconnect();
  }, []);

  const placed = useMemo(
    () => layoutWords(items, { width, height, minFont, maxFont }, medirNoCanvas),
    [items, width, height, minFont, maxFont],
  );

  const total = items.reduce((sum, i) => sum + i.weight, 0);

  return (
    <>
      <div className="wordcloud" ref={ref} style={{ height }}>
        {placed.length === 0 && <div className="wordcloud__empty">{emptyLabel}</div>}
        {placed.map((word) => (
          <span
            key={word.term}
            className="wordcloud__word"
            style={{
              transform: `translate(${word.cx}px, ${word.cy}px) translate(-50%, -50%)`,
              fontSize: `${word.font}px`,
              color: colorForRank(word.rank),
            }}
            onMouseEnter={(e) =>
              setHover({
                x: e.clientX,
                y: e.clientY,
                text: `${word.label} — ${word.weight} ${
                  word.weight === 1 ? 'resposta' : 'respostas'
                }`,
              })
            }
            onMouseMove={(e) =>
              setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
            }
            onMouseLeave={() => setHover(null)}
          >
            {word.label}
          </span>
        ))}
        {hover && (
          <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
            {hover.text}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="row row--between" style={{ marginTop: 8 }}>
          <span className="muted">O tamanho da palavra é a quantidade de respostas.</span>
          <span className="muted">
            {items.length} {items.length === 1 ? 'termo' : 'termos'} · {total}{' '}
            {total === 1 ? 'resposta' : 'respostas'}
            {placed.length < items.length && ` · ${items.length - placed.length} sem espaço`}
          </span>
        </div>
      )}

      {/* Identidade nunca só pela cor ou posição: a tabela é o mesmo dado em texto. */}
      {items.length > 0 && (
        <details className="table-view no-print">
          <summary>Ver como tabela</summary>
          <table className="data">
            <thead>
              <tr>
                <th>Termo</th>
                <th style={{ textAlign: 'right' }}>Respostas</th>
              </tr>
            </thead>
            <tbody>
              {[...items]
                .sort((a, b) => b.weight - a.weight)
                .map((i) => (
                  <tr key={i.term}>
                    <td>{i.label}</td>
                    <td className="num">{i.weight}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}

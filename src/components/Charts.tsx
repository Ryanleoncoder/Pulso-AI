import { useState } from 'react';

export interface BarItem {
  id: string;
  label: string;
  value: number;
  /** cor explícita (categórico de 2 séries); por padrão série 1 */
  color?: string;
  /** marca a alternativa correta com ícone + texto, nunca só com cor */
  correct?: boolean;
}

interface BarsProps {
  items: BarItem[];
  total?: number;
  showPercent?: boolean;
  revealCorrect?: boolean;
}

/**
 * Barras horizontais, uma série. Rótulo direto em cada barra, então não existe
 * legenda separada — a identidade nunca depende da cor. Ponta arredondada em 4px
 * só na extremidade do dado; a base fica ancorada na linha de origem.
 */
export function Bars({ items, total, showPercent = true, revealCorrect = false }: BarsProps) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const soma = total ?? items.reduce((s, i) => s + i.value, 0);
  const maior = Math.max(1, ...items.map((i) => i.value));

  return (
    <>
      <div className="bars">
        {items.map((item) => {
          const pct = soma > 0 ? Math.round((item.value / soma) * 100) : 0;
          return (
            <div key={item.id}>
              <div className="bar__head">
                <span className="bar__label">
                  {item.label}
                  {revealCorrect && item.correct && (
                    <>
                      {' '}
                      <span className="bar__flag">✓ resposta correta</span>
                    </>
                  )}
                </span>
                <span className="bar__value">
                  {item.value}
                  {showPercent && <span className="bar__pct">{pct}%</span>}
                </span>
              </div>
              <div
                className="bar__track"
                onMouseEnter={(e) =>
                  setHover({
                    x: e.clientX,
                    y: e.clientY,
                    text: `${item.label}: ${item.value} (${pct}%)`,
                  })
                }
                onMouseMove={(e) =>
                  setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
                }
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className="bar__fill"
                  style={{
                    width: `${(item.value / maior) * 100}%`,
                    background: item.color ?? 'var(--series-1)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {hover && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          {hover.text}
        </div>
      )}
    </>
  );
}

interface HistogramProps {
  /** contagem por valor da escala, indexada pelo próprio valor */
  counts: Record<number, number>;
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
  average?: number | null;
  total: number;
}

const RAMPA = ['var(--ord-1)', 'var(--ord-2)', 'var(--ord-3)', 'var(--ord-4)', 'var(--ord-5)'];

/**
 * Escala ordenada: rampa de um único matiz, clara→escura, porque os valores têm
 * ordem natural. A média vira número de destaque — é o que a sala olha primeiro.
 */
export function Histogram({
  counts,
  min,
  max,
  minLabel,
  maxLabel,
  average,
  total,
}: HistogramProps) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const valores: number[] = [];
  for (let v = min; v <= max; v++) valores.push(v);

  const pico = Math.max(1, ...valores.map((v) => counts[v] ?? 0));
  const passos = valores.length;

  return (
    <div className="stack">
      {average != null && (
        <div>
          <div className="hero">{average.toFixed(1).replace('.', ',')}</div>
          <div className="muted">
            média de {total} {total === 1 ? 'resposta' : 'respostas'} (escala de {min} a {max})
          </div>
        </div>
      )}

      <div>
        <div className="hist" style={{ gridTemplateColumns: `repeat(${passos}, 1fr)` }}>
          {valores.map((v, idx) => {
            const n = counts[v] ?? 0;
            const cor = RAMPA[Math.round((idx / Math.max(1, passos - 1)) * (RAMPA.length - 1))];
            return (
              <div
                key={v}
                className="hist__col"
                onMouseEnter={(e) =>
                  setHover({
                    x: e.clientX,
                    y: e.clientY,
                    text: `Nota ${v}: ${n} ${n === 1 ? 'resposta' : 'respostas'}`,
                  })
                }
                onMouseMove={(e) =>
                  setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
                }
                onMouseLeave={() => setHover(null)}
              >
                <span className="hist__count">{n}</span>
                <div
                  className="hist__bar"
                  style={{ height: `${(n / pico) * 100}%`, background: cor }}
                />
              </div>
            );
          })}
        </div>

        <div className="hist__axis" style={{ gridTemplateColumns: `repeat(${passos}, 1fr)` }}>
          {valores.map((v) => (
            <span key={v}>{v}</span>
          ))}
        </div>

        {(minLabel || maxLabel) && (
          <div className="row row--between" style={{ marginTop: 6 }}>
            <span className="muted">{minLabel}</span>
            <span className="muted">{maxLabel}</span>
          </div>
        )}
      </div>

      {hover && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          {hover.text}
        </div>
      )}

      <details className="table-view no-print">
        <summary>Ver como tabela</summary>
        <table className="data">
          <thead>
            <tr>
              <th>Nota</th>
              <th style={{ textAlign: 'right' }}>Respostas</th>
            </tr>
          </thead>
          <tbody>
            {valores.map((v) => (
              <tr key={v}>
                <td>{v}</td>
                <td className="num">{counts[v] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

interface CounterProps {
  value: number;
  label: string;
}

/** Contador grande usado enquanto o resultado está oculto. */
export function Counter({ value, label }: CounterProps) {
  return (
    <div>
      <div className="hero">{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

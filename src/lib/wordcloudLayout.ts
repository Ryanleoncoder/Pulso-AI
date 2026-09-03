export interface WordCloudItem {
  /** termo normalizado — chave estável entre renders */
  term: string;
  /** grafia exibida */
  label: string;
  /** frequência */
  weight: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedWord extends WordCloudItem {
  font: number;
  cx: number;
  cy: number;
  rank: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  minFont: number;
  maxFont: number;
}

/** Mede a largura de um texto num dado tamanho de fonte. */
export type Measure = (text: string, fontSize: number) => number;

export const PADDING = 4;

export function overlaps(a: Box, b: Box, pad = PADDING): boolean {
  return (
    a.x < b.x + b.w + pad &&
    b.x < a.x + a.w + pad &&
    a.y < b.y + b.h + pad &&
    b.y < a.y + a.h + pad
  );
}

/**
 * Posicionamento em espiral com detecção de colisão: cada palavra começa no
 * centro e vai abrindo até achar lugar livre. A elipse é mais larga que alta
 * (1.75 × 0.85) porque o telão é 16:9.
 *
 * As palavras são percorridas da mais frequente para a menos frequente, então
 * quem perde espaço é sempre a cauda — nunca um termo em destaque. Se não
 * couber, o corpo encolhe 22% e tenta de novo, até quatro vezes.
 *
 * A medição entra por parâmetro (`measure`) para a função ser pura e testável
 * fora do navegador.
 */
export function layoutWords(
  items: WordCloudItem[],
  { width, height, minFont, maxFont }: LayoutOptions,
  measure: Measure,
): PlacedWord[] {
  if (width < 40 || height < 40) return [];

  const ordered = [...items].sort(
    (a, b) => b.weight - a.weight || a.label.localeCompare(b.label, 'pt-BR'),
  );

  const heaviest = ordered[0]?.weight ?? 1;
  const lightest = ordered[ordered.length - 1]?.weight ?? 1;
  const span = heaviest - lightest;

  const placed: PlacedWord[] = [];
  const boxes: Box[] = [];
  const cx = width / 2;
  const cy = height / 2;

  ordered.forEach((item, rank) => {
    const t = span === 0 ? 1 : (item.weight - lightest) / span;
    let font = Math.round(minFont + (maxFont - minFont) * Math.sqrt(t));

    for (let attempt = 0; attempt < 4; attempt++) {
      const w = measure(item.label, font) + font * 0.28;
      const h = font * 1.14;

      if (w <= width - 8 && h <= height - 8) {
        for (let step = 0; step < 5000; step++) {
          const angle = step * 0.3;
          const radius = 2.1 * angle;
          const x = cx + Math.cos(angle) * radius * 1.75;
          const y = cy + Math.sin(angle) * radius * 0.85;
          const box: Box = { x: x - w / 2, y: y - h / 2, w, h };

          if (box.x < PADDING || box.y < PADDING) continue;
          if (box.x + box.w > width - PADDING) continue;
          if (box.y + box.h > height - PADDING) continue;
          if (boxes.some((other) => overlaps(other, box))) continue;

          boxes.push(box);
          placed.push({
            ...item,
            font,
            rank,
            cx: box.x + box.w / 2,
            cy: box.y + box.h / 2,
          });
          return;
        }
      }

      font = Math.round(font * 0.78);
      if (font < 11) return;
    }
  });

  return placed;
}

/**
 * A frequência é codificada pelo TAMANHO. A cor só dá hierarquia em três
 * degraus da mesma rampa azul (todos legíveis sobre a superfície) — não
 * carrega informação, então nada se perde para quem não distingue matiz.
 */
export function colorForRank(rank: number): string {
  if (rank < 3) return 'var(--wc-strong)';
  if (rank < 8) return 'var(--wc-mid)';
  return 'var(--wc-soft)';
}

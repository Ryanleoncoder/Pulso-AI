import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface Props {
  code: string;
  /** tamanho do QR em px */
  size?: number;
}

/** URL que o QR Code aponta: a origem atual, então funciona tanto no IP da rede
 *  local quanto em produção sem trocar nada. */
export function urlDoParticipante(code: string): string {
  return `${window.location.origin}${window.location.pathname}#/j/${code}`;
}

/**
 * Armadilha que só aparece na hora da reunião: se o telão for aberto em
 * `localhost`, o QR Code aponta para `localhost` e nenhum celular da sala
 * consegue abrir. Precisa ser o IP da máquina na rede (o Vite imprime no
 * terminal como "Network") ou um domínio publicado.
 */
export function origemInacessivelPeloCelular(): boolean {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
}

/**
 * O QR fica sempre em cartão branco com módulos preto, independente do tema —
 * é o que a câmera do celular lê melhor.
 */
export function QrPanel({ code, size = 300 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const url = urlDoParticipante(code);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, url, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b0b0bff', light: '#ffffffff' },
    }).catch(() => {
      /* silencioso: o código de acesso ao lado continua servindo */
    });
  }, [url, size]);

  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <div className="join-panel">
        <div className="qr-card">
          <canvas ref={canvasRef} width={size} height={size} />
        </div>

        <div className="stack stack--tight">
          <span className="eyebrow">Entre pelo celular</span>
          <div className="access-code">{code}</div>
          <span className="secondary" style={{ fontSize: 18 }}>
            {url.replace(/^https?:\/\//, '')}
          </span>
          <span className="muted">Sem cadastro, sem login. Nada identifica você.</span>
        </div>
      </div>

      {origemInacessivelPeloCelular() && (
        <div className="alert no-print" style={{ maxWidth: 620 }}>
          <strong>Este QR Code não vai funcionar nos celulares.</strong> O telão está aberto
          em <code>localhost</code>, endereço que só existe nesta máquina. Abra o telão pelo
          IP da rede que o Vite mostra no terminal como <em>Network</em> (algo como
          <code> http://192.168.x.x:5173</code>) e gere o QR de novo.
        </div>
      )}
    </div>
  );
}

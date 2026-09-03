import {
  createContext,
  useContext,
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';

/* =====================================================================
   Roteador de hash, escrito à mão
   ---------------------------------------------------------------------
   Substitui o react-router. Motivo: são seis rotas estáticas, e as duas
   advisories abertas do react-router 6/7 (open redirect por barra invertida
   em <Link> e useNavigate) atingem justamente o único ponto onde o app
   navega com entrada do usuário — o campo de código na tela inicial.
   Aqui `normalizar()` só deixa passar caracteres de caminho, então destino
   externo é impossível por construção.

   Hash e não history API: o QR Code aponta para .../#/j/PULSO1 e funciona em
   qualquer hospedagem estática, sem regra de rewrite no servidor.
   ===================================================================== */

const SEGURO = /^[A-Za-z0-9/_\-.:]*$/;

function normalizar(to: string): string {
  const bruto = to.startsWith('#') ? to.slice(1) : to;
  const comBarra = bruto.startsWith('/') ? bruto : `/${bruto}`;
  return SEGURO.test(comBarra) ? comBarra : '/';
}

function caminhoAtual(): string {
  return normalizar(window.location.hash.slice(1) || '/');
}

export function navigate(to: string, replace = false): void {
  const alvo = `#${normalizar(to)}`;
  if (replace) {
    window.history.replaceState(null, '', alvo);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = normalizar(to);
  }
}

export function useNavigate() {
  return navigate;
}

/* ------------------------------------------------------------------ */

const ParamsCtx = createContext<Record<string, string>>({});

export function useParams<T extends Record<string, string | undefined>>(): T {
  return useContext(ParamsCtx) as T;
}

/** Casa "/p/:sessionId" com "/p/abc" e devolve { sessionId: 'abc' }. */
function casar(padrao: string, caminho: string): Record<string, string> | null {
  const p = padrao.split('/').filter(Boolean);
  const c = caminho.split('/').filter(Boolean);
  if (p.length !== c.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const parte = p[i]!;
    const valor = c[i]!;
    if (parte.startsWith(':')) params[parte.slice(1)] = decodeURIComponent(valor);
    else if (parte !== valor) return null;
  }
  return params;
}

export interface RouteDef {
  path: string;
  element: ReactNode;
}

export function Router({ routes, fallback }: { routes: RouteDef[]; fallback: ReactNode }) {
  const [caminho, setCaminho] = useState(caminhoAtual);

  useEffect(() => {
    const aoMudar = () => setCaminho(caminhoAtual());
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, []);

  for (const rota of routes) {
    const params = casar(rota.path, caminho);
    if (params) {
      return <ParamsCtx.Provider value={params}>{rota.element}</ParamsCtx.Provider>;
    }
  }
  return <>{fallback}</>;
}

/* ------------------------------------------------------------------ */

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

export function Link({ to, children, ...resto }: LinkProps) {
  return (
    <a href={`#${normalizar(to)}`} {...resto}>
      {children}
    </a>
  );
}

interface LinkButtonProps {
  to: string;
  children: ReactNode;
  className?: string;
  /** abre em outra aba — usado para pôr o telão num segundo monitor */
  blank?: boolean;
}

export function LinkButton({ to, children, className, blank }: LinkButtonProps) {
  return (
    <button
      className={className}
      onClick={() => {
        const alvo = `#${normalizar(to)}`;
        if (blank) window.open(alvo, '_blank', 'noopener');
        else navigate(to);
      }}
    >
      {children}
    </button>
  );
}

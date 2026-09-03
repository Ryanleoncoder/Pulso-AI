import { useState } from 'react';
import { Link, useNavigate } from '../lib/router';

/** Só letras e dígitos: o código nunca pode virar um caminho ou um destino externo. */
function limparCodigo(bruto: string): string {
  return bruto.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function Home() {
  const [codigo, setCodigo] = useState('');
  const navigate = useNavigate();

  return (
    <div className="shell shell--narrow">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          const limpo = limparCodigo(codigo);
          if (limpo) navigate(`/j/${limpo}`);
        }}
      >
        <div className="stack stack--tight">
          <span className="eyebrow">Pulso IA</span>
          <h1>Participação ao vivo</h1>
          <p className="secondary">Digite o código que está no telão.</p>
        </div>

        <input
          className="code-input"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={6}
          value={codigo}
          onChange={(e) => setCodigo(limparCodigo(e.target.value))}
          aria-label="Código da sessão"
        />

        <button className="btn-primary" type="submit">
          Entrar
        </button>
      </form>

      <p className="muted" style={{ textAlign: 'center' }}>
        <Link to="/admin" style={{ color: 'inherit' }}>
          Entrar como apresentador
        </Link>
      </p>
    </div>
  );
}

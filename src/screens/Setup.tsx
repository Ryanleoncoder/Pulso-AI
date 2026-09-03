/**
 * Mostrada quando falta o .env. Sem isso a tela ficaria branca e o erro só
 * apareceria no console do navegador.
 */
export function Setup() {
  return (
    <div className="shell shell--narrow">
      <div className="card stack">
        <div className="stack stack--tight">
          <span className="eyebrow">Pulso IA</span>
          <h1>Falta configurar o Supabase</h1>
          <p className="secondary">
            O app está rodando, mas não sabe com qual projeto falar.
          </p>
        </div>

        <hr className="hairline" />

        <ol className="stack" style={{ paddingLeft: 20, lineHeight: 1.5 }}>
          <li>
            Crie o arquivo <code>.env</code> na raiz do projeto, copiando de{' '}
            <code>.env.example</code>.
          </li>
          <li>
            Preencha com os valores de <strong>Supabase Dashboard, Project Settings, API</strong>:
            <pre
              style={{
                background: 'var(--wash)',
                padding: 12,
                borderRadius: 8,
                overflowX: 'auto',
                fontSize: 13,
                marginTop: 8,
              }}
            >
              {`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
VITE_PRESENTER_USER=apresentador`}
            </pre>
          </li>
          <li>
            Rode os 9 arquivos de <code>supabase/migrations/</code> no SQL Editor, em ordem
            numérica.
          </li>
          <li>
            Habilite <strong>Anonymous sign-ins</strong> em Authentication, Sign In / Providers.
          </li>
          <li>
            Crie o usuário do apresentador em Authentication, Users, e rode{' '}
            <code>supabase/seed.sql</code>.
          </li>
          <li>
            Pare e rode <code>npm run dev</code> de novo: o Vite só lê o <code>.env</code> na
            inicialização.
          </li>
        </ol>

        <div className="alert">
          A <code>service_role</code> nunca entra no <code>.env</code> do frontend. Só a{' '}
          <code>anon</code> key, que é pública por natureza, porque a RLS é que protege os dados.
        </div>
      </div>
    </div>
  );
}

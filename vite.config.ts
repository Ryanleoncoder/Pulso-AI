import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Detecta uma chave que dá privilégio de servidor (service_role).
 * Formato novo do Supabase: sb_secret_...
 * Formato legado: JWT cujo payload traz role = service_role.
 */
function ehChaveSecreta(valor: string): boolean {
  if (valor.startsWith('sb_secret_')) return true;
  if (!valor.startsWith('eyJ')) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(valor.split('.')[1] ?? '', 'base64').toString('utf8'),
    ) as { role?: string };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  // Trava de segurança: tudo que começa com VITE_ é inlinado como texto puro no
  // bundle que o navegador baixa. Não existe forma de esconder isso do F12, e a
  // service_role ignora toda a RLS. Então o build para em vez de vazar.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  for (const [nome, valor] of Object.entries(env)) {
    if (valor && ehChaveSecreta(valor)) {
      throw new Error(
        `\n\n  ${nome} contém uma chave secreta (service_role).\n\n` +
          '  Variáveis VITE_* vão como texto puro para o bundle do navegador —\n' +
          '  qualquer participante lê no F12, e a service_role ignora a RLS.\n\n' +
          '  Use a anon / publishable key. O apresentador tem poder de admin pela\n' +
          '  RLS (events.owner_id = auth.uid()), não pela chave.\n',
      );
    }
  }

  return {
    plugins: [react()],
    // host: true expõe o dev server na rede local — necessário para testar
    // com dois celulares apontando para o IP da máquina.
    server: { host: true, port: 5173 },
  };
});

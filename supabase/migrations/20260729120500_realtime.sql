-- =====================================================================
-- Pulso IA — 0005 — Realtime (Postgres Changes)
-- =====================================================================
-- Escala pequena (uma sala, dezenas de pessoas) => Postgres Changes é
-- suficiente e não exige código extra de publicação no cliente.
-- Se um dia isso virar milhares de participantes, migrar para Broadcast
-- (supabase.com/docs/guides/realtime/subscribing-to-database-changes).
--
-- A RLS vale também no Realtime: o participante recebe mudanças de
-- `sessions` e `questions` (para saber que a próxima pergunta abriu), mas
-- NÃO recebe `responses`, porque não tem select nessa tabela.
-- =====================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'sessions', 'questions', 'question_options', 'participants', 'responses'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then
        raise notice 'Publicação supabase_realtime inexistente — habilite o Realtime no projeto.';
    end;
  end loop;
end $$;

-- REPLICA IDENTITY FULL: necessário para o Realtime aplicar RLS sobre o
-- registro antigo em UPDATE/DELETE (ex.: apresentador ocultando resposta).
alter table public.responses    replica identity full;
alter table public.questions    replica identity full;
alter table public.sessions     replica identity full;
alter table public.participants replica identity full;

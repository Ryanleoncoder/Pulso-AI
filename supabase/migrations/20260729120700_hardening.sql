-- =====================================================================
-- Pulso IA — 0007 — Fechar o EXECUTE público nas funções
-- =====================================================================
-- O Postgres concede EXECUTE ao papel PUBLIC por padrão em toda função nova.
-- Como `anon` herda de PUBLIC, todas as funções SECURITY DEFINER ficavam
-- chamáveis sem login via /rest/v1/rpc/... — é o aviso
-- `anon_security_definer_function_executable` do linter do Supabase.
--
-- Nenhuma delas vazava dado: todas filtram por auth.uid(), que é nulo sem
-- login. Mas superfície exposta sem motivo é superfície a menos que exista.
--
-- O papel `authenticated` mantém os grants explícitos — é do que a RLS e o
-- cliente precisam. Rode este arquivo por último.
-- =====================================================================

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('revoke all on function %s from anon', f.assinatura);
  end loop;
end $$;

-- RPCs que o cliente autenticado realmente chama.
grant execute on function public.join_session(text)                                          to authenticated;
grant execute on function public.submit_response(uuid, uuid, text, numeric, boolean, uuid[])  to authenticated;
grant execute on function public.open_question(uuid, uuid)                                    to authenticated;
grant execute on function public.close_question(uuid)                                         to authenticated;
grant execute on function public.set_results_visible(uuid, boolean)                           to authenticated;
grant execute on function public.set_response_hidden(uuid, boolean, text)                     to authenticated;
grant execute on function public.finish_session(uuid)                                         to authenticated;
grant execute on function public.generate_access_code()                                       to authenticated;
grant execute on function public.move_question(uuid, integer)                                 to authenticated;
grant execute on function public.delete_question(uuid)                                        to authenticated;
grant execute on function public.replace_question_options(uuid, text[], int[])                to authenticated;
grant execute on function public.create_question(
  uuid, public.question_type, text, public.question_phase, text, jsonb, text[], int[], boolean, text
) to authenticated;

-- Predicados usados dentro das políticas de RLS: o papel que roda a consulta
-- precisa poder executá-los.
grant execute on function public.is_presenter()                to authenticated;
grant execute on function public.is_event_owner(uuid)          to authenticated;
grant execute on function public.is_question_owner(uuid)       to authenticated;
grant execute on function public.is_session_owner(uuid)        to authenticated;
grant execute on function public.is_session_participant(uuid)  to authenticated;
grant execute on function public.my_participant_id(uuid)       to authenticated;
grant execute on function public.can_view_question(uuid)       to authenticated;
grant execute on function public.can_answer_question(uuid, uuid) to authenticated;
grant execute on function public.can_add_response_option(uuid) to authenticated;
grant execute on function public.normalize_answer(text)        to authenticated;
grant execute on function public.strip_accents(text)           to authenticated;

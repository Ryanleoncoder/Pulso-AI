-- =====================================================================
-- Pulso IA — 0013 — Ajuste no reset_session com SECURITY DEFINER
-- =====================================================================
-- Atualiza a função reset_session para usar SECURITY DEFINER e garantir
-- a limpeza de respostas e participantes sem bloqueios de RLS.
-- =====================================================================

create or replace function public.reset_session(p_session_id uuid, p_confirm_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code       text;
  v_event      uuid;
  v_respostas  integer;
  v_participes integer;
begin
  select s.access_code, s.event_id into v_code, v_event
  from public.sessions s where s.id = p_session_id;

  if v_code is null then
    raise exception 'Sessão não encontrada ou sem permissão' using errcode = '42501';
  end if;

  if not public.is_session_owner(p_session_id) then
    raise exception 'Você não tem permissão para zerar esta sessão' using errcode = '42501';
  end if;

  if upper(btrim(coalesce(p_confirm_code, ''))) <> v_code then
    raise exception 'Código de confirmação não confere com esta sessão';
  end if;

  select count(*) into v_respostas  from public.responses    where session_id = p_session_id;
  select count(*) into v_participes from public.participants where session_id = p_session_id;

  delete from public.responses    where session_id = p_session_id;
  delete from public.participants where session_id = p_session_id;

  update public.questions
     set status = 'draft', results_visible = false
   where event_id = v_event;

  update public.sessions
     set status = 'waiting', active_question_id = null,
         started_at = null, finished_at = null
   where id = p_session_id;

  return jsonb_build_object(
    'respostas_apagadas', v_respostas,
    'participantes_apagados', v_participes
  );
end;
$$;

revoke all on function public.reset_session(uuid, text) from public, anon;
grant execute on function public.reset_session(uuid, text) to authenticated;

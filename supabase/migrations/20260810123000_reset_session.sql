-- =====================================================================
-- Pulso IA — 0013 — Zerar a sessão para começar limpo
-- =====================================================================
-- Apaga respostas e participantes e devolve o roteiro ao estado inicial. É a
-- ação para rodar ANTES da reunião de verdade, tirando o lixo dos testes.
--
-- É irreversível e destrói evidência, então exige o código da sessão como
-- confirmação — não basta clicar. Um botão destrutivo sem atrito, numa tela
-- usada ao vivo na frente de uma sala, é acidente esperando acontecer.
--
-- SECURITY INVOKER: quem não é dono do evento é barrado pela RLS, que já exige
-- is_presenter() para apagar resposta e participante.
--
-- response_options e moderation_actions somem em cascata com as respostas
-- (FK on delete cascade), então a trilha de moderação da sessão zerada também
-- vai embora — é o comportamento certo aqui, já que ela se refere a respostas
-- que deixaram de existir.
-- =====================================================================

create or replace function public.reset_session(p_session_id uuid, p_confirm_code text)
returns jsonb
language plpgsql
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

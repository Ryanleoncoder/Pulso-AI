-- =====================================================================
-- Pulso IA — 0012 — Tipo swipe_card (cards estilo Tinder) - Parte 2
-- =====================================================================
-- Mecânica:
--   Cada card é uma `question_option` (emoji no campo `label`, descrição
--   no novo campo `description`). O gabarito usa `correct_option_ids`
--   como nas demais: os IDs ali listados são os cards cujo swipe correto
--   é DIREITA (pode enviar para IA). Cards fora da lista devem ser
--   arrastados para ESQUERDA (não enviar).
--
--   A resposta do participante vai em `response_options` como nas
--   perguntas de escolha: cada option_id presente significa que o
--   participante arrastou aquele card para a DIREITA.
--
--   config suportado:
--     { "right_label": "Pode enviar", "left_label": "Não enviar" }
-- =====================================================================

-- 1. Adicionar campo `description` em question_options para a descrição do card
alter table public.question_options
  add column if not exists description text
  check (description is null or char_length(description) <= 500);

-- 2. Adaptar o trigger de validação de resposta para aceitar swipe_card
create or replace function public.responses_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type      public.question_type;
  v_event_id  uuid;
  v_config    jsonb;
  v_sess_evt  uuid;
  v_max_chars integer;
  v_max_words integer;
  v_min       numeric;
  v_max       numeric;
  v_words     integer;
begin
  select q.type, q.event_id, q.config
    into v_type, v_event_id, v_config
  from public.questions q where q.id = new.question_id;

  if v_type is null then
    raise exception 'Pergunta inexistente';
  end if;

  new.question_type := v_type;

  select s.event_id into v_sess_evt from public.sessions s where s.id = new.session_id;
  if v_sess_evt is null or v_sess_evt <> v_event_id then
    raise exception 'A pergunta não pertence ao evento desta sessão';
  end if;

  if not exists (
    select 1 from public.participants p
    where p.id = new.participant_id and p.session_id = new.session_id
  ) then
    raise exception 'O participante não pertence a esta sessão';
  end if;

  new.normalized_text := public.normalize_answer(new.answer_text);

  if v_type = 'word_cloud' then
    v_max_chars := coalesce((v_config ->> 'max_chars')::int, 30);
    v_max_words := coalesce((v_config ->> 'max_words')::int, 3);

    if new.normalized_text is null then
      raise exception 'Escreva ao menos uma palavra';
    end if;
    if char_length(btrim(new.answer_text)) > v_max_chars then
      raise exception 'Limite de % caracteres', v_max_chars;
    end if;

    v_words := coalesce(array_length(regexp_split_to_array(new.normalized_text, ' '), 1), 0);
    if v_words > v_max_words then
      raise exception 'Use no máximo % palavras', v_max_words;
    end if;

    new.numeric_value := null;
    new.bool_value := null;

  elsif v_type = 'open_text' then
    v_max_chars := coalesce((v_config ->> 'max_chars')::int, 280);
    if btrim(coalesce(new.answer_text, '')) = '' then
      raise exception 'Escreva sua resposta';
    end if;
    if char_length(btrim(new.answer_text)) > v_max_chars then
      raise exception 'Limite de % caracteres', v_max_chars;
    end if;
    new.numeric_value := null;
    new.bool_value := null;

  elsif v_type = 'scale' then
    v_min := coalesce((v_config ->> 'min')::numeric, 1);
    v_max := coalesce((v_config ->> 'max')::numeric, 5);
    if new.numeric_value is null then
      raise exception 'Escolha um valor na escala';
    end if;
    if new.numeric_value <> trunc(new.numeric_value)
       or new.numeric_value < v_min
       or new.numeric_value > v_max then
      raise exception 'Escolha um número inteiro entre % e %', v_min, v_max;
    end if;
    new.answer_text := null;
    new.normalized_text := null;
    new.bool_value := null;

  elsif v_type = 'boolean' then
    if new.bool_value is null then
      raise exception 'Escolha sim ou não';
    end if;
    new.answer_text := null;
    new.normalized_text := null;
    new.numeric_value := null;

  else -- single_choice / multiple_choice / swipe_card
    new.answer_text := null;
    new.normalized_text := null;
    new.numeric_value := null;
    new.bool_value := null;
  end if;

  return new;
end;
$$;

-- 3. Adaptar o trigger de response_options para aceitar swipe_card
create or replace function public.response_options_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_id uuid;
  v_type        public.question_type;
  v_config      jsonb;
  v_selected    integer;
  v_max_sel     integer;
begin
  select r.question_id into v_question_id
  from public.responses r where r.id = new.response_id;

  if v_question_id is null then
    raise exception 'Resposta inexistente';
  end if;

  if not exists (
    select 1 from public.question_options o
    where o.id = new.option_id and o.question_id = v_question_id
  ) then
    raise exception 'A alternativa não pertence a esta pergunta';
  end if;

  select q.type, q.config into v_type, v_config
  from public.questions q where q.id = v_question_id;

  select count(*) into v_selected
  from public.response_options ro where ro.response_id = new.response_id;

  if v_type = 'single_choice' then
    v_max_sel := 1;
  elsif v_type = 'swipe_card' then
    v_max_sel := 999;
  else
    v_max_sel := coalesce((v_config ->> 'max_selections')::int, 999);
  end if;

  if v_selected + 1 > v_max_sel then
    raise exception 'Selecione no máximo % alternativa(s)', v_max_sel;
  end if;

  return new;
end;
$$;

-- 4. Adaptar submit_response para aceitar swipe_card
create or replace function public.submit_response(
  p_session_id    uuid,
  p_question_id   uuid,
  p_answer_text   text    default null,
  p_numeric_value numeric default null,
  p_bool_value    boolean default null,
  p_option_ids    uuid[]  default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_participant_id uuid;
  v_response_id    uuid := gen_random_uuid();
  v_type           public.question_type;
  v_config         jsonb;
  v_wanted         integer;
  v_inserted       integer;
begin
  v_participant_id := public.my_participant_id(p_session_id);
  if v_participant_id is null then
    raise exception 'Entre na sessão antes de responder' using errcode = '42501';
  end if;

  select q.type, q.config into v_type, v_config
  from public.questions q where q.id = p_question_id;

  if v_type is null then
    raise exception 'Esta pergunta não está aberta' using errcode = '42501';
  end if;

  insert into public.responses (
    id, session_id, question_id, participant_id, answer_text, numeric_value, bool_value
  )
  values (
    v_response_id, p_session_id, p_question_id, v_participant_id,
    p_answer_text, p_numeric_value, p_bool_value
  );

  if v_type in ('single_choice', 'multiple_choice') then
    v_wanted := coalesce(array_length(p_option_ids, 1), 0);

    if v_wanted = 0 then
      raise exception 'Selecione ao menos uma alternativa';
    end if;
    if v_type = 'single_choice' and v_wanted > 1 then
      raise exception 'Selecione apenas uma alternativa';
    end if;

    insert into public.response_options (response_id, option_id)
    select v_response_id, o.id
    from public.question_options o
    where o.question_id = p_question_id
      and o.id = any (p_option_ids);

    get diagnostics v_inserted = row_count;

    if v_inserted <> v_wanted then
      raise exception 'Alternativa inválida para esta pergunta';
    end if;

  elsif v_type = 'swipe_card' then
    v_wanted := coalesce(array_length(p_option_ids, 1), 0);

    if v_wanted > 0 then
      insert into public.response_options (response_id, option_id)
      select v_response_id, o.id
      from public.question_options o
      where o.question_id = p_question_id
        and o.id = any (p_option_ids);

      get diagnostics v_inserted = row_count;

      if v_inserted <> v_wanted then
        raise exception 'Alternativa inválida para esta pergunta';
      end if;
    end if;
  end if;

  return v_response_id;
end;
$$;

revoke all on function public.submit_response(uuid, uuid, text, numeric, boolean, uuid[]) from public, anon;
grant execute on function public.submit_response(uuid, uuid, text, numeric, boolean, uuid[]) to authenticated;

-- 5. View de resultados dos swipe cards
create or replace view public.v_swipe_results
with (security_invoker = on) as
select
  s.id                as session_id,
  o.question_id,
  o.id                as option_id,
  o.label,
  o.description,
  o."position",
  count(ro.response_id)::int as approved,
  (select count(distinct r2.id)::int
   from public.responses r2
   where r2.question_id = o.question_id
     and r2.session_id = s.id
     and r2.is_hidden = false
  ) as total_respondents,
  case when ak.correct_option_ids is not null
       then o.id = any(ak.correct_option_ids)
       else null
  end as correct_answer_is_right
from public.sessions s
join public.questions q        on q.event_id = s.event_id
join public.question_options o on o.question_id = q.id
left join public.response_options ro on ro.option_id = o.id
left join public.responses r on r.id = ro.response_id
                            and r.session_id = s.id
                            and r.is_hidden = false
left join public.question_answer_keys ak on ak.question_id = o.question_id
where q.type = 'swipe_card'
group by s.id, o.question_id, o.id, o.label, o.description, o."position",
         ak.correct_option_ids;

revoke all on public.v_swipe_results from anon;
grant select on public.v_swipe_results to authenticated;

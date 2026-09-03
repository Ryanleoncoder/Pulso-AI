-- =====================================================================
-- Pulso IA — 0006 — Edição do roteiro durante a reunião
-- =====================================================================
-- O apresentador precisa montar e remontar o roteiro ao vivo: "nuvem já foi,
-- agora pergunta e resposta, agora encerramento". Isso exige trocar perguntas
-- de posição, e a restrição UNIQUE (event_id, position) impede a troca no meio
-- do caminho — durante um instante as duas perguntas têm a mesma posição.
--
-- Solução: tornar a restrição DEFERRABLE INITIALLY DEFERRED. Ela passa a ser
-- verificada no COMMIT, então uma função pode fazer as duas atualizações em
-- sequência sem violar nada. Continua garantindo unicidade no fim.
-- =====================================================================

do $$
declare
  r record;
begin
  -- questions: troca a UNIQUE inline por uma deferrable
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.questions'::regclass
      and contype = 'u'
      and not condeferrable
  loop
    execute format('alter table public.questions drop constraint %I', r.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.questions'::regclass
      and conname = 'questions_event_position_uk'
  ) then
    alter table public.questions
      add constraint questions_event_position_uk unique (event_id, "position")
      deferrable initially deferred;
  end if;

  -- question_options: mesma coisa
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.question_options'::regclass
      and contype = 'u'
      and not condeferrable
  loop
    execute format('alter table public.question_options drop constraint %I', r.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.question_options'::regclass
      and conname = 'question_options_position_uk'
  ) then
    alter table public.question_options
      add constraint question_options_position_uk unique (question_id, "position")
      deferrable initially deferred;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Criar pergunta (com alternativas e gabarito) numa transação
-- ---------------------------------------------------------------------
-- SECURITY INVOKER: quem não é dono do evento é barrado pela RLS de questions.
create or replace function public.create_question(
  p_event_id        uuid,
  p_type            public.question_type,
  p_prompt          text,
  p_phase           public.question_phase default 'live',
  p_description     text    default null,
  p_config          jsonb   default '{}'::jsonb,
  p_options         text[]  default null,
  p_correct_indexes int[]   default null,   -- 1-based, referente a p_options
  p_correct_boolean boolean default null,
  p_explanation     text    default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id         uuid;
  v_position   integer;
  v_option_ids uuid[];
  v_correct    uuid[];
begin
  if btrim(coalesce(p_prompt, '')) = '' then
    raise exception 'Escreva o enunciado da pergunta';
  end if;

  select coalesce(max(q."position"), 0) + 1
    into v_position
  from public.questions q
  where q.event_id = p_event_id;

  insert into public.questions (
    event_id, type, phase, prompt, description, "position", config
  )
  values (
    p_event_id,
    p_type,
    p_phase,
    btrim(p_prompt),
    nullif(btrim(coalesce(p_description, '')), ''),
    v_position,
    coalesce(p_config, '{}'::jsonb)
  )
  returning id into v_id;

  if p_type in ('single_choice', 'multiple_choice')
     and coalesce(array_length(p_options, 1), 0) > 0 then

    with novas as (
      insert into public.question_options (question_id, label, "position")
      select v_id, btrim(o.label), row_number() over (order by o.ord)
      from unnest(p_options) with ordinality as o(label, ord)
      where btrim(coalesce(o.label, '')) <> ''
      returning id, "position"
    )
    select array_agg(n.id order by n."position") into v_option_ids from novas n;

    if coalesce(array_length(p_correct_indexes, 1), 0) > 0 then
      select array_agg(v_option_ids[i])
        into v_correct
      from unnest(p_correct_indexes) as i
      where i between 1 and coalesce(array_length(v_option_ids, 1), 0);
    end if;
  end if;

  if v_correct is not null
     or p_correct_boolean is not null
     or nullif(btrim(coalesce(p_explanation, '')), '') is not null then
    insert into public.question_answer_keys (
      question_id, correct_option_ids, correct_boolean, explanation
    )
    values (
      v_id,
      coalesce(v_correct, '{}'::uuid[]),
      p_correct_boolean,
      nullif(btrim(coalesce(p_explanation, '')), '')
    );
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Trocar de posição com a pergunta vizinha
-- ---------------------------------------------------------------------
create or replace function public.move_question(p_question_id uuid, p_delta integer)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_event     uuid;
  v_pos       integer;
  v_other_id  uuid;
  v_other_pos integer;
begin
  select q.event_id, q."position"
    into v_event, v_pos
  from public.questions q
  where q.id = p_question_id;

  if v_event is null then
    raise exception 'Pergunta não encontrada ou sem permissão' using errcode = '42501';
  end if;

  if p_delta < 0 then
    select q.id, q."position" into v_other_id, v_other_pos
    from public.questions q
    where q.event_id = v_event and q."position" < v_pos
    order by q."position" desc
    limit 1;
  else
    select q.id, q."position" into v_other_id, v_other_pos
    from public.questions q
    where q.event_id = v_event and q."position" > v_pos
    order by q."position" asc
    limit 1;
  end if;

  -- já está na ponta: nada a fazer
  if v_other_id is null then
    return;
  end if;

  -- Só funciona porque a UNIQUE é deferrable: entre as duas linhas abaixo as
  -- duas perguntas ocupam a mesma posição.
  update public.questions set "position" = v_other_pos where id = p_question_id;
  update public.questions set "position" = v_pos       where id = v_other_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Apagar pergunta — nunca destrói evidência
-- ---------------------------------------------------------------------
create or replace function public.delete_question(p_question_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.responses r where r.question_id = p_question_id) then
    raise exception
      'Esta pergunta já tem respostas. Apagar destruiria a evidência — encerre a pergunta em vez de apagar.';
  end if;

  delete from public.questions where id = p_question_id;

  if not found then
    raise exception 'Pergunta não encontrada ou sem permissão' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Substituir as alternativas de uma pergunta
-- ---------------------------------------------------------------------
-- Recusa se já houver resposta: apagar uma alternativa apagaria em cascata os
-- votos que apontam para ela.
create or replace function public.replace_question_options(
  p_question_id     uuid,
  p_labels          text[],
  p_correct_indexes int[] default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_option_ids uuid[];
  v_correct    uuid[];
begin
  if not exists (select 1 from public.questions q where q.id = p_question_id) then
    raise exception 'Pergunta não encontrada ou sem permissão' using errcode = '42501';
  end if;

  if exists (select 1 from public.responses r where r.question_id = p_question_id) then
    raise exception
      'Esta pergunta já tem respostas. Você pode ajustar os textos, mas não trocar o conjunto de alternativas.';
  end if;

  delete from public.question_options where question_id = p_question_id;

  with novas as (
    insert into public.question_options (question_id, label, "position")
    select p_question_id, btrim(o.label), row_number() over (order by o.ord)
    from unnest(p_labels) with ordinality as o(label, ord)
    where btrim(coalesce(o.label, '')) <> ''
    returning id, "position"
  )
  select array_agg(n.id order by n."position") into v_option_ids from novas n;

  if coalesce(array_length(p_correct_indexes, 1), 0) > 0 then
    select array_agg(v_option_ids[i])
      into v_correct
    from unnest(p_correct_indexes) as i
    where i between 1 and coalesce(array_length(v_option_ids, 1), 0);
  end if;

  if v_correct is not null then
    insert into public.question_answer_keys (question_id, correct_option_ids)
    values (p_question_id, v_correct)
    on conflict (question_id) do update set correct_option_ids = excluded.correct_option_ids;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant execute on function public.create_question(
  uuid, public.question_type, text, public.question_phase, text, jsonb, text[], int[], boolean, text
) to authenticated;
grant execute on function public.move_question(uuid, integer)               to authenticated;
grant execute on function public.delete_question(uuid)                      to authenticated;
grant execute on function public.replace_question_options(uuid, text[], int[]) to authenticated;

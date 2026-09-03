-- =====================================================================
-- Pulso IA — 0008 — Nuvem de palavras aceita várias entradas por pessoa
-- =====================================================================
-- Nas demais perguntas continua uma resposta por pessoa. Na nuvem, cada um pode
-- mandar até `max_entries` palavras (padrão 3) — é o comportamento esperado de
-- nuvem de palavras, e o que faz a nuvem ficar rica numa sala pequena.
--
-- A UNIQUE (question_id, participant_id) não consegue ser condicional ao tipo da
-- pergunta: índice parcial só enxerga colunas da própria linha, e o tipo mora em
-- `questions`. Por isso o tipo passa a ser gravado em responses.question_type
-- (pelo trigger) e o índice único vira parcial sobre ele.
-- =====================================================================

-- 1. Coluna com o tipo, preenchida pelo trigger.
alter table public.responses
  add column if not exists question_type public.question_type;

update public.responses r
   set question_type = q.type
  from public.questions q
 where q.id = r.question_id
   and r.question_type is null;

-- 2. Troca a UNIQUE de tabela por um índice único parcial.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.responses'::regclass
      and contype = 'u'
  loop
    execute format('alter table public.responses drop constraint %I', r.conname);
  end loop;
end $$;

create unique index if not exists responses_uma_por_pessoa
  on public.responses (question_id, participant_id)
  where question_type <> 'word_cloud';

-- 3. Trigger: grava o tipo e, na nuvem, limita a quantidade de entradas e
--    impede a mesma palavra repetida pela mesma pessoa — senão uma pessoa
--    sozinha infla um termo e a nuvem deixa de representar a sala.
create or replace function public.responses_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type        public.question_type;
  v_event_id    uuid;
  v_config      jsonb;
  v_sess_evt    uuid;
  v_max_chars   integer;
  v_max_words   integer;
  v_max_entries integer;
  v_entradas    integer;
  v_min         numeric;
  v_max         numeric;
  v_words       integer;
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
    v_max_chars   := coalesce((v_config ->> 'max_chars')::int, 30);
    v_max_words   := coalesce((v_config ->> 'max_words')::int, 3);
    v_max_entries := coalesce((v_config ->> 'max_entries')::int, 3);

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

    select count(*) into v_entradas
    from public.responses r
    where r.question_id = new.question_id
      and r.participant_id = new.participant_id;

    if v_entradas >= v_max_entries then
      raise exception 'Você já enviou % de % palavras nesta pergunta', v_entradas, v_max_entries;
    end if;

    if exists (
      select 1 from public.responses r
      where r.question_id = new.question_id
        and r.participant_id = new.participant_id
        and r.normalized_text = new.normalized_text
    ) then
      raise exception 'Você já enviou essa palavra — escolha outra';
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

  else
    new.answer_text := null;
    new.normalized_text := null;
    new.numeric_value := null;
    new.bool_value := null;
  end if;

  return new;
end;
$$;

-- 4. Quantas entradas EU já mandei nesta pergunta.
--
--    Devolve só um número sobre o próprio participante — não fere a regra de
--    que ninguém lê resposta bruta. Existe porque o celular precisa saber,
--    depois de recarregar, quantas palavras ainda pode mandar. Antes isso
--    morava no localStorage e era fonte de bug: quando as respostas eram
--    apagadas no servidor, o navegador continuava achando que tinha respondido
--    e a pessoa ficava presa na tela de "Pronto".
create or replace function public.my_response_count(p_session_id uuid, p_question_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.responses r
  join public.participants p on p.id = r.participant_id
  where r.question_id = p_question_id
    and r.session_id = p_session_id
    and p.anonymous_token = (select auth.uid());
$$;

-- Função nova nasce com EXECUTE para PUBLIC; fecha na hora (ver 0007).
revoke all on function public.my_response_count(uuid, uuid) from public, anon;
grant execute on function public.my_response_count(uuid, uuid) to authenticated;

-- 5. As nuvens já existentes passam a aceitar 3 palavras por pessoa.
update public.questions
   set config = config || '{"max_entries": 3}'::jsonb
 where type = 'word_cloud'
   and not (config ? 'max_entries');

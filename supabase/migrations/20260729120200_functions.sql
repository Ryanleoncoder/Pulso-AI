-- =====================================================================
-- Pulso IA — 0002 — Funções auxiliares, normalização, triggers e RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- Identidade
-- ---------------------------------------------------------------------

-- Apresentador = usuário autenticado que NÃO é anônimo.
create or replace function public.is_presenter()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and coalesce((((select auth.jwt()) ->> 'is_anonymous'))::boolean, false) = false;
$$;

create or replace function public.is_event_owner(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.owner_id = (select auth.uid())
  );
$$;

create or replace function public.is_question_owner(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.questions q
    join public.events e on e.id = q.event_id
    where q.id = p_question_id
      and e.owner_id = (select auth.uid())
  );
$$;

create or replace function public.is_session_owner(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sessions s
    join public.events e on e.id = s.event_id
    where s.id = p_session_id
      and e.owner_id = (select auth.uid())
  );
$$;

create or replace function public.is_session_participant(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.participants p
    where p.session_id = p_session_id
      and p.anonymous_token = (select auth.uid())
  );
$$;

create or replace function public.my_participant_id(p_session_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.participants p
  where p.session_id = p_session_id
    and p.anonymous_token = (select auth.uid())
  limit 1;
$$;

-- O participante não tem SELECT em `responses` (nem na própria resposta), então
-- a política de INSERT em response_options não pode depender de ler a tabela.
-- Este helper é SECURITY DEFINER só para responder "esta resposta é minha e a
-- pergunta ainda está aberta?" sem devolver conteúdo nenhum.
create or replace function public.can_add_response_option(p_response_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.responses r
    join public.participants p on p.id = r.participant_id
    join public.sessions  s on s.id = r.session_id
    join public.questions q on q.id = r.question_id
    where r.id = p_response_id
      and p.anonymous_token = (select auth.uid())
      and s.active_question_id = q.id
      and s.status = 'live'
      and q.status = 'open'
  );
$$;

-- "Esta pergunta está aberta para resposta agora?" — usado na política de
-- INSERT de responses. É SECURITY DEFINER para responder com um booleano só, em
-- vez de uma subconsulta correlacionada sobre sessions e questions dentro da
-- política (que dispararia a RLS dessas duas tabelas em cascata).
create or replace function public.can_answer_question(p_session_id uuid, p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sessions s
    join public.questions q on q.id = s.active_question_id
    where s.id = p_session_id
      and s.status = 'live'
      and q.id = p_question_id
      and q.status = 'open'
  );
$$;

-- O participante só vê a pergunta que está ativa no telão, ou perguntas
-- cujo resultado já foi revelado.
create or replace function public.can_view_question(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.questions q
    join public.sessions s on s.event_id = q.event_id
    join public.participants p on p.session_id = s.id
    where q.id = p_question_id
      and p.anonymous_token = (select auth.uid())
      and (s.active_question_id = q.id or q.results_visible)
  );
$$;

-- ---------------------------------------------------------------------
-- Normalização de texto (nuvem de palavras)
-- ---------------------------------------------------------------------

-- Sem dependência de extensão (unaccent): translate cobre o português.
create or replace function public.strip_accents(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    coalesce(p_text, ''),
    'áàãâäéèêëíìîïóòõôöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
  );
$$;

-- minúsculas + sem acento + sem pontuação + espaços duplicados colapsados.
-- "Automação!" e "  automacao " viram o mesmo termo "automacao".
create or replace function public.normalize_answer(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          lower(public.strip_accents(coalesce(p_text, ''))),
          '[^a-z0-9 -]', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

-- ---------------------------------------------------------------------
-- Código de acesso da sessão
-- ---------------------------------------------------------------------

-- Alfabeto sem caracteres ambíguos (sem O/0, I/1, S/5) para leitura no telão.
create or replace function public.generate_access_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  v_code     text;
  v_try      integer := 0;
begin
  loop
    v_code := '';
    for i in 1 .. 6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    if not exists (select 1 from public.sessions s where s.access_code = v_code) then
      return v_code;
    end if;

    v_try := v_try + 1;
    if v_try > 50 then
      raise exception 'Não foi possível gerar um código de acesso único';
    end if;
  end loop;
end;
$$;

alter table public.sessions
  alter column access_code set default public.generate_access_code();

-- ---------------------------------------------------------------------
-- Triggers de integridade
-- ---------------------------------------------------------------------

-- A pergunta ativa precisa pertencer ao mesmo evento da sessão;
-- started_at / finished_at são preenchidos automaticamente.
create or replace function public.sessions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active_question_id is not null then
    if not exists (
      select 1 from public.questions q
      where q.id = new.active_question_id and q.event_id = new.event_id
    ) then
      raise exception 'A pergunta ativa não pertence ao evento desta sessão';
    end if;
  end if;

  if new.status = 'live' and new.started_at is null then
    new.started_at := now();
  end if;

  if new.status = 'finished' and new.finished_at is null then
    new.finished_at := now();
    new.active_question_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists sessions_before_write on public.sessions;
create trigger sessions_before_write
  before insert or update on public.sessions
  for each row execute function public.sessions_before_write();

-- Valida e normaliza a resposta de acordo com o tipo e o config da pergunta.
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

  else -- single_choice / multiple_choice: as alternativas vão em response_options
    new.answer_text := null;
    new.normalized_text := null;
    new.numeric_value := null;
    new.bool_value := null;
  end if;

  return new;
end;
$$;

drop trigger if exists responses_before_insert on public.responses;
create trigger responses_before_insert
  before insert on public.responses
  for each row execute function public.responses_before_insert();

-- A alternativa escolhida tem de pertencer à pergunta respondida.
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
  else
    v_max_sel := coalesce((v_config ->> 'max_selections')::int, 999);
  end if;

  if v_selected + 1 > v_max_sel then
    raise exception 'Selecione no máximo % alternativa(s)', v_max_sel;
  end if;

  return new;
end;
$$;

drop trigger if exists response_options_before_insert on public.response_options;
create trigger response_options_before_insert
  before insert on public.response_options
  for each row execute function public.response_options_before_insert();

-- Registra automaticamente toda ocultação/reexibição de resposta.
create or replace function public.responses_log_moderation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_hidden is distinct from old.is_hidden then
    insert into public.moderation_actions (session_id, response_id, actor_id, action, reason)
    values (
      new.session_id,
      new.id,
      (select auth.uid()),
      case when new.is_hidden then 'hide' else 'unhide' end,
      nullif(current_setting('pulso.moderation_reason', true), '')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists responses_log_moderation on public.responses;
create trigger responses_log_moderation
  after update of is_hidden on public.responses
  for each row execute function public.responses_log_moderation();

-- ---------------------------------------------------------------------
-- RPC — participante entra na sessão
-- ---------------------------------------------------------------------
-- SECURITY DEFINER de propósito: é o único caminho para descobrir uma sessão
-- pelo código de acesso. A RLS de `sessions` não permite listar/varrer códigos.
create or replace function public.join_session(p_access_code text)
returns table (
  session_id         uuid,
  event_id           uuid,
  event_title        text,
  event_description  text,
  status             public.session_status,
  active_question_id uuid,
  participant_id     uuid
)
language plpgsql
security definer
set search_path = ''
as $$
-- `returns table (session_id uuid, ...)` cria variáveis PL/pgSQL com esses
-- nomes, e o `on conflict (session_id, ...)` abaixo ficaria ambíguo entre a
-- variável e a coluna. Aqui a coluna sempre vence — nenhuma variável de saída
-- é lida no corpo, então é seguro.
#variable_conflict use_column
declare
  v_session public.sessions;
  v_pid     uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sessão de autenticação anônima ausente' using errcode = '42501';
  end if;

  select * into v_session
  from public.sessions s
  where s.access_code = upper(btrim(coalesce(p_access_code, '')))
    and s.status in ('waiting', 'live');

  if v_session.id is null then
    raise exception 'Código inválido ou sessão não disponível' using errcode = 'P0002';
  end if;

  insert into public.participants as p (session_id, anonymous_token)
  values (v_session.id, (select auth.uid()))
  on conflict (session_id, anonymous_token)
    do update set session_id = excluded.session_id
  returning p.id into v_pid;

  return query
    select v_session.id,
           v_session.event_id,
           e.title,
           e.description,
           v_session.status,
           v_session.active_question_id,
           v_pid
    from public.events e
    where e.id = v_session.event_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC — participante envia resposta (caminho único de escrita do celular)
-- ---------------------------------------------------------------------
-- SECURITY INVOKER: a RLS continua valendo, então esta função não amplia
-- privilégio nenhum. Ela existe para gravar resposta + alternativas numa
-- única transação e para validar o mínimo de seleções.
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

  -- Só enxerga a pergunta ativa (RLS de questions).
  select q.type, q.config into v_type, v_config
  from public.questions q where q.id = p_question_id;

  if v_type is null then
    raise exception 'Esta pergunta não está aberta' using errcode = '42501';
  end if;

  -- Sem RETURNING de propósito: com RLS ativa, `INSERT ... RETURNING` aplica
  -- também a política de SELECT à linha devolvida, e `responses_select` só
  -- libera para o dono da sessão. O participante inseriria a linha e seria
  -- barrado ao receber o id de volta. O id é sorteado aqui e enviado junto.
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

    -- GET DIAGNOSTICS em vez de um SELECT de volta: o participante não tem
    -- permissão de leitura em response_options.
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

  return v_response_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RPCs — controle do apresentador
-- ---------------------------------------------------------------------
-- Todas SECURITY INVOKER: quem não é dono do evento é bloqueado pela RLS.

create or replace function public.open_question(p_session_id uuid, p_question_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.questions
     set status = 'open'
   where id = p_question_id;

  if not found then
    raise exception 'Pergunta não encontrada ou sem permissão' using errcode = '42501';
  end if;

  update public.sessions
     set active_question_id = p_question_id,
         status = case when status in ('draft', 'waiting') then 'live'::public.session_status
                       else status end
   where id = p_session_id;

  if not found then
    raise exception 'Sessão não encontrada ou sem permissão' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.close_question(p_question_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.questions set status = 'closed' where id = p_question_id;
  if not found then
    raise exception 'Pergunta não encontrada ou sem permissão' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.set_results_visible(p_question_id uuid, p_visible boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.questions set results_visible = p_visible where id = p_question_id;
  if not found then
    raise exception 'Pergunta não encontrada ou sem permissão' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.set_response_hidden(
  p_response_id uuid,
  p_hidden      boolean,
  p_reason      text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('pulso.moderation_reason', coalesce(p_reason, ''), true);

  update public.responses set is_hidden = p_hidden where id = p_response_id;
  if not found then
    raise exception 'Resposta não encontrada ou sem permissão' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.finish_session(p_session_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.sessions
     set status = 'finished'
   where id = p_session_id;

  if not found then
    raise exception 'Sessão não encontrada ou sem permissão' using errcode = '42501';
  end if;

  update public.questions q
     set status = 'closed'
   where q.event_id = (select s.event_id from public.sessions s where s.id = p_session_id)
     and q.status = 'open';
end;
$$;

-- ---------------------------------------------------------------------
-- Grants de execução
-- ---------------------------------------------------------------------
revoke all on function public.join_session(text)          from public, anon;
revoke all on function public.generate_access_code()      from public, anon;

grant execute on function public.join_session(text)                                   to authenticated;
grant execute on function public.can_add_response_option(uuid)                        to authenticated;
grant execute on function public.can_answer_question(uuid, uuid)                      to authenticated;
grant execute on function public.submit_response(uuid, uuid, text, numeric, boolean, uuid[]) to authenticated;
grant execute on function public.open_question(uuid, uuid)                            to authenticated;
grant execute on function public.close_question(uuid)                                 to authenticated;
grant execute on function public.set_results_visible(uuid, boolean)                   to authenticated;
grant execute on function public.set_response_hidden(uuid, boolean, text)             to authenticated;
grant execute on function public.finish_session(uuid)                                 to authenticated;
grant execute on function public.generate_access_code()                               to authenticated;

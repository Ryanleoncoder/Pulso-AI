-- =====================================================================
-- Pulso IA — 0001 — Tipos, tabelas e índices
-- =====================================================================
-- Modelo de identidade:
--   * Apresentador  -> usuário fixo + senha (apresentador@pulso.local).
--   * Participante  -> Supabase Anonymous Sign-in (auth.signInAnonymously()).
--     O auth.uid() do usuário anônimo é o "identificador anônimo salvo no
--     navegador" descrito no plano. Nenhum nome, e-mail, matrícula ou IP é
--     coletado.
-- Habilite em: Dashboard > Authentication > Sign In / Providers > Anonymous.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type public.session_status as enum ('draft', 'waiting', 'live', 'finished');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.question_type as enum (
    'word_cloud', 'single_choice', 'multiple_choice', 'boolean', 'scale', 'open_text'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.question_phase as enum ('pre', 'live', 'post');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.question_status as enum ('draft', 'open', 'closed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- events — atividade ou reunião
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 2000),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists events_owner_id_idx on public.events (owner_id);

-- ---------------------------------------------------------------------
-- questions — perguntas e suas configurações
-- ---------------------------------------------------------------------
-- config (jsonb) por tipo:
--   word_cloud      {"max_chars": 30, "max_words": 3}
--   open_text       {"max_chars": 280}
--   scale           {"min": 1, "max": 5, "min_label": "...", "max_label": "..."}
--   multiple_choice {"max_selections": 2}
--   qualquer        {"time_limit_seconds": 60}
create table if not exists public.questions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  type            public.question_type not null,
  phase           public.question_phase not null default 'live',
  prompt          text not null check (char_length(prompt) between 1 and 500),
  description     text check (char_length(description) <= 1000),
  "position"      integer not null check ("position" > 0),
  status          public.question_status not null default 'draft',
  results_visible boolean not null default false,
  config          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (event_id, "position")
);

create index if not exists questions_event_id_idx on public.questions (event_id, "position");

-- ---------------------------------------------------------------------
-- question_options — alternativas (conteúdo público para o participante)
-- ---------------------------------------------------------------------
create table if not exists public.question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 200),
  "position"  integer not null check ("position" > 0),
  created_at  timestamptz not null default now(),
  unique (question_id, "position")
);

create index if not exists question_options_question_id_idx
  on public.question_options (question_id, "position");

-- ---------------------------------------------------------------------
-- question_answer_keys — gabarito + explicação (TABELA SEPARADA DE PROPÓSITO)
-- ---------------------------------------------------------------------
-- Mantida fora de question_options para que o participante possa ler os
-- rótulos das alternativas sem conseguir ler qual é a correta antes da
-- revelação. A RLS libera esta tabela apenas quando results_visible = true.
create table if not exists public.question_answer_keys (
  question_id        uuid primary key references public.questions (id) on delete cascade,
  correct_option_ids uuid[] not null default '{}'::uuid[],
  correct_boolean    boolean,
  explanation        text check (char_length(explanation) <= 2000)
);

-- ---------------------------------------------------------------------
-- sessions — sessão aberta para participação
-- ---------------------------------------------------------------------
create table if not exists public.sessions (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.events (id) on delete cascade,
  access_code        text not null unique check (access_code ~ '^[A-Z0-9]{6}$'),
  status             public.session_status not null default 'draft',
  active_question_id uuid references public.questions (id) on delete set null,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists sessions_event_id_idx on public.sessions (event_id);
create index if not exists sessions_status_idx on public.sessions (status);

-- ---------------------------------------------------------------------
-- participants — participante anônimo da sessão
-- ---------------------------------------------------------------------
create table if not exists public.participants (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions (id) on delete cascade,
  anonymous_token uuid not null default auth.uid(),
  joined_at       timestamptz not null default now(),
  unique (session_id, anonymous_token)
);

create index if not exists participants_session_id_idx on public.participants (session_id);

-- ---------------------------------------------------------------------
-- responses — respostas abertas, numéricas, booleanas ou de escala
-- ---------------------------------------------------------------------
create table if not exists public.responses (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions (id) on delete cascade,
  question_id     uuid not null references public.questions (id) on delete cascade,
  participant_id  uuid not null references public.participants (id) on delete cascade,
  answer_text     text check (char_length(answer_text) <= 500),
  normalized_text text,
  numeric_value   numeric,
  bool_value      boolean,
  is_hidden       boolean not null default false,
  created_at      timestamptz not null default now(),
  -- Cada navegador responde apenas uma vez por pergunta.
  unique (question_id, participant_id)
);

create index if not exists responses_session_question_idx
  on public.responses (session_id, question_id);
create index if not exists responses_word_cloud_idx
  on public.responses (question_id, normalized_text) where is_hidden = false;
create index if not exists responses_participant_idx
  on public.responses (participant_id);

-- ---------------------------------------------------------------------
-- response_options — alternativas selecionadas
-- ---------------------------------------------------------------------
create table if not exists public.response_options (
  response_id uuid not null references public.responses (id) on delete cascade,
  option_id   uuid not null references public.question_options (id) on delete cascade,
  primary key (response_id, option_id)
);

create index if not exists response_options_option_id_idx on public.response_options (option_id);

-- ---------------------------------------------------------------------
-- moderation_actions — respostas ocultadas pelo apresentador
-- ---------------------------------------------------------------------
create table if not exists public.moderation_actions (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions (id) on delete cascade,
  response_id uuid not null references public.responses (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null check (action in ('hide', 'unhide')),
  reason      text check (char_length(reason) <= 500),
  created_at  timestamptz not null default now()
);

create index if not exists moderation_actions_session_idx
  on public.moderation_actions (session_id, created_at desc);

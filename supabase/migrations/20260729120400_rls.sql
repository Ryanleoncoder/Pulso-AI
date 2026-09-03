-- =====================================================================
-- Pulso IA — 0004 — Row Level Security
-- =====================================================================
-- Regras que estas políticas implementam:
--   * RLS ativa em todas as tabelas públicas.
--   * Somente o apresentador autenticado (dono do evento) cria/edita
--     eventos, sessões e perguntas.
--   * O participante NUNCA lê respostas brutas — nem as suas.
--   * O participante só grava resposta para a pergunta ATIVA e ABERTA,
--     em sessão com status 'live'.
--   * O gabarito só aparece depois de results_visible = true.
--   * A role `anon` (chave pública sem login) não tem acesso a nada:
--     o participante precisa do anonymous sign-in, que o coloca em
--     `authenticated` com a claim is_anonymous = true.
-- =====================================================================

alter table public.events             enable row level security;
alter table public.questions          enable row level security;
alter table public.question_options   enable row level security;
alter table public.question_answer_keys enable row level security;
alter table public.sessions           enable row level security;
alter table public.participants       enable row level security;
alter table public.responses          enable row level security;
alter table public.response_options   enable row level security;
alter table public.moderation_actions enable row level security;

-- A chave anônima sem login não fala com nenhuma tabela.
revoke all on public.events, public.questions, public.question_options,
              public.question_answer_keys, public.sessions, public.participants,
              public.responses, public.response_options, public.moderation_actions
  from anon;

-- ---------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------
drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated
  using (
    public.is_event_owner(id)
    or exists (
      select 1 from public.sessions s
      where s.event_id = events.id
        and public.is_session_participant(s.id)
    )
  );

drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated
  with check (public.is_presenter() and owner_id = (select auth.uid()));

drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated
  using (public.is_presenter() and owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete to authenticated
  using (public.is_presenter() and owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- questions
-- ---------------------------------------------------------------------
drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions
  for select to authenticated
  using (
    public.is_event_owner(event_id)
    or public.can_view_question(id)
  );

drop policy if exists questions_insert on public.questions;
create policy questions_insert on public.questions
  for insert to authenticated
  with check (public.is_presenter() and public.is_event_owner(event_id));

drop policy if exists questions_update on public.questions;
create policy questions_update on public.questions
  for update to authenticated
  using (public.is_presenter() and public.is_event_owner(event_id))
  with check (public.is_event_owner(event_id));

drop policy if exists questions_delete on public.questions;
create policy questions_delete on public.questions
  for delete to authenticated
  using (public.is_presenter() and public.is_event_owner(event_id));

-- ---------------------------------------------------------------------
-- question_options — rótulos são públicos para quem vê a pergunta
-- ---------------------------------------------------------------------
drop policy if exists question_options_select on public.question_options;
create policy question_options_select on public.question_options
  for select to authenticated
  using (
    public.is_question_owner(question_id)
    or public.can_view_question(question_id)
  );

drop policy if exists question_options_write on public.question_options;
create policy question_options_write on public.question_options
  for all to authenticated
  using (public.is_presenter() and public.is_question_owner(question_id))
  with check (public.is_presenter() and public.is_question_owner(question_id));

-- ---------------------------------------------------------------------
-- question_answer_keys — gabarito só depois da revelação
-- ---------------------------------------------------------------------
drop policy if exists answer_keys_select on public.question_answer_keys;
create policy answer_keys_select on public.question_answer_keys
  for select to authenticated
  using (
    public.is_question_owner(question_id)
    or exists (
      select 1 from public.questions q
      where q.id = question_answer_keys.question_id
        and q.results_visible
        and public.can_view_question(q.id)
    )
  );

drop policy if exists answer_keys_write on public.question_answer_keys;
create policy answer_keys_write on public.question_answer_keys
  for all to authenticated
  using (public.is_presenter() and public.is_question_owner(question_id))
  with check (public.is_presenter() and public.is_question_owner(question_id));

-- ---------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------
-- Sem política de busca por access_code: descobrir a sessão só via
-- rpc('join_session'). Assim ninguém consegue varrer códigos ativos.
drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated
  using (
    public.is_session_owner(id)
    or public.is_session_participant(id)
  );

drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions
  for insert to authenticated
  with check (public.is_presenter() and public.is_event_owner(event_id));

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
  for update to authenticated
  using (public.is_presenter() and public.is_event_owner(event_id))
  with check (public.is_event_owner(event_id));

drop policy if exists sessions_delete on public.sessions;
create policy sessions_delete on public.sessions
  for delete to authenticated
  using (public.is_presenter() and public.is_event_owner(event_id));

-- ---------------------------------------------------------------------
-- participants
-- ---------------------------------------------------------------------
drop policy if exists participants_select on public.participants;
create policy participants_select on public.participants
  for select to authenticated
  using (
    public.is_session_owner(session_id)
    or anonymous_token = (select auth.uid())
  );

drop policy if exists participants_insert on public.participants;
create policy participants_insert on public.participants
  for insert to authenticated
  with check (
    anonymous_token = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = participants.session_id
        and s.status in ('waiting', 'live')
    )
  );

drop policy if exists participants_delete on public.participants;
create policy participants_delete on public.participants
  for delete to authenticated
  using (public.is_presenter() and public.is_session_owner(session_id));

-- ---------------------------------------------------------------------
-- responses
-- ---------------------------------------------------------------------
-- Leitura: SOMENTE o apresentador. O participante não lê resposta bruta,
-- nem a própria — o feedback na tela dele é local, sem round-trip.
drop policy if exists responses_select on public.responses;
create policy responses_select on public.responses
  for select to authenticated
  using (public.is_session_owner(session_id));

-- can_answer_question() em vez de um EXISTS correlacionado sobre sessions e
-- questions: aquelas duas têm RLS própria, que seria avaliada em cascata dentro
-- da avaliação desta política. O helper responde a mesma coisa num booleano.
drop policy if exists responses_insert on public.responses;
create policy responses_insert on public.responses
  for insert to authenticated
  with check (
    participant_id = public.my_participant_id(session_id)
    and public.can_answer_question(session_id, question_id)
  );

-- Apenas o apresentador altera resposta, e só para ocultar/reexibir.
drop policy if exists responses_update on public.responses;
create policy responses_update on public.responses
  for update to authenticated
  using (public.is_presenter() and public.is_session_owner(session_id))
  with check (public.is_session_owner(session_id));

drop policy if exists responses_delete on public.responses;
create policy responses_delete on public.responses
  for delete to authenticated
  using (public.is_presenter() and public.is_session_owner(session_id));

-- ---------------------------------------------------------------------
-- response_options
-- ---------------------------------------------------------------------
drop policy if exists response_options_select on public.response_options;
create policy response_options_select on public.response_options
  for select to authenticated
  using (
    exists (
      select 1 from public.responses r
      where r.id = response_options.response_id
        and public.is_session_owner(r.session_id)
    )
  );

-- Não pode consultar `responses` aqui: o participante não tem select nessa
-- tabela. can_add_response_option() responde só sim/não, sem expor conteúdo.
drop policy if exists response_options_insert on public.response_options;
create policy response_options_insert on public.response_options
  for insert to authenticated
  with check (
    public.can_add_response_option(response_id)
    or exists (
      select 1 from public.responses r
      where r.id = response_options.response_id
        and public.is_session_owner(r.session_id)
    )
  );

drop policy if exists response_options_delete on public.response_options;
create policy response_options_delete on public.response_options
  for delete to authenticated
  using (
    exists (
      select 1 from public.responses r
      where r.id = response_options.response_id
        and public.is_presenter()
        and public.is_session_owner(r.session_id)
    )
  );

-- ---------------------------------------------------------------------
-- moderation_actions — trilha de auditoria, só o apresentador
-- ---------------------------------------------------------------------
drop policy if exists moderation_select on public.moderation_actions;
create policy moderation_select on public.moderation_actions
  for select to authenticated
  using (public.is_session_owner(session_id));

-- Escrita só pelo trigger (SECURITY DEFINER). Nenhuma política de insert:
-- inserção manual pelo cliente fica bloqueada.

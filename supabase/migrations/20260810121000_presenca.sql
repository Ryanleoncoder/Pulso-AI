-- =====================================================================
-- Pulso IA — 0011 — Quem está presente agora, além de quem já entrou
-- =====================================================================
-- `participants` é um registro de entrada: nunca diminui, e não existe evento
-- de "saiu". Usar essa contagem como denominador de "X de Y responderam" infla
-- o Y com quem foi embora, com aba anônima e com participante de teste, e faz a
-- sala parecer menos participativa do que é.
--
-- Cada celular bate um heartbeat de 20 s enquanto está com a tela aberta.
-- "Presente" passa a ser quem deu sinal há menos de 90 segundos — quatro
-- batidas de folga, para o número não oscilar a cada oscilação de rede.
--
-- Os dois números convivem e servem a coisas diferentes: o total é evidência
-- ("participaram N pessoas"), o presente é leitura ao vivo ("quantos faltam
-- responder"). Nenhum dos dois identifica ninguém.
-- =====================================================================

alter table public.participants
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists participants_last_seen_idx
  on public.participants (session_id, last_seen_at desc);

-- Atualiza só a própria linha, casada por auth.uid().
create or replace function public.heartbeat(p_session_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.participants
     set last_seen_at = now()
   where session_id = p_session_id
     and anonymous_token = (select auth.uid());
$$;

revoke all on function public.heartbeat(uuid) from public, anon;
grant execute on function public.heartbeat(uuid) to authenticated;

-- Entrar também conta como sinal de vida.
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
language plpgsql security definer set search_path = '' as $$
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
    do update set last_seen_at = now()
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

revoke all on function public.join_session(text) from public, anon;
grant execute on function public.join_session(text) to authenticated;

-- A view ganha o número de presentes, sem perder o total.
-- DROP e não CREATE OR REPLACE: a coluna nova entra no meio, e o Postgres só
-- deixa acrescentar no fim ao substituir uma view.
drop view if exists public.v_session_overview;
create view public.v_session_overview
with (security_invoker = on) as
select
  s.id     as session_id,
  s.event_id,
  e.title  as event_title,
  s.access_code,
  s.status,
  s.active_question_id,
  s.started_at,
  s.finished_at,
  (select count(*) from public.participants p where p.session_id = s.id)::int as participants,
  (select count(*) from public.participants p
    where p.session_id = s.id
      and p.last_seen_at > now() - interval '90 seconds')::int                as participants_online,
  (select count(*) from public.responses r
    where r.session_id = s.id and r.is_hidden = false)::int                   as answers
from public.sessions s
join public.events e on e.id = s.event_id;

revoke all on public.v_session_overview from anon;
grant select on public.v_session_overview to authenticated;

-- =====================================================================
-- Pulso IA — 0003 — Views de resultado e exportação
-- =====================================================================
-- Todas com security_invoker = on: a RLS das tabelas de base continua
-- valendo, então só o apresentador dono do evento enxerga os agregados.
-- Nenhuma view expõe participant_id / anonymous_token.
-- =====================================================================

-- Nuvem de palavras: termo normalizado + frequência.
-- O peso (weight) é o que define o tamanho da palavra na tela.
create or replace view public.v_word_cloud
with (security_invoker = on) as
select
  r.session_id,
  r.question_id,
  r.normalized_text                  as term,
  min(btrim(r.answer_text))          as sample_text,
  count(*)::int                      as weight
from public.responses r
join public.questions q on q.id = r.question_id
where q.type = 'word_cloud'
  and r.is_hidden = false
  and r.normalized_text is not null
group by r.session_id, r.question_id, r.normalized_text;

-- Escolha única / múltipla: inclui alternativas com zero votos.
create or replace view public.v_option_results
with (security_invoker = on) as
select
  s.id                as session_id,
  o.question_id,
  o.id                as option_id,
  o.label,
  o."position",
  count(r.id)::int    as votes
from public.sessions s
join public.questions q        on q.event_id = s.event_id
join public.question_options o on o.question_id = q.id
left join public.response_options ro on ro.option_id = o.id
left join public.responses r on r.id = ro.response_id
                            and r.session_id = s.id
                            and r.is_hidden = false
group by s.id, o.question_id, o.id, o.label, o."position";

-- Verdadeiro / falso.
create or replace view public.v_boolean_results
with (security_invoker = on) as
select
  r.session_id,
  r.question_id,
  count(*) filter (where r.bool_value)::int       as yes_count,
  count(*) filter (where not r.bool_value)::int   as no_count,
  count(*)::int                                   as total
from public.responses r
join public.questions q on q.id = r.question_id
where q.type = 'boolean'
  and r.is_hidden = false
  and r.bool_value is not null
group by r.session_id, r.question_id;

-- Escala 1 a 5: contagem por valor (histograma).
create or replace view public.v_scale_results
with (security_invoker = on) as
select
  r.session_id,
  r.question_id,
  r.numeric_value::int as value,
  count(*)::int        as total
from public.responses r
join public.questions q on q.id = r.question_id
where q.type = 'scale'
  and r.is_hidden = false
  and r.numeric_value is not null
group by r.session_id, r.question_id, r.numeric_value;

-- Escala: média e total, para o número grande no telão.
create or replace view public.v_scale_summary
with (security_invoker = on) as
select
  r.session_id,
  r.question_id,
  round(avg(r.numeric_value), 2) as average,
  count(*)::int                  as total
from public.responses r
join public.questions q on q.id = r.question_id
where q.type = 'scale'
  and r.is_hidden = false
  and r.numeric_value is not null
group by r.session_id, r.question_id;

-- Texto aberto: uma linha por resposta, sem identificar quem respondeu.
-- Inclui is_hidden para o apresentador poder moderar antes de exibir.
create or replace view public.v_open_text_responses
with (security_invoker = on) as
select
  r.id as response_id,
  r.session_id,
  r.question_id,
  btrim(r.answer_text) as answer_text,
  r.is_hidden,
  r.created_at
from public.responses r
join public.questions q on q.id = r.question_id
where q.type in ('open_text', 'word_cloud');

-- Painel geral da sessão: participantes e respostas por pergunta.
create or replace view public.v_question_progress
with (security_invoker = on) as
select
  s.id                as session_id,
  q.id                as question_id,
  q."position",
  q.phase,
  q.type,
  q.prompt,
  q.status,
  q.results_visible,
  count(r.id) filter (where r.is_hidden = false)::int as answers,
  count(r.id) filter (where r.is_hidden)::int         as hidden_answers
from public.sessions s
join public.questions q on q.event_id = s.event_id
left join public.responses r on r.question_id = q.id and r.session_id = s.id
group by s.id, q.id, q."position", q.phase, q.type, q.prompt, q.status, q.results_visible;

create or replace view public.v_session_overview
with (security_invoker = on) as
select
  s.id            as session_id,
  s.event_id,
  e.title         as event_title,
  s.access_code,
  s.status,
  s.active_question_id,
  s.started_at,
  s.finished_at,
  (select count(*) from public.participants p where p.session_id = s.id)::int as participants,
  (select count(*) from public.responses r
    where r.session_id = s.id and r.is_hidden = false)::int                   as answers
from public.sessions s
join public.events e on e.id = s.event_id;

-- Exportação CSV / evidência acadêmica.
-- respondent_ref é um pseudônimo estável dentro da sessão (hash curto do id
-- aleatório do participante) — permite ver que respostas vieram do mesmo
-- celular sem nunca identificar a pessoa.
create or replace view public.v_export_responses
with (security_invoker = on) as
select
  s.id                          as session_id,
  s.access_code,
  e.title                       as event_title,
  q."position"                  as question_position,
  q.phase,
  q.type                        as question_type,
  q.prompt,
  left(md5(r.participant_id::text), 8) as respondent_ref,
  coalesce(
    btrim(r.answer_text),
    r.numeric_value::text,
    case when r.bool_value is null then null
         when r.bool_value then 'Sim' else 'Não' end,
    (
      select string_agg(o.label, ' | ' order by o."position")
      from public.response_options ro
      join public.question_options o on o.id = ro.option_id
      where ro.response_id = r.id
    )
  )                             as answer,
  r.normalized_text,
  r.is_hidden,
  r.created_at
from public.responses r
join public.questions q on q.id = r.question_id
join public.sessions  s on s.id = r.session_id
join public.events    e on e.id = q.event_id;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on public.v_word_cloud, public.v_option_results, public.v_boolean_results,
              public.v_scale_results, public.v_scale_summary, public.v_open_text_responses,
              public.v_question_progress, public.v_session_overview, public.v_export_responses
  from anon;

grant select on public.v_word_cloud, public.v_option_results, public.v_boolean_results,
                public.v_scale_results, public.v_scale_summary, public.v_open_text_responses,
                public.v_question_progress, public.v_session_overview, public.v_export_responses
  to authenticated;

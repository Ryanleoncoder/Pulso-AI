-- =====================================================================
-- Pulso IA — seed da reunião "IA no trabalho"
-- =====================================================================
-- Antes de rodar:
--   1. Crie o usuário do apresentador (Dashboard > Authentication > Users) com
--      o login abaixo — ou deixe o `npm run setup:supabase` criar.
--   2. Ajuste v_owner_login se quiser outro nome de usuário.
--
-- O login é `apresentador@pulso.local`: o Supabase Auth exige e-mail ou telefone
-- como identificador, então usamos um endereço sintético no domínio reservado
-- `.local`. Ele nunca recebe mensagem e não é o e-mail de ninguém — nenhum dado
-- pessoal entra no banco, nem do apresentador nem dos participantes.
--
-- Segurança do re-run: se o evento já existir e JÁ TIVER RESPOSTAS, o script
-- aborta em vez de apagar sua evidência. Sem respostas, ele recria do zero.
-- =====================================================================

do $$
declare
  v_owner_login text := 'apresentador@pulso.local';
  v_event_title text := 'IA no trabalho — encontro prático';
  v_access_code text := 'PULSO1';

  v_owner    uuid;
  v_event    uuid;
  v_session  uuid;
  v_q        uuid;
  v_opt      uuid;
begin
  select id into v_owner from auth.users where email = v_owner_login limit 1;
  if v_owner is null then
    raise exception
      'Usuário % não existe. Rode `npm run setup:supabase`, ou crie em Authentication > Users com este login exato.',
      v_owner_login;
  end if;

  select id into v_event
  from public.events
  where owner_id = v_owner and title = v_event_title
  limit 1;

  if v_event is not null then
    if exists (
      select 1 from public.responses r
      join public.questions q on q.id = r.question_id
      where q.event_id = v_event
    ) then
      raise exception 'O evento "%" já tem respostas gravadas. Renomeie v_event_title ou apague o evento manualmente.', v_event_title;
    end if;
    delete from public.events where id = v_event;
  end if;

  -- -------------------------------------------------------------------
  -- Evento
  -- -------------------------------------------------------------------
  insert into public.events (title, description, owner_id)
  values (
    v_event_title,
    'Atividade de participação ao vivo sobre uso de inteligência artificial na rotina de trabalho.',
    v_owner
  )
  returning id into v_event;

  -- -------------------------------------------------------------------
  -- 1. Abertura — nuvem de palavras
  -- -------------------------------------------------------------------
  insert into public.questions (event_id, type, phase, prompt, description, "position", config)
  values (
    v_event, 'word_cloud', 'pre',
    'Em uma palavra, o que vem à sua mente quando falamos de IA no trabalho?',
    'Até 3 palavras por resposta, e você pode mandar 3 respostas.',
    1,
    '{"max_chars": 30, "max_words": 3, "max_entries": 3}'::jsonb
  );

  -- -------------------------------------------------------------------
  -- 2. Diagnóstico ao vivo — múltipla escolha (até 2)
  -- -------------------------------------------------------------------
  insert into public.questions (event_id, type, phase, prompt, description, "position", config)
  values (
    v_event, 'multiple_choice', 'live',
    'Qual é hoje sua maior dificuldade com IA?',
    'Escolha até duas opções.',
    2,
    '{"max_selections": 2}'::jsonb
  )
  returning id into v_q;

  insert into public.question_options (question_id, label, "position") values
    (v_q, 'Não sei por onde começar',                              1),
    (v_q, 'Não confio na qualidade das respostas',                 2),
    (v_q, 'Falta tempo para aprender e testar',                    3),
    (v_q, 'Tenho dúvidas sobre segurança e dados sensíveis',       4),
    (v_q, 'Não consigo ver aplicação na minha rotina',             5),
    (v_q, 'A ferramenta que uso é limitada ou bloqueada',          6);

  -- -------------------------------------------------------------------
  -- 3. Percepção de nível — escolha única
  -- -------------------------------------------------------------------
  -- Entra logo depois do slide que explica os níveis de uso de IA. Serve para
  -- comparar a autopercepção da pesquisa inicial com a percepção depois que
  -- todos passaram a usar a mesma régua. Sem gabarito: nenhuma opção é certa.
  -- Os rótulos e a ordem são os do slide, propositalmente iguais.
  insert into public.questions (event_id, type, phase, prompt, description, "position", config)
  values (
    v_event, 'single_choice', 'live',
    'Depois de conhecer melhor esses níveis, onde você se colocaria hoje?',
    'Agora que temos uma régua em comum, sua percepção mudou?',
    3,
    '{}'::jsonb
  )
  returning id into v_q;

  insert into public.question_options (question_id, label, "position") values
    (v_q, 'Média',         1),
    (v_q, 'Boa',           2),
    (v_q, 'Intermediária', 3),
    (v_q, 'Avançada',      4);

  -- -------------------------------------------------------------------
  -- 4. IA com propósito — verdadeiro ou falso + discussão
  -- -------------------------------------------------------------------
  insert into public.questions (event_id, type, phase, prompt, description, "position", config)
  values (
    v_event, 'boolean', 'live',
    'Toda atividade pode ser melhorada simplesmente adicionando IA?',
    'Responda sim ou não. Depois discutimos o resultado.',
    4,
    '{"yes_label": "Sim", "no_label": "Não"}'::jsonb
  )
  returning id into v_q;

  insert into public.question_answer_keys (question_id, correct_boolean, explanation)
  values (
    v_q, false,
    'Não. IA agrega valor onde há volume, repetição, texto ou dados a interpretar — e sempre com um critério humano validando o resultado. '
    'Em tarefas de pouca repetição, regra fixa ou alto custo de erro, acrescentar IA gera retrabalho e revisão. '
    'A pergunta útil não é "onde dá para usar IA?", e sim "qual problema eu quero resolver?".'
  );

  -- -------------------------------------------------------------------
  -- 5. Segurança — O que diria no megafone? (Cards / Tinder swipe)
  -- -------------------------------------------------------------------
  insert into public.questions (event_id, type, phase, prompt, description, "position", config)
  values (
    v_event, 'swipe_card', 'live',
    'Você diria isso em um megafone? (O que enviar para a IA)',
    'Arraste para a DIREITA se pode enviar para a IA, ou ESQUERDA se não deve enviar.',
    5,
    '{"right_label": "Pode enviar", "left_label": "Não enviar"}'::jsonb
  )
  returning id into v_q;

  insert into public.question_options (question_id, label, description, "position") values
    (v_q, '🔑 Senhas e tokens de API',         'Credenciais de acesso a sistemas ou bancos de dados', 1),
    (v_q, '👤 CPF e dados de clientes',        'Informações pessoais identificáveis de clientes (LGPD)', 2),
    (v_q, '📋 Ata de reunião pública',          'Resumo de ideias gerais sem segredos industriais', 3),
    (v_q, '📄 Contrato com sigilo (NDA)',       'Documento jurídico com cláusula de confidencialidade', 4),
    (v_q, '📊 Planilha anonimizada',            'Dados numéricos agregados sem nomes ou identificadores', 5),
    (v_q, '📝 Rascunho de e-mail genérico',     'Texto institucional de rotina sem informações sensíveis', 6);

  insert into public.question_answer_keys (question_id, correct_option_ids, explanation)
  select
    v_q,
    array_agg(o.id),
    'Nunca envie senhas, dados pessoais (CPF/LGPD) ou documentos confidenciais com NDA para IAs públicas. Dados anonimizados, textos genéricos e resumos sem segredos podem ser enviados com segurança.'
  from public.question_options o
  where o.question_id = v_q and o.position in (3, 5, 6);


  -- -------------------------------------------------------------------
  -- 6. Aplicação — múltipla escolha (até 2)
  -- -------------------------------------------------------------------
  insert into public.questions (event_id, type, phase, prompt, description, "position", config)
  values (
    v_event, 'multiple_choice', 'live',
    'Em qual atividade a IA poderia gerar mais valor para sua rotina?',
    'Escolha até duas opções.',
    6,
    '{"max_selections": 2}'::jsonb
  )
  returning id into v_q;

  insert into public.question_options (question_id, label, "position") values
    (v_q, 'Redigir e revisar textos e e-mails',                       1),
    (v_q, 'Resumir documentos, atas e reuniões longas',               2),
    (v_q, 'Organizar e analisar dados e planilhas',                   3),
    (v_q, 'Preparar materiais de treinamento e apresentações',        4),
    (v_q, 'Buscar e comparar informações internas',                   5),
    (v_q, 'Rascunhar respostas para demandas recorrentes',            6);

  -- -------------------------------------------------------------------
  -- 7. Aplicação (opcional) — texto aberto
  -- -------------------------------------------------------------------
  -- Fica em 'draft'. Abra apenas se sobrar tempo: serve para justificar a
  -- escolha da pergunta 6 e exercita o tipo open_text.
  insert into public.questions (event_id, type, phase, prompt, description, "position", config)
  values (
    v_event, 'open_text', 'live',
    'Em uma frase: qual tarefa você automatizaria com IA já na próxima semana?',
    'Até 280 caracteres.',
    7,
    '{"max_chars": 280}'::jsonb
  );

  -- -------------------------------------------------------------------
  -- 8. Agentes — escolha única
  -- -------------------------------------------------------------------
  -- Fecha o bloco de agentes, antes da síntese. Sem gabarito de propósito: a
  -- resposta certa depende do risco de cada contexto, e é isso que se discute.
  insert into public.questions (event_id, type, phase, prompt, description, "position", config)
  values (
    v_event, 'single_choice', 'live',
    'Até onde você permitiria que um agente atuasse sem sua aprovação?',
    'Quanto mais autonomia, maior deve ser o controle.',
    8,
    '{}'::jsonb
  )
  returning id into v_q;

  insert into public.question_options (question_id, label, "position") values
    (v_q, 'Organizar informações',               1),
    (v_q, 'Produzir recomendações',              2),
    (v_q, 'Preparar ações para minha aprovação', 3),
    (v_q, 'Executar ações automaticamente',      4),
    (v_q, 'Depende do risco',                    5);

  -- -------------------------------------------------------------------
  -- 9. Encerramento — nuvem de palavras (par da pergunta 1)
  -- -------------------------------------------------------------------
  insert into public.questions (event_id, type, phase, prompt, description, "position", config)
  values (
    v_event, 'word_cloud', 'post',
    'Depois deste encontro, qual palavra representa sua visão sobre IA?',
    'Até 3 palavras por resposta, e você pode mandar 3 respostas.',
    9,
    '{"max_chars": 30, "max_words": 3, "max_entries": 3, "compare_with_position": 1}'::jsonb
  );

  -- -------------------------------------------------------------------
  -- 10. Avaliação — escala 1 a 5
  -- -------------------------------------------------------------------
  insert into public.questions (event_id, type, phase, prompt, description, "position", config)
  values (
    v_event, 'scale', 'post',
    'Quanto a atividade ampliou sua compreensão sobre IA no trabalho?',
    'De 1 (não ampliou) a 5 (ampliou muito).',
    10,
    '{"min": 1, "max": 5, "min_label": "Não ampliou", "max_label": "Ampliou muito"}'::jsonb
  );

  -- -------------------------------------------------------------------
  -- Sessão pronta para receber os participantes
  -- -------------------------------------------------------------------
  insert into public.sessions (event_id, access_code, status)
  values (v_event, v_access_code, 'waiting')
  returning id into v_session;

  raise notice '=======================================================';
  raise notice 'Evento:  %', v_event;
  raise notice 'Sessão:  %', v_session;
  raise notice 'Código:  %', v_access_code;
  raise notice 'Perguntas: 8 (a de número 6 é opcional)';
  raise notice '=======================================================';
end $$;

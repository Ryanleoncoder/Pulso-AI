-- =====================================================================
-- Pulso IA — 0009 — Reabrir uma sessão encerrada
-- =====================================================================
-- finish_session era caminho só de ida. Sem isto, encerrar por engano no meio
-- da reunião significaria criar outra sessão, com outro código, e pedir para a
-- sala inteira escanear o QR de novo.
--
-- Volta para 'waiting' (o telão mostra o QR outra vez) e limpa finished_at.
-- As respostas ficam: reabrir não é recomeçar, é retomar. A pergunta ativa foi
-- zerada pelo trigger ao encerrar, então o apresentador escolhe onde retomar.
-- =====================================================================

create or replace function public.reopen_session(p_session_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.sessions
     set status = 'waiting',
         finished_at = null
   where id = p_session_id;

  if not found then
    raise exception 'Sessão não encontrada ou sem permissão' using errcode = '42501';
  end if;
end;
$$;

-- Função nova nasce com EXECUTE para PUBLIC; fecha na hora (ver 0007).
revoke all on function public.reopen_session(uuid) from public, anon;
grant execute on function public.reopen_session(uuid) to authenticated;

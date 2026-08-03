-- Test af `sql/predictions_updated_at.sql` (G13).
--
-- Kører mod en TOM engangsdatabase. Rører aldrig produktion.
--
-- HVAD DEN BEVISER
--   1. En rettelse af et tip flytter `updated_at`.
--   2. En gen-skrivning af den SAMME score gør ikke — klienten gemmer ved hvert
--      ophold i indtastningen, og et felt, der flytter sig uden at noget skete,
--      ville gøre "aktiv" til "åbnede skærmen".
--   3. Et nyt tip får tidspunktet af kolonnens default, som før.
--
-- Testen findes, fordi en manglende trigger er USYNLIG: feltet har en default,
-- så det ser rigtigt ud på en frisk række, og fejlen viser sig først som et
-- Analytics-tal, der er lidt for lavt — hvilket ingen kan se er forkert.

\set ON_ERROR_STOP on
\timing off

create table public.predictions (
  user_id uuid not null,
  match_id uuid not null,
  pred_home int not null,
  pred_away int not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, match_id)
);

\ir ../predictions_updated_at.sql

do $$
declare
  u uuid := '00000000-0000-0000-0000-000000000001';
  m uuid := '10000000-0000-0000-0000-000000000001';
  t0 timestamptz;
  t1 timestamptz;
  t2 timestamptz;
begin
  -- 3) nyt tip: defaulten sætter tidspunktet
  insert into public.predictions (user_id, match_id, pred_home, pred_away)
    values (u, m, 1, 0);
  select updated_at into t0 from public.predictions where user_id = u and match_id = m;
  if t0 is null then raise exception 'et nyt tip fik intet updated_at'; end if;

  -- Sæt tiden kunstigt tilbage, så en flytning kan MÅLES frem for at afhænge af
  -- klokkens opløsning. (Triggeren skriver now(), som inden for samme
  -- transaktion er konstant — derfor kan to skrivninger ellers se ens ud.)
  update public.predictions set updated_at = now() - interval '1 day'
   where user_id = u and match_id = m;
  select updated_at into t0 from public.predictions where user_id = u and match_id = m;

  -- 1) rettelse: feltet flytter sig
  update public.predictions set pred_home = 2 where user_id = u and match_id = m;
  select updated_at into t1 from public.predictions where user_id = u and match_id = m;
  if t1 <= t0 then raise exception 'en rettelse flyttede ikke updated_at (% → %)', t0, t1; end if;

  -- 2) samme score igen: feltet står stille
  update public.predictions set updated_at = now() - interval '1 day'
   where user_id = u and match_id = m;
  select updated_at into t1 from public.predictions where user_id = u and match_id = m;
  update public.predictions set pred_home = 2, pred_away = 0 where user_id = u and match_id = m;
  select updated_at into t2 from public.predictions where user_id = u and match_id = m;
  if t2 is distinct from t1 then
    raise exception 'en gen-skrivning af samme score flyttede updated_at (% → %)', t1, t2;
  end if;
end $$;

-- Idempotens: anden kørsel erstatter trigger og funktion uden at fejle.
\ir ../predictions_updated_at.sql

select 'predictions_updated_at: OK' as result;

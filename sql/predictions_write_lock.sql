-- Leagly — Runde-baseret lås også for SKRIVNING (INSERT + UPDATE)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- BAGGRUND. sql/predictions_round_lock_policies.sql indførte den runde-baserede
-- lås for SELECT og DELETE, og advarede nederst i sin egen fil om to trin, der
-- skulle udføres i hånden bagefter:
--   1) drop den gamle SELECT-policy ved dens navn
--   2) læg samme runde-regel på en evt. INSERT/UPDATE-policy
-- Ingen af dem blev udført. Resultatet står i sql/schema.sql:
--
--   "insert own predictions"  INSERT  with check (user_id = auth.uid())
--   "update own predictions"  UPDATE  using      (user_id = auth.uid())
--   "read predictions"        SELECT  (den gamle per-kamp-regel, stadig i live)
--
-- Låsen fandtes altså kun i frontenden for skrivninger: `isLocked()` i
-- src/lib/scoring.js deaktiverer felterne, men PostgREST-endpointet ligger åbent.
-- Et tip kunne derfor POST'es eller PATCH'es efter runden var låst — præcis det,
-- rundelåsen findes for at forhindre, og præcis den slags regel, A8 viste er
-- værdiløs, når den kun bor i klienten.
--
-- ADFÆRDSÆNDRING I PRODUKTION. Almindelig brug rammes ikke: frontenden har
-- respekteret låsen hele tiden. Men et tip, der forsøges skrevet efter låsen,
-- afvises nu af databasen i stedet for at blive accepteret.
--
-- LÅSE-UDTRYKKET er kopieret 1:1 fra predictions_round_lock_policies.sql. Det
-- må ikke omskrives: fire policies på samme tabel skal bruge nøjagtig samme
-- betingelse, ellers kan de drive fra hinanden ved næste rettelse.
--
--   En "runde" = kampe med samme (season_id, round_key). Låst når
--     nu >= min(kickoff_at i runden) - 1 time
--   udtrykt null-sikkert som: der findes en kamp i runden med
--     kickoff_at <= nu + 1 time.
--   En runde uden kendte kickoffs (alle NULL) regnes som IKKE låst — som før.

alter table public.predictions enable row level security;

-- ---------- INSERT: opret kun tips i en runde, der ikke er låst ----------
-- Bevarer den oprindelige ejerskabsregel og lægger runde-låsen oveni.
drop policy if exists "insert own predictions" on public.predictions;
drop policy if exists "predictions_insert_own_unlocked" on public.predictions;
create policy "predictions_insert_own_unlocked"
on public.predictions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and m.home_score is null
      and not exists (
        select 1
        from public.matches m2
        where m2.round_key = m.round_key
          and m2.season_id is not distinct from m.season_id
          and m2.kickoff_at is not null
          and m2.kickoff_at <= now() + interval '1 hour'
      )
  )
);

-- ---------- UPDATE: ret kun tips i en runde, der ikke er låst ----------
-- Betingelsen skal stå i BÅDE using og with check. `using` afgør, hvilke rækker
-- der må rettes; `with check` afgør, hvordan de må se ud bagefter. Uden `with
-- check` kunne en række flyttes til en anden (låst) kamp ved at ændre match_id.
drop policy if exists "update own predictions" on public.predictions;
drop policy if exists "predictions_update_own_unlocked" on public.predictions;
create policy "predictions_update_own_unlocked"
on public.predictions
for update
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and m.home_score is null
      and not exists (
        select 1
        from public.matches m2
        where m2.round_key = m.round_key
          and m2.season_id is not distinct from m.season_id
          and m2.kickoff_at is not null
          and m2.kickoff_at <= now() + interval '1 hour'
      )
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and m.home_score is null
      and not exists (
        select 1
        from public.matches m2
        where m2.round_key = m.round_key
          and m2.season_id is not distinct from m.season_id
          and m2.kickoff_at is not null
          and m2.kickoff_at <= now() + interval '1 hour'
      )
  )
);

-- ---------- Oprydning: den gamle SELECT-policy ----------
-- Trin 1 i det gamle scripts advarsel. "read predictions" er per-kamp
-- (now() >= kickoff - 1t) og ligger stadig ved siden af den runde-baserede
-- predictions_select_visible. To permissive SELECT-policies OR'es sammen, så
-- den bredeste vinder — her er det den runde-baserede, og den gamle er dermed
-- ikke en lækage. Men to policies for samme regel er to steder at glemme ved
-- næste rettelse, og navnet lover noget, det ikke længere afgør.
drop policy if exists "read predictions" on public.predictions;

-- ============================================================================
-- Verifikation — kør efter scriptet
-- ============================================================================
-- Forventet: præcis fire policies (select/insert/update/delete), og alle andre
-- end select har `home_score is null` + kickoff-betingelsen i deres udtryk.
--
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'predictions'
-- order by cmd, policyname;
--
-- Funktionel stikprøve som almindelig bruger (ikke service_role): forsøg at
-- indsætte et tip på en kamp i en LÅST runde — skal fejle med
-- "new row violates row-level security policy for table \"predictions\"".

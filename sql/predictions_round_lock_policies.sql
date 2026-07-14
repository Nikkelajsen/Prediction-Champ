-- Prediction Champ — Runde-baseret lås for predictions (DELETE + SELECT)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- Afløser sql/predictions_delete_policy.sql. Tidligere låste hver kamp individuelt
-- 1 time før sit eget kickoff. Nu låser ALLE kampe i en runde samtidig — 1 time før
-- rundens TIDLIGSTE kickoff — så ingen kan nå at se tidlige resultater (eller andres
-- afslørede gæt) og justere senere gæt i samme runde.
--
-- En "runde" = kampe med samme (season_id, round_key). Låst når:
--   nu >= min(kickoff_at i runden) - 1 time
-- hvilket er algebraisk ækvivalent med (og null-sikkert):
--   der findes en kamp i runden med kickoff_at <= nu + 1 time.
-- En runde uden kendte kickoffs (alle NULL) regnes som IKKE låst — som før.

alter table public.predictions enable row level security;

-- ---------- DELETE: slet egne tips kun så længe runden ikke er låst ----------
drop policy if exists "predictions_delete_own_unlocked" on public.predictions;
create policy "predictions_delete_own_unlocked"
on public.predictions
for delete
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
);

-- ---------- SELECT: egne tips altid; andres kun når runden er låst ----------
-- Andres tips bliver synlige når kampen er spillet (resultat sat) ELLER runden er låst.
drop policy if exists "predictions_select_visible" on public.predictions;
create policy "predictions_select_visible"
on public.predictions
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and (
        m.home_score is not null
        or exists (
          select 1
          from public.matches m2
          where m2.round_key = m.round_key
            and m2.season_id is not distinct from m.season_id
            and m2.kickoff_at is not null
            and m2.kickoff_at <= now() + interval '1 hour'
        )
      )
  )
);

-- ---------- VIGTIGT før du kører dette script ----------
-- 1) Den nuværende SELECT-policy på predictions ligger KUN i Supabase (ikke i repoet)
--    og kan hedde noget andet end "predictions_select_visible". To permissive SELECT-
--    policies OR'es sammen og kan over-afsløre. Tjek og drop den gamle ved dens navn:
--
--      select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'predictions';
--      -- drop policy "<gammelt_navn>" on public.predictions;
--
-- 2) Hvis der findes en INSERT/UPDATE-policy med WITH CHECK på den gamle kickoff-1t-regel,
--    skal den opdateres til samme runde-regel, ellers kan et tip stadig POST'es/PATCH'es
--    efter runden er låst. Genbrug betingelsen (indsæt i USING/WITH CHECK):
--
--      exists (
--        select 1 from public.matches m
--        where m.id = predictions.match_id
--          and m.home_score is null
--          and not exists (
--            select 1 from public.matches m2
--            where m2.round_key = m.round_key
--              and m2.season_id is not distinct from m.season_id
--              and m2.kickoff_at is not null
--              and m2.kickoff_at <= now() + interval '1 hour'
--          )
--      )

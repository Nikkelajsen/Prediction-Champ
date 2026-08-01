-- Prediction Champ — Per-kamp-lås for predictions (A21, 1. august 2026)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- Afløser sql/predictions_round_lock_policies.sql (#4) og
-- sql/predictions_write_lock.sql (#14). De to filer må ALDRIG gen-køres efter
-- denne — de ville tavst rulle låsen tilbage til runde-scope.
--
-- ÆNDRINGEN. Låsen var scopet på (season_id, round_key): alle kampe i en runde
-- låste samtidig, 1 time før rundens TIDLIGSTE kickoff. Fredagens kamp låste
-- dermed søndagens kamp i samme runde. Nu låser hver kamp for sig, 1 time før
-- sit EGET kickoff.
--
--   En kamp er låst når:  nu >= kickoff_at - 1 time   (eller den har resultat)
--   udtrykt som:          kickoff_at <= nu + 1 time
--
-- HVAD DER GIVES OP. Rundelåsen fandtes for at lukke muligheden for at justere
-- sene tips efter tidlige resultater (DECISIONS.md, juli 2026). Den skævhed
-- genåbnes bevidst: den, der tipper søndag, kender fredagens resultater og sin
-- egen stilling. Til gengæld er der INTET kopierings-hul — andres gæt for en
-- kamp bliver først synlige, når kampen låser, og der kan ingen længere rette
-- sit eget gæt. Løftet "alle tipper på samme vidensgrundlag" omformuleres fra
-- pr. runde til pr. kamp; det er stadig en ægte regel, bare en snævrere.
--
-- NULL-SEMANTIKKEN VENDER, og derfor står den eksplicit i hvert udtryk.
-- Rundereglen var null-sikker af sig selv: en runde uden kendte kickoffs havde
-- ingen kamp med `kickoff_at <= nu + 1t`, og blev derfor regnet som IKKE låst.
-- Per kamp er der ingen indre delmængde at falde tilbage på, så `kickoff_at is
-- null` skal behandles direkte, og valget er det samme som før:
--   * skrivning: en kamp uden kendt kickoff er ÅBEN (man kan tippe den)
--   * læsning:   andres gæt på den er IKKE synlige (den er ikke låst endnu)
-- `matches.kickoff_at` er `not null` i dag, så det er defensivt — men det var
-- præcis denne detalje, den gamle "read predictions"-policy tabte.
--
-- LÅSE-UDTRYKKET står 1:1 i alle fire policies. Det må ikke omskrives ét sted:
-- fire policies på samme tabel skal bruge nøjagtig samme betingelse, ellers kan
-- de drive fra hinanden ved næste rettelse. (Reglen er uændret fra #14.)
--
-- ADFÆRDSÆNDRING I PRODUKTION. En runde, der er låst i dag, får sine senere
-- kampe åbnet igen i samme øjeblik scriptet køres. Kør det derfor MELLEM to
-- runder, ikke midt i en — ellers ændrer reglen sig for tips, der allerede er
-- afgivet, og en spiller kan rette et gæt, en anden allerede har set.

alter table public.predictions enable row level security;

-- ---------- INSERT: opret kun tips på en kamp, der ikke er låst ----------
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
      and (m.kickoff_at is null or m.kickoff_at > now() + interval '1 hour')
  )
);

-- ---------- UPDATE: ret kun tips på en kamp, der ikke er låst ----------
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
      and (m.kickoff_at is null or m.kickoff_at > now() + interval '1 hour')
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and m.home_score is null
      and (m.kickoff_at is null or m.kickoff_at > now() + interval '1 hour')
  )
);

-- ---------- DELETE: slet egne tips kun så længe kampen ikke er låst ----------
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
      and (m.kickoff_at is null or m.kickoff_at > now() + interval '1 hour')
  )
);

-- ---------- SELECT: egne tips altid; andres kun når kampen er låst ----------
-- Andres tips bliver synlige når kampen er spillet (resultat sat) ELLER låst.
-- Bemærk den omvendte null-behandling her: uden kendt kickoff er kampen ikke
-- låst, og gættet er derfor ikke synligt for andre.
drop policy if exists "read predictions" on public.predictions;
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
        or (m.kickoff_at is not null and m.kickoff_at <= now() + interval '1 hour')
      )
  )
);

-- ============================================================================
-- competition_participants: framelding må fortsat ikke slette historik
-- ============================================================================
-- Samme lås, andet sted. Gren (b) i comp_participants_delete_own_unlocked
-- (sql/group_membership_invariant.sql, #13) bar rundeudtrykket 1:1 og skal
-- følge med, ellers kan en spiller melde sig fra en konkurrence, hvor de har
-- tips på kampe, der nu er låste — og dermed slette sig ud af historikken.
-- Gren (a) er uændret: er alle kampe spillet, er der intet at beskytte.
drop policy if exists comp_participants_delete_own_unlocked on public.competition_participants;
create policy comp_participants_delete_own_unlocked on public.competition_participants
  for delete to authenticated
  using (
    user_id = auth.uid()
    and (
      -- (a) Forløbet er forbi: ingen kampe i konkurrencen mangler resultat.
      not exists (
        select 1
        from public.competition_matches cm
        join public.matches m on m.id = cm.match_id
        where cm.competition_id = competition_participants.competition_id
          and (m.home_score is null or m.away_score is null)
      )
      -- (b) Ellers: ingen tips på låste kampe. Låse-udtrykket er kopieret 1:1
      --     fra SELECT-policyen ovenfor.
      or not exists (
        select 1
        from public.competition_matches cm
        join public.matches m on m.id = cm.match_id
        join public.predictions p on p.match_id = m.id and p.user_id = auth.uid()
        where cm.competition_id = competition_participants.competition_id
          and (
            m.home_score is not null
            or (m.kickoff_at is not null and m.kickoff_at <= now() + interval '1 hour')
          )
      )
    )
  );

-- ============================================================================
-- Verifikation — kør efter scriptet
-- ============================================================================
-- 1) Præcis fire policies på predictions, og alle andre end select har
--    `home_score is null` + kickoff-betingelsen i deres udtryk:
--
--    select policyname, cmd, qual, with_check
--    from pg_policies
--    where schemaname = 'public' and tablename = 'predictions'
--    order by cmd, policyname;
--
--    Intet udtryk må længere nævne `round_key` — gør det, er en gammel policy
--    fra #4 eller #14 sluppet igennem:
--
--    select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename in ('predictions','competition_participants')
--      and coalesce(qual,'') || coalesce(with_check,'') like '%round_key%';
--
-- 2) Funktionel stikprøve som almindelig bruger (ikke service_role), i en runde
--    der er DELVIST låst — det er hele pointen med ændringen, så begge veje skal
--    prøves:
--      a. indsæt et tip på en kamp, hvis eget kickoff er mere end 1 time ude,
--         i en runde hvor en tidligere kamp allerede er låst → skal LYKKES
--         (under rundelåsen ville dette fejle)
--      b. indsæt et tip på en kamp, hvis kickoff er inden for 1 time
--         → skal fejle med "new row violates row-level security policy"

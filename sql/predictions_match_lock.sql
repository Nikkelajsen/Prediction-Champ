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
-- Om du ER mellem to runder, afgøres af PRE-FLIGHT-blokken herunder. Gæt ikke.

-- ============================================================================
-- PRE-FLIGHT — kør FØR scriptet (kommenteret, så filen kan køres i sin helhed)
-- ============================================================================
-- Migreringen kan kun låse OP, aldrig låse. En kamp, der er låst per kamp, er
-- altid også låst per runde (kampens kickoff ligger efter rundens første), så
-- intet bliver nylåst. Præcis ét sæt påvirkes:
--
--   uspillede kampe, hvis EGET kickoff er mere end en time ude,
--   i en runde hvor en tidligere kamp allerede er begyndt.
--
-- Hvorfor det sæt er farligt: under rundelåsen blev HELE rundens gæt synlige,
-- da runden låste. Migreringen giver skriveadgang tilbage til gæt, de andre
-- deltagere allerede HAR set — den ene kombination, per-kamp-låsen ellers
-- aldrig tillader. Dertil bliver samme runde afgjort under to regelsæt: den,
-- der ikke nåede at tippe søndagskampen, fordi runden låste fredag, får nu lov,
-- mens andre var bundet af den gamle regel.
--
-- Ingen point, stillinger eller ratings flytter sig. Færdigspillede kampe er
-- låst under begge regler (`home_score is not null`), og et gæt ændret før
-- kickoff er den tilsigtede adfærd. Det er kun de allerede AFSLØREDE gæt.

-- Tjek 1 — er du mellem to runder? NUL RÆKKER = kør frit.
-- Betingelsen er den gamle rundelås (fra predictions_round_lock_policies.sql)
-- krydset med den nye per-kamp-regel, så tjekket ikke kan drive fra det, det måler.
--
-- select l.name as turnering, m.round_key,
--        count(*) filter (where m.home_score is null
--                           and m.kickoff_at > now() + interval '1 hour') as kampe_der_aabnes,
--        count(*) as kampe_i_runden,
--        min(m.kickoff_at) as runde_start,
--        max(m.kickoff_at) as sidste_kickoff
-- from public.matches m
-- join public.seasons s on s.id = m.season_id
-- join public.leagues  l on l.id = s.league_id
-- where exists (select 1 from public.matches m2
--               where m2.round_key = m.round_key
--                 and m2.season_id is not distinct from m.season_id
--                 and m2.kickoff_at is not null
--                 and m2.kickoff_at <= now() + interval '1 hour')
-- group by 1, 2
-- having count(*) filter (where m.home_score is null
--                          and m.kickoff_at > now() + interval '1 hour') > 0;

-- Tjek 2 — hvor stor er eksponeringen? Det er dette tal, beslutningen står på:
-- en håndfuld gæt i en testgruppe er noget andet end en fuld runde.
--
-- select count(*) as tips_der_kan_rettes,
--        count(distinct p.user_id) as brugere,
--        count(distinct m.id)      as kampe
-- from public.predictions p
-- join public.matches m on m.id = p.match_id
-- where m.home_score is null
--   and m.kickoff_at > now() + interval '1 hour'
--   and exists (select 1 from public.matches m2
--               where m2.round_key = m.round_key
--                 and m2.season_id is not distinct from m.season_id
--                 and m2.kickoff_at is not null
--                 and m2.kickoff_at <= now() + interval '1 hour');

-- Valgfrit snapshot — kun hvis tjek 2 gav noget, og du ikke vil vente.
-- NØDVENDIGT, fordi `predictions.updated_at` IKKE kan bruges: der er ingen
-- trigger på tabellen, og klienten sender ikke feltet (den upserter kun
-- pred_home/pred_away), så det registrerer OPRETTELSE og ikke sidste ændring.
-- Uden snapshottet findes der intet revisionsspor for et rettet gæt.
--
-- create table public._a21_snapshot as
-- select p.user_id, p.match_id, p.pred_home, p.pred_away, now() as taget_kl
-- from public.predictions p
-- join public.matches m on m.id = p.match_id
-- where m.home_score is null
--   and m.kickoff_at > now() + interval '1 hour'
--   and exists (select 1 from public.matches m2
--               where m2.round_key = m.round_key
--                 and m2.season_id is not distinct from m.season_id
--                 and m2.kickoff_at is not null
--                 and m2.kickoff_at <= now() + interval '1 hour');
--
-- … og bagefter, når runden er spillet — hvem rettede noget?
--
-- select s.user_id, s.match_id, s.pred_home as foer_h, s.pred_away as foer_a,
--        p.pred_home as efter_h, p.pred_away as efter_a
-- from public._a21_snapshot s
-- join public.predictions p on p.user_id = s.user_id and p.match_id = s.match_id
-- where p.pred_home is distinct from s.pred_home
--    or p.pred_away is distinct from s.pred_away;
--
-- DROP TABELLEN BAGEFTER — ellers står den som et efterladt objekt, præcis den
-- slags sql/cleanup_orphans.sql måtte rydde op i:
-- drop table if exists public._a21_snapshot;

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

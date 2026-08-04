-- Rating-trigger-optimering: genberegn kun når resultater FAKTISK ændres,
-- og generér derefter historier for de berørte, nu fuldt afsluttede runder.
-- Idempotent — kan køres igen når som helst. Kræver at recompute_ratings()
-- allerede findes (fra det oprindelige rating-script) og generate_stories()
-- (fra sql/story_engine.sql).
--
-- v2 (august 2026) kræver desuden — kør dem FØR denne fil:
--   sql/story_engine_v2_day.sql  → match_day_complete()
--   sql/story_engine_v2.sql      → generate_daily_stories()
--   sql/milestones.sql           → award_milestones()
-- Alle tre kaldes inde i exception-guarden, så en manglende funktion viser sig
-- som en warning i Postgres-loggen og ikke som en fejlet resultat-lagring.
--
-- Problemet: den gamle statement-trigger (matches_recompute_ratings) kaldte
-- recompute_ratings() ved HVER sætning på matches — også cron-syncens upsert
-- hvert 10.-15. minut, selv når ingen resultater var ændret. Det er en fuld
-- Elo-genberegning fra bunden mange gange i timen, helt uden grund.
--
-- Løsningen: transition tables (old/new rækker pr. sætning) sammenligner
-- scores før/efter og kalder kun recompute_ratings(), når mindst én kamps
-- resultat reelt er ændret, tilføjet eller fjernet.
--
-- Story Engine: efter ratings (rækkefølge: point → stillinger → ratings →
-- historier) kaldes generate_stories() for hver berørt runde, der nu er fuldt
-- afsluttet. Kaldet er pakket i en exception-guard, så en historik-fejl ALDRIG
-- kan rulle resultat-lagring eller rating-genberegning tilbage (best-effort,
-- jf. spec'ens "stilhed er tilladt"-princip).

-- SECURITY DEFINER siden august 2026 (G15). Ikke for at give triggeren mere at
-- gøre, men for at give den lov til det, den altid har gjort: recompute_ratings()
-- er nu service_role-only, og triggeren kører som SKRIVEREN. Uden definer ville
-- enhver admin-rettelse af et resultat i Admin-skærmen fejle på "permission
-- denied for function recompute_ratings".
--
-- Sikker som definer, fordi en trigger-funktion ikke kan kaldes direkte
-- ("trigger functions can only be called as triggers"), og de eneste triggere,
-- der peger på den, sidder på public.matches — en tabel, kun admins og
-- service_role må skrive i efter G14.
create or replace function public.recompute_ratings_if_scores_changed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  -- date, ikke text: matches.round_key og matches.match_day er genererede
  -- date-kolonner, og Postgres har ingen `date = text`-operator. Med text her
  -- fejlede opslaget nedenfor (m.round_key = v_round) inde i exception-guarden
  -- — altså tavst, hvorved generate_stories aldrig blev kaldt.
  -- generate_stories tager text og får derfor et eksplicit ::text;
  -- generate_daily_stories tager date og får ingen cast.
  v_round date;
  v_day   date;
begin
  -- ============ 1. Rating-porten: KUN ægte resultatændringer ============
  drop table if exists _se_changed_rounds;
  create temporary table _se_changed_rounds (round_key date);

  if tg_op = 'INSERT' then
    insert into _se_changed_rounds
      select distinct round_key from new_rows
      where (home_score is not null or away_score is not null) and round_key is not null;
  elsif tg_op = 'UPDATE' then
    insert into _se_changed_rounds
      select distinct n.round_key from new_rows n
      join old_rows o on o.id = n.id
      where (n.home_score is distinct from o.home_score or n.away_score is distinct from o.away_score)
        and n.round_key is not null;
  elsif tg_op = 'DELETE' then
    insert into _se_changed_rounds
      select distinct round_key from old_rows
      where (home_score is not null or away_score is not null) and round_key is not null;
  end if;

  -- ============ 2. Historie-porten: resultater ELLER flytninger ============
  -- Bredere end rating-porten, og det er med vilje. En udsat kamp, der flytter
  -- UD af en dag eller en runde, kan GØRE den dag/runde færdig, uden at ét
  -- eneste resultat er ændret — v1 så aldrig det øjeblik. Rating er derimod
  -- uberørt af flytningen (kampen havde ingen score), så den må ikke trække en
  -- fuld Elo-genberegning med sig. Derfor to porte.
  drop table if exists _se_story_days;
  drop table if exists _se_story_rounds;
  create temporary table _se_story_days (day_key date);
  create temporary table _se_story_rounds (round_key date);

  if tg_op = 'INSERT' then
    insert into _se_story_days   select distinct match_day from new_rows where match_day is not null;
    insert into _se_story_rounds select distinct round_key from new_rows where round_key is not null;
  elsif tg_op = 'UPDATE' then
    -- Både den NYE og den GAMLE dag/runde skal med ved en flytning: den gamle
    -- kan nu være komplet, fordi kampen forlod den.
    insert into _se_story_days
      select distinct d from (
        select n.match_day as d from new_rows n join old_rows o on o.id = n.id
         where n.home_score is distinct from o.home_score
            or n.away_score is distinct from o.away_score
            or n.match_day  is distinct from o.match_day
        union all
        select o.match_day from new_rows n join old_rows o on o.id = n.id
         where n.match_day is distinct from o.match_day
      ) x where d is not null;
    insert into _se_story_rounds
      select distinct r from (
        select n.round_key as r from new_rows n join old_rows o on o.id = n.id
         where n.home_score is distinct from o.home_score
            or n.away_score is distinct from o.away_score
            or n.round_key  is distinct from o.round_key
        union all
        select o.round_key from new_rows n join old_rows o on o.id = n.id
         where n.round_key is distinct from o.round_key
      ) x where r is not null;
  elsif tg_op = 'DELETE' then
    insert into _se_story_days   select distinct match_day from old_rows where match_day is not null;
    insert into _se_story_rounds select distinct round_key from old_rows where round_key is not null;
  end if;

  -- ============ 3. Rating ============
  if exists (select 1 from _se_changed_rounds) then
    perform public.recompute_ratings();
  end if;

  -- ============ 4. Historier og milepæle — best-effort ============
  -- Må ALDRIG kunne blokere resultat-lagring eller rating (derfor guarden).
  if exists (select 1 from _se_story_days) or exists (select 1 from _se_story_rounds) then
    begin
      -- DAGE FØRST og i kronologisk orden: en dags kort må ikke lande efter
      -- rundens afsluttende kort, og karusellen læses i samme retning.
      for v_day in (select distinct day_key from _se_story_days order by 1) loop
        if public.match_day_complete(v_day) then
          perform public.generate_daily_stories(v_day);
        end if;
      end loop;

      -- DEREFTER rundens afsluttende kort. Betingelsen er uændret fra v1 og ER
      -- allerede "rundens sidste dag": en runde kan først stå uden manglende
      -- resultater på den sidste dag, der havde kampe. Spilles alt søndag,
      -- lander konklusionen søndag, selvom runden formelt løber til mandag.
      for v_round in (select distinct round_key from _se_story_rounds order by 1) loop
        if exists (select 1 from public.matches m where m.round_key = v_round)
           and not exists (
             select 1 from public.matches m
             where m.round_key = v_round and (m.home_score is null or m.away_score is null)
           )
        then
          perform public.generate_stories(v_round::text);
          -- MILEPÆLE KALDES IKKE HERFRA (v2.1, august 2026).
          --
          -- De gjorde det i første udgave, med den begrundelse at alt kampdrevet
          -- bliver sandt netop her, hvor ratings lige er genberegnet — og at
          -- brugeren kigger på sit kort i samme øjeblik. Et skaleringsforsøg på
          -- en syntetisk fuld sæson (sql/tests/story_engine_scale.sql) målte
          -- prisen: `award_milestones()` kostede ~505 ms og bragte hele
          -- trigger-sætningen op på ~1,07 s — inde i den sætning,
          -- api/sync-live.js bruger til at afslutte en kamp. Uden den er
          -- sætningen ~565 ms.
          --
          -- Prisen for at flytte den er, at en milepæl vises op til én
          -- cron-kørsel senere (15–30 min) i stedet for med det samme. Den pris
          -- er lille: kortet ligger i karusellen resten af runden. Prisen for at
          -- blive var et halvt sekund oven på hver eneste rundeafslutning, for
          -- et kald der næsten altid ikke uddeler noget.
          --
          -- api/send-notifications.js er nu ENESTE kalder — den var i forvejen
          -- den pålidelige skriver for de tre ikke-kampdrevne familier.
        end if;
      end loop;
    exception when others then
      -- warning, ikke notice: guarden skal blive ved med at beskytte resultat-
      -- lagringen, men en fejl må ikke være usynlig igen (jf. A9, juli 2026).
      -- warning når Postgres-loggen som standard; notice gjorde ikke.
      raise warning 'story-generering fejlede (ignoreret, resultater/rating er uberørte): %', sqlerrm;
    end;
  end if;

  drop table if exists _se_changed_rounds;
  drop table if exists _se_story_days;
  drop table if exists _se_story_rounds;
  return null;
end;
$fn$;

-- erstat den gamle "genberegn altid"-trigger med tre operation-specifikke
-- (transition tables kræver én trigger pr. operation)
drop trigger if exists matches_recompute_ratings on public.matches;
drop trigger if exists matches_recompute_ratings_ins on public.matches;
drop trigger if exists matches_recompute_ratings_upd on public.matches;
drop trigger if exists matches_recompute_ratings_del on public.matches;

create trigger matches_recompute_ratings_ins
  after insert on public.matches
  referencing new table as new_rows
  for each statement
  execute function public.recompute_ratings_if_scores_changed();

create trigger matches_recompute_ratings_upd
  after update on public.matches
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.recompute_ratings_if_scores_changed();

create trigger matches_recompute_ratings_del
  after delete on public.matches
  referencing old table as old_rows
  for each statement
  execute function public.recompute_ratings_if_scores_changed();

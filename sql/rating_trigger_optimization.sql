-- Rating-trigger-optimering: genberegn kun når resultater FAKTISK ændres,
-- og generér derefter historier for de berørte, nu fuldt afsluttede runder.
-- Idempotent — kan køres igen når som helst. Kræver at recompute_ratings()
-- allerede findes (fra det oprindelige rating-script) og generate_stories()
-- (fra sql/story_engine.sql).
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

create or replace function public.recompute_ratings_if_scores_changed()
returns trigger
language plpgsql
as $fn$
declare
  v_round text;
begin
  -- saml berørte round_keys, afhængigt af operationen (kun når et resultat reelt ændres)
  drop table if exists _se_changed_rounds;
  create temporary table _se_changed_rounds (round_key text);

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

  if exists (select 1 from _se_changed_rounds) then
    perform public.recompute_ratings();

    -- historier for berørte, nu fuldt afsluttede runder — best-effort, må aldrig
    -- kunne blokere resultat-lagring/rating (derfor exception-guarden).
    begin
      for v_round in (select distinct round_key from _se_changed_rounds) loop
        if exists (select 1 from public.matches m where m.round_key = v_round)
           and not exists (
             select 1 from public.matches m
             where m.round_key = v_round and (m.home_score is null or m.away_score is null)
           )
        then
          perform public.generate_stories(v_round);
        end if;
      end loop;
    exception when others then
      raise notice 'generate_stories fejlede (ignoreret, resultater/rating er uberørte): %', sqlerrm;
    end;
  end if;

  drop table if exists _se_changed_rounds;
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

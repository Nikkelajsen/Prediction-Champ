-- Rating-trigger-optimering: genberegn kun når resultater FAKTISK ændres.
-- Idempotent — kan køres igen når som helst. Kræver at recompute_ratings()
-- allerede findes (fra det oprindelige rating-script).
--
-- Problemet: den gamle statement-trigger (matches_recompute_ratings) kaldte
-- recompute_ratings() ved HVER sætning på matches — også cron-syncens upsert
-- hvert 10.-15. minut, selv når ingen resultater var ændret. Det er en fuld
-- Elo-genberegning fra bunden mange gange i timen, helt uden grund.
--
-- Løsningen: transition tables (old/new rækker pr. sætning) sammenligner
-- scores før/efter og kalder kun recompute_ratings(), når mindst én kamps
-- resultat reelt er ændret, tilføjet eller fjernet. Selve genberegningen er
-- stadig den fulde (korrekt pr. definition) — den kører nu bare kun, når et
-- resultat tastes ind, i stedet for ~100 gange i døgnet.

create or replace function public.recompute_ratings_if_scores_changed()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from new_rows where home_score is not null or away_score is not null) then
      perform public.recompute_ratings();
    end if;
  elsif tg_op = 'UPDATE' then
    if exists (
      select 1
      from new_rows n
      join old_rows o on o.id = n.id
      where n.home_score is distinct from o.home_score
         or n.away_score is distinct from o.away_score
    ) then
      perform public.recompute_ratings();
    end if;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from old_rows where home_score is not null or away_score is not null) then
      perform public.recompute_ratings();
    end if;
  end if;
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

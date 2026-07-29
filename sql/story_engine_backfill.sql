-- Story Engine v1.1 — genberegn historier for alle FULDT afsluttede runder.
-- Kør i Supabase SQL-editoren med "Run without RLS".
--
-- HVORFOR: generate_stories() kaldes kun, når et resultat ændres (matches-triggeren).
-- Runder, der allerede var afsluttet, da v1.1 blev rullet ud, har derfor stadig
-- historier fra det gamle regelkatalog — typisk ingen historier overhovedet i
-- premiereugen. Dette script kalder funktionen én gang pr. afsluttet runde.
--
-- KOMPLETHEDSFILTERET ER IKKE VALGFRIT. En runde tælles kun med, hvis ingen af
-- dens kampe mangler resultat — nøjagtig samme betingelse som triggeren bruger
-- (sql/rating_trigger_optimization.sql). Et filter som "home_score is not null"
-- ville også ramme delvist spillede runder og skabe historier ud fra en halv
-- stilling ("du vandt runden", før runden var færdig).
--
-- Idempotent: generate_stories() sletter og genberegner rundens rækker, så
-- scriptet kan køres igen uden bivirkninger. Bemærk, at en genberegning nulstiller
-- `dismissed_at` for de berørte runder — et kort, brugeren havde afvist, kan
-- dukke op igen. Det er prisen for at få de nye regler med tilbagevirkende kraft.
do $$
declare
  v_round date;
  v_n int := 0;
begin
  for v_round in
    select distinct m.round_key
    from public.matches m
    where m.round_key is not null
      and not exists (
        select 1 from public.matches m2
        where m2.round_key = m.round_key
          and (m2.home_score is null or m2.away_score is null)
      )
    order by 1
  loop
    perform public.generate_stories(v_round::text);
    v_n := v_n + 1;
  end loop;
  raise notice 'Story Engine: genberegnet % afsluttede runde(r).', v_n;
end $$;

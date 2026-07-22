-- Stillings-views: runde- og sæsonstilling beregnet i databasen
-- (samme princip som monthly_standings), så frontenden ikke skal hente
-- alle sæsonens forudsigelser ned i browseren.
-- Idempotent — kan køres igen når som helst.
--
-- security_invoker: viewet arver predictions/matches' RLS. Kun kampe MED
-- resultat indgår, og de er altid låste, så alles gæt må læses (ingen snyde-risiko).
-- Pointreglerne er de faste championship-regler: +3 præcist, +1 korrekt udfald.

create or replace view public.round_standings
with (security_invoker = on) as
select
  m.round_key,
  pr.user_id,
  count(*)::int as matches,
  sum(case
        when pr.pred_home = m.home_score and pr.pred_away = m.away_score then 3
        when sign(pr.pred_home - pr.pred_away) = sign(m.home_score - m.away_score) then 1
        else 0
      end)::int as total_points,
  (count(*) filter (where pr.pred_home = m.home_score and pr.pred_away = m.away_score))::int as exact_count
from public.predictions pr
join public.matches m on m.id = pr.match_id
where m.home_score is not null and m.away_score is not null
  and pr.pred_home is not null and pr.pred_away is not null
group by m.round_key, pr.user_id;

create or replace view public.season_standings
with (security_invoker = on) as
select
  m.season_id,
  pr.user_id,
  count(*)::int as matches,
  sum(case
        when pr.pred_home = m.home_score and pr.pred_away = m.away_score then 3
        when sign(pr.pred_home - pr.pred_away) = sign(m.home_score - m.away_score) then 1
        else 0
      end)::int as total_points,
  (count(*) filter (where pr.pred_home = m.home_score and pr.pred_away = m.away_score))::int as exact_count
from public.predictions pr
join public.matches m on m.id = pr.match_id
where m.home_score is not null and m.away_score is not null
  and pr.pred_home is not null and pr.pred_away is not null
group by m.season_id, pr.user_id;

grant select on public.round_standings to authenticated, service_role;
grant select on public.season_standings to authenticated, service_role;

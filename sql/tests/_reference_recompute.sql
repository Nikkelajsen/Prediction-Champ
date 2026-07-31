-- FRYSSET REFERENCE — rør den ikke.
--
-- Dette er recompute_ratings() præcis som den så ud FØR optimeringen den 30.
-- juli 2026, klippet ordret ud af sql/schema.sql (eksporten fra samme dag).
-- Den er facit i sql/tests/rating_equivalence.sql: den optimerede udgave skal
-- give samme rangorden og samme tal inden for en meget snæver tolerance.
--
-- Skal rating-algoritmen ændres MENINGSFULDT en dag, er det denne fil, der skal
-- opdateres bevidst — og den opdatering er så selve beslutningen om, at tallene
-- må flytte sig. Så længe den står urørt, kan ingen optimering ændre resultatet
-- uden at testen fanger det.
--
-- OPDATERET ÉN GANG — 31. juli 2026 (A17). `_rs` joiner nu seasons/leagues og
-- tæller kun **officielle** turneringer. Det er den slags "meningsfulde ændring",
-- afsnittet ovenfor beskriver: tallene flytter sig med vilje, fordi en turnering,
-- der ikke kan vindes, heller ikke skal kunne flytte ratingen. Begrundelsen står
-- i docs/DECISIONS.md.
--
-- Bemærk hvad opdateringen KOSTER: fra nu af kan testen ikke længere selv bevise,
-- at filteret virker — begge sider har det jo. Beviset er derfor flyttet til en
-- selvstændig sektion i rating_equivalence.sql, som tilføjer en uofficiel
-- turnering EFTER sammenligningen og kræver, at intet rykker sig. Rører du
-- referencen igen, så husk den samme dobbelthed.

CREATE OR REPLACE FUNCTION public.recompute_ratings_reference() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r record;
begin
  delete from rating_history where scope = 'ALL';
  delete from ratings where scope = 'ALL';

  drop table if exists _rs;
  create temp table _rs as
  select m.round_key,
         p.user_id,
         sum(pc_points(p.pred_home, p.pred_away, m.home_score, m.away_score)) as pts,
         count(*) as n,
         sum(case when p.pred_home = m.home_score and p.pred_away = m.away_score then 1 else 0 end) as exacts
  from predictions p
  join matches m on m.id = p.match_id
  join seasons s on s.id = m.season_id
  join leagues l on l.id = s.league_id and l.is_official
  where m.home_score is not null and m.away_score is not null
    and p.pred_home is not null and p.pred_away is not null
  group by m.round_key, p.user_id;

  drop table if exists _cur;
  create temp table _cur (user_id uuid primary key, rating numeric, rounds_played int);
  drop table if exists _step;
  create temp table _step (user_id uuid, d numeric, rating_after numeric, score numeric, n int, rnk int);

  for r in select distinct round_key from _rs order by round_key loop
    insert into _cur(user_id, rating, rounds_played)
    select rs.user_id, 1000, 0 from _rs rs
    where rs.round_key = r.round_key
      and not exists (select 1 from _cur c where c.user_id = rs.user_id);

    truncate _step;
    insert into _step(user_id, d, rating_after, score, n, rnk)
    with pt as (
      select rs.user_id, rs.pts::numeric / rs.n as score, rs.exacts, rs.n,
             c.rating, c.rounds_played
      from _rs rs join _cur c on c.user_id = rs.user_id
      where rs.round_key = r.round_key
    ),
    agg as (
      select u.user_id, u.rating, u.rounds_played, u.score, u.n,
             count(*) as others,
             sum(case when u.score > v.score
                        or (u.score = v.score and u.exacts > v.exacts) then 1
                      when u.score = v.score and u.exacts = v.exacts then 0.5
                      else 0 end) as s_sum,
             sum(1.0 / (1 + power(10, (v.rating - u.rating) / 400.0))) as e_sum
      from pt u join pt v on v.user_id <> u.user_id
      group by u.user_id, u.rating, u.rounds_played, u.score, u.n
    ),
    solo as (
      select user_id, rating, rounds_played, score, n,
             0::numeric as others, 0::numeric as s_sum, 0::numeric as e_sum
      from pt where (select count(*) from pt) = 1
    ),
    allrows as (select * from agg union all select * from solo),
    d as (
      select user_id, rating, score, n,
             case when others = 0 then 0
                  else (case when rounds_played < 5 then 32 else 24 end)::numeric
                       / others * (s_sum - e_sum) end as d
      from allrows
    )
    select user_id, d, rating + d as rating_after, score, n,
           rank() over (order by score desc) as rnk
    from d;

    update _cur c
      set rating = s.rating_after, rounds_played = c.rounds_played + 1
    from _step s where s.user_id = c.user_id;

    insert into rating_history(user_id, scope, round_key, rating_after, delta, round_score, matches_predicted, rnk)
    select user_id, 'ALL', r.round_key, rating_after, d, score, n, rnk from _step;
  end loop;

  insert into ratings(user_id, scope, rating, rounds_played, provisional, updated_at)
  select user_id, 'ALL', rating, rounds_played, rounds_played < 5, now() from _cur;

  drop table if exists _rs; drop table if exists _cur; drop table if exists _step;
end;
$$;

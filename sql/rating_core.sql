-- Rating-kernen: pc_points(), round_key(), recompute_ratings() og de to tabeller,
-- de skriver i.
--
-- HVORFOR DENNE FIL FINDES
-- Indtil 30. juli 2026 fandtes Elo-implementeringen KUN inde i det genererede
-- øjebliksbillede sql/schema.sql. Der var altså ingen versioneret kilde at rette
-- i: sql/rating_trigger_optimization.sql henviser i sin egen indledning til "det
-- oprindelige rating-script", og det script har aldrig ligget i repoet. Gik
-- eksporten i stykker, eller blev filen rullet tilbage, var algoritmen væk.
--
-- Funktionskroppene er klippet ORDRET ud af sql/schema.sql (eksport af 30. juli
-- 2026), så filen beviseligt beskriver det, der faktisk kører i produktion. Den
-- er ikke en omskrivning, og den ændrer intet ved at blive kørt.
--
-- BEMÆRK — BLANDEDE LINJEAFSLUTNINGER ER MED VILJE.
-- Kroppene indeholder CRLF, fordi de blev indsat i Supabases SQL-editor fra en
-- kilde med Windows-linjeskift og dermed ligger sådan i Postgres' prosrc.
-- Normaliserer man dem til LF, ændrer en kørsel prosrc, og næste skema-eksport
-- giver en stor, indholdsløs diff. Lad dem stå.
--
-- Idempotent — kan køres igen når som helst.
--
-- Kørerækkefølge: FØR sql/rating_trigger_optimization.sql, som antager at
-- recompute_ratings() allerede findes. Se filindekset i sql/README.md.
--
-- VERIFICERET 30. juli 2026 mod en frisk PostgreSQL 16.13 (samme version som
-- den tidligere verifikation i DOCUMENTATION.md afsnit 19): filen kører rent,
-- en gen-kørsel er en no-op, og recompute_ratings() blev udført på en fixture
-- med 3 spillere over 2 runder. pc_points gav 3/1/0/null, round_key bøttede
-- tirsdag-til-mandag korrekt, og rundens deltaer summerede til nul — Elo'en er
-- nulsum som beskrevet i DOCUMENTATION.md afsnit 5. Det var første gang koden
-- blev afprøvet ved at blive KØRT frem for læst.
--
-- BEMÆRK ved fremtidig inkrementel beregning (DOCUMENTATION.md afsnit 12):
-- recompute_ratings() sletter hele historikken og bygger den op fra runde nul.
-- Elo er stiafhængig, så en inkrementel udgave skal genberegne FRA den tidligst
-- ændrede runde og frem — og det kræver, at K-faktoren (32 under 5 spillede
-- runder, ellers 24) kan genskabes ved en vilkårlig rundegrænse. rating_history
-- gemmer rating_after, men ikke rounds_played, så den kolonne mangler. Lav den
-- skemaændring når målingen viser, at den er nødvendig — ikke på formodning.

-- ---------- tabeller ----------

create table if not exists public.ratings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null default 'ALL',
  rating numeric not null,
  rounds_played integer not null,
  provisional boolean not null,
  updated_at timestamp with time zone not null default now(),
  primary key (user_id, scope)
);

create table if not exists public.rating_history (
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null default 'ALL',
  round_key text not null,
  rating_after numeric not null,
  delta numeric not null,
  round_score numeric not null,
  matches_predicted integer not null,
  rnk integer not null,
  primary key (user_id, scope, round_key)
);

alter table public.ratings enable row level security;
alter table public.rating_history enable row level security;

-- Stillingerne må læses af alle indloggede: rating bygger kun på spillede kampe,
-- som altid er låste, så der er ingen snyde-risiko.
drop policy if exists ratings_read on public.ratings;
create policy ratings_read on public.ratings for select to authenticated using (true);

drop policy if exists rating_history_read on public.rating_history;
create policy rating_history_read on public.rating_history for select to authenticated using (true);

-- ---------- point-primitivet ----------
-- 3 = præcist resultat, 1 = rigtigt udfald, 0 = forkert, null = mangler data.
-- Bruges af rating, alle tre stillings-views, generate_stories() og career_profile().

CREATE OR REPLACE FUNCTION public.pc_points(ph integer, pa integer, hs integer, as_ integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when ph is null or pa is null or hs is null or as_ is null then null
    when ph = hs and pa = as_ then 3
    when sign(ph - pa) = sign(hs - as_) then 1
    else 0 end;
$$;

-- ---------- rundeinddelingen ----------
-- En spillerunde løber tirsdag til mandag. Funktionen giver rundens tirsdag og
-- ligger bag den genererede kolonne matches.round_key.

CREATE OR REPLACE FUNCTION public.round_key(ts timestamp with time zone) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  d date := ts::date;
  dow int := extract(dow from d)::int; -- 0=søn .. 2=tir .. 6=lør
  diff int := (dow - 2 + 7) % 7;
begin
  return d - diff;
end;
$$;

-- ---------- selve Elo-beregningen ----------
-- Multiplayer-Elo: ét ratingskridt pr. round_key på tværs af alle ligaer.
-- Rundescore = point / antal tippede kampe, tiebreak på antal præcise.
-- Alle deltagere sammenlignes én mod én. K = 32 de første 5 runder, derefter 24.
-- Fuld genberegning fra bunden — se bemærkningen øverst i filen.

CREATE OR REPLACE FUNCTION public.recompute_ratings() RETURNS void
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

grant all on function public.pc_points(ph integer, pa integer, hs integer, as_ integer) to anon, authenticated, service_role;
grant all on function public.round_key(ts timestamp with time zone) to anon, authenticated, service_role;
grant all on function public.recompute_ratings() to anon, authenticated, service_role;

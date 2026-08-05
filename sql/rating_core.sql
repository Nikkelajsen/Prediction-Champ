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
-- 2026) — med TO bevidste undtagelser, begge markeret i recompute_ratings():
--   1. logistikken i e_sum regnes i double precision i stedet for numeric
--      (30. juli 2026, ren optimering — tallene må IKKE flytte sig);
--   2. `_rs` joiner nu seasons/leagues og tæller kun **officielle** turneringer
--      (31. juli 2026, A17 — her SKAL tallene flytte sig).
-- Forskellen på de to er hele pointen med ækvivalenstesten: den frosne reference
-- i sql/tests/_reference_recompute.sql fanger #1 og blev bevidst opdateret med
-- #2. Alt andet er uændret, så filen fortsat beskriver det, der kører i
-- produktion.
--
-- Den ene linje er hele optimeringen: en fuld genberegning af en sæson gik fra
-- 19 sekunder til 0,1 sekund (31 spillere, 38 runder). Se afsnittet om måling
-- nederst.
--
-- BEMÆRK — BLANDEDE LINJEAFSLUTNINGER ER MED VILJE.
-- Kroppene indeholder CRLF, fordi de blev indsat i Supabases SQL-editor fra en
-- kilde med Windows-linjeskift og dermed ligger sådan i Postgres' prosrc.
-- Normaliserer man dem til LF, ændrer en kørsel prosrc, og næste skema-eksport
-- giver en stor, indholdsløs diff. Lad dem stå.
--
-- ÉN BEVIDST AFVIGELSE FRA PRODUKTION FRA 3. august 2026 (G11): `round_key()`
-- aflæser nu datoen i dansk tid frem for i sessionens tidszone. Kroppen er
-- dermed IKKE længere identisk med produktionens `prosrc`, før migreringen
-- `sql/round_key_timezone.sql` er kørt — og den fil er det eneste sted,
-- ændringen må komme fra, fordi den også skal flytte de rækker, hvis værdi
-- ændrer sig. Resten af filen er uændret.
--
-- EFTERPRØVET 3. august 2026 (G5) — og advarslen havde ret om databasen og
-- uret om filen. En frisk eksport viser CRLF i prosrc for ALLE 25 funktioner i
-- produktion, men filen her stod da med nul CR-tegn: kroppene var blevet
-- normaliseret ud af repoet, uden at nogen havde besluttet det, og filen var
-- dermed selv blevet dét, dens eget hoved advarede imod. Kroppene er hentet
-- ordret tilbage fra eksporten og er nu BYTE-identiske med produktionens
-- prosrc — en gen-kørsel er igen en ægte no-op. `.gitattributes` (`*.sql
-- -text`) er tilføjet samme dag, så det ikke kan ske igen ubemærket; uden den
-- afhang indholdet af den enkeltes editor og git-konfiguration.
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
-- MÅLING (PostgreSQL 16.13, 10 kampe pr. runde, 85% tip-dækning)
--   runder × spillere        før        efter
--   10 × 31                534 ms       42 ms
--   20 × 31              3.044 ms       54 ms
--   38 × 31             19.821 ms      101 ms
--   38 × 60             76.654 ms      252 ms
--   38 × 150           469.674 ms      993 ms
--
-- Bemærk formen på "før"-kolonnen: den vokser hurtigere end kvadratisk, fordi
-- numeric-potensen kaldes én gang pr. spillerpar pr. runde. Ved 150 spillere tog
-- en genberegning knap otte minutter — og den kører synkront i triggeren på
-- matches, altså inde i den sætning, api/sync-live.js bruger til at færdigmelde
-- en kamp. Det var en tikkende bombe, ikke et teoretisk problem.
--
-- To ting, der IKKE hjalp, og som derfor bevidst ikke er med (målt, ikke gættet):
--   * indeks på predictions(match_id) — 1.240 ms → 1.124 ms, altså inden for støjen
--   * indeks på temp-tabellen _rs(round_key) — gjorde det LANGSOMMERE (985 → 1.184 ms),
--     fordi indeksbygningen koster mere, end opslagene sparer ved denne størrelse
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
  -- G11 (august 2026): datoen aflæses i DANSK tid og ikke i sessionens.
  -- `ts::date` bruger `TimeZone`-indstillingen, så funktionen var reelt STABLE
  -- og ikke IMMUTABLE, som den er markeret — og en writer med en anden zone
  -- ville skrive en anden runde end resten. `timezone(text, timestamptz)` er
  -- selv IMMUTABLE (`pg_proc.provolatile = 'i'`), så markeringen er nu sand,
  -- og den genererede kolonne matches.round_key må fortsat bruge funktionen.
  d date := (ts at time zone 'Europe/Copenhagen')::date;
  dow int := extract(dow from d)::int; -- 0=søn .. 2=tir .. 6=lør
  diff int := (dow - 2 + 7) % 7;
begin
  return d - diff;
end;
$$;

-- ---------- selve Elo-beregningen ----------
-- Multiplayer-Elo: ét ratingskridt pr. round_key på tværs af alle OFFICIELLE
-- ligaer (`leagues.is_official`, se sql/tournament_scope.sql).
-- Rundescore = point / antal tippede kampe, tiebreak på antal præcise.
-- Alle deltagere sammenlignes én mod én. K = 32 de første 5 runder, derefter 24.
-- Fuld genberegning fra bunden — se bemærkningen øverst i filen.
--
-- HVORFOR FILTERET (A17, 31. juli 2026)
-- Indtil da havde beregningen intet liga-filter: enhver kamp, brugeren kunne
-- tippe, flyttede ratingen. Da A2 gav Championship to niveauer og lod
-- `is_official` afgøre titlerne, blev "officiel" to forskellige ting afhængigt
-- af hvilken skærm man stod på — og en turnering kunne flytte ratingen uden at
-- kunne vindes. Nu betyder `is_official` det samme overalt: en turnering tæller
-- enten alle officielle steder eller ingen. Din egen konkurrence tæller den
-- altid.
--
-- Bemærk, at problemet IKKE var bredde: rundescoren er `pts / n`, altså et
-- gennemsnit, så den, der tipper 12 kampe, havde aldrig et forspring på den,
-- der tipper 6. Det, filteret fjerner, er en systematisk skævhed af en anden
-- slags — to spillere blev sammenlignet på delvist forskellige kampsæt i samme
-- runde, og er den ene turnering lettere at forudsige end den anden, følger
-- rating med.
--
-- VILKÅR, ikke en fejl: en spiller, hvis tips ALLE ligger i uofficielle
-- turneringer, får ingen rating-række overhovedet. Brugerfladen viser "–" i
-- stillingerne og skjuler rating-feltet på Hjem; botemidlet er at forfremme
-- turneringen til officiel.

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
      select u.user_id, u.rating, u.rounds_played, u.score, u.n, u.exacts,
             count(*) as others,
             sum(case when u.score > v.score
                        or (u.score = v.score and u.exacts > v.exacts) then 1
                      when u.score = v.score and u.exacts = v.exacts then 0.5
                      else 0 end) as s_sum,
             -- Logistikken regnes i double precision, ikke numeric. `power(10, numeric)`
             -- med ikke-heltallig eksponent regner i vilkårlig præcision og koster ~110 µs
             -- pr. kald; med 31 spillere er det 930 kald pr. runde, og den ene linje stod
             -- ALENE for 16 af de 19 sekunder, en fuld sæson tog. float8 har ~15
             -- signifikante cifre — rigelig margin for et tal, der vises med én decimal.
             -- Målt afvigelse over en hel sæson: 2e-13 på rating, 5e-14 på delta, og
             -- identisk rangorden i hver eneste runde. Se målingen i DOCUMENTATION.md
             -- afsnit 12.
             sum(1.0 / (1 + power(10::float8, ((v.rating - u.rating) / 400.0)::float8)))::numeric as e_sum
      from pt u join pt v on v.user_id <> u.user_id
      group by u.user_id, u.rating, u.rounds_played, u.score, u.n, u.exacts
    ),
    solo as (
      select user_id, rating, rounds_played, score, n, exacts,
             0::numeric as others, 0::numeric as s_sum, 0::numeric as e_sum
      from pt where (select count(*) from pt) = 1
    ),
    allrows as (select * from agg union all select * from solo),
    d as (
      select user_id, rating, score, n, exacts,
             case when others = 0 then 0
                  else (case when rounds_played < 5 then 32 else 24 end)::numeric
                       / others * (s_sum - e_sum) end as d
      from allrows
    )
    select user_id, d, rating + d as rating_after, score, n,
           -- Samme tiebreak som Elo-opgøret ovenfor: score, så exacts (G68).
           -- Uden `exacts desc` delte to spillere med samme rundescore, men
           -- forskelligt antal præcise resultater, den GEMTE placering —
           -- selvom duellen skilte dem (`u.exacts > v.exacts` giver 1 og ikke
           -- 0.5). De to tal kommer fra samme beregning og står ved siden af
           -- hinanden i karriereprofilen og Story Engine, som begge læser rnk.
           rank() over (order by score desc, exacts desc) as rnk
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

-- recompute_ratings() er IKKE givet til klient-rollerne (G15, august 2026).
-- Funktionen er SECURITY DEFINER uden eget adgangstjek og sletter/genopbygger
-- hele ratings + rating_history fra runde nul. Så længe `anon` stod på denne
-- linje, var et `POST /rest/v1/rpc/recompute_ratings` med nøglen fra
-- klient-bundlen en gratis, gentagelig DB-dækkende skrivning.
--
-- De tre kaldere, der er tilbage — og hvorfor ingen af dem behøver grant'en:
--   * rating-triggeren (sql/rating_trigger_optimization.sql) er SECURITY
--     DEFINER og kalder som ejer;
--   * Admin-skærmen kalder wrapperen admin_recompute_ratings() med is_admin-
--     tjek (sql/security_hardening.sql);
--   * service_role omgår i forvejen alt og har grant'en herunder.
--
-- ⚠️ Sætter du anon/authenticated tilbage på denne linje, er hullet åbent igen.
grant execute on function public.recompute_ratings() to service_role;
revoke execute on function public.recompute_ratings() from public, anon, authenticated;

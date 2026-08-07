-- Kontrol: passer den GEMTE rating stadig til de data, den er udledt af? (G83)
--
-- HVORFOR DEN FINDES
-- Ratingen er den eneste store afledte størrelse i appen uden en bagstopper.
-- Den skrives af `matches`-triggeren (sql/rating_trigger_optimization.sql), og
-- triggeren fyrer kun, når nogen skriver til `matches`. Der findes mindst tre
-- veje uden om:
--
--   1. **Gendannelsen.** `docs/RESTORE.md` scenarie 1 foreskriver
--      `pg_restore --disable-triggers` — netop for at undgå, at indlæsningen
--      kalder `recompute_ratings()` midt i det hele. Efter den indlæsning ER
--      ratingen forkert, og indtil august 2026 sagde runbogen ikke, hvad man
--      så gør.
--   2. **Tips, der skrives efter kampen.** Rækken kommer i `predictions`, ikke
--      i `matches`, så triggeren ser den aldrig.
--   3. **En liga, der skifter `is_official`.** `_rs` tæller kun officielle
--      turneringer (A17), så flaget flytter tallene uden at røre en kamp.
--
-- I alle tre tilfælde står ratingen forkert, og det er den værste slags fejl:
-- den er **usynlig**. Der er ingen fejlbesked, intet job, der fejler, og ingen
-- tom skærm — kun et tal, der er lidt forkert, indtil nogen tilfældigvis retter
-- et resultat og udløser en genberegning.
--
-- HVAD DEN PÅSTÅR
-- `rating_history` (scope 'ALL') skal indeholde præcis de (runde, bruger)-par,
-- kildedataene giver, og med de samme tal. Kontrollen genberegner IKKE Elo'en
-- — den ville da bruge samme kode som den, der skal efterprøves. Den
-- efterprøver **inddataene til Elo'en**: `_rs`' aggregat i
-- `recompute_ratings()`, som er skrevet af igen nedenfor, holdt op mod
-- `round_score` og `matches_predicted` i den gemte historik.
--
-- Det er den rigtige afgrænsning, og prisen er sagt højt: en fejl inde i selve
-- Elo-skridtet fanges af `sql/tests/rating_equivalence.sql` i CI, ikke af
-- denne kontrol. Den her svarer på ét spørgsmål — **er historikken regnet på de
-- data, der står i databasen nu?**
--
-- HVORFOR TRE TAL OG IKKE ÉT
-- De tre uenigheder har hver sin årsag og hver sin hastighed:
--   · `manglende`  — runder/brugere, der aldrig blev regnet (gendannelsen,
--     et sent tip). Vokser med tiden.
--   · `foraeldede` — regnet, men på gamle tal (et rettet resultat, et ændret
--     `is_official`).
--   · `overfloedige` — regnet på data, der ikke findes mere (en slettet kamp,
--     en lukket konto, en nedrevet simulering).
-- Ét samlet tal ville kunne læses, men ikke handles på.
--
-- HVORFOR EN TOLERANCE PÅ round_score
-- `round_score` gemmes som `pts::numeric / n`, altså en division, der sjældent
-- går op. Sammenligningen sker derfor med `1e-9` og ikke med `=`: en kontrol,
-- der larmer over den sidste decimal i en numeric-division, bliver slukket
-- inden for en uge.
--
-- HVORFOR EN TEMPORÆR VIEW OG IKKE EN MIGRERING
-- Samme begrundelse som `kickoff_coverage.sql` og `league_admin_coverage.sql`:
-- der installeres INTET i produktionen — viewet lever kun i den psql-session,
-- der lige har læst filen — og den samme forespørgsel kan derfor køres både mod
-- produktion (job-heartbeat.yml) og mod en tom engangsdatabase i CI
-- (`sql/tests/rating_freshness.sql`). En kontrol, der er skrevet ét sted og
-- testet et andet, er to kontroller.
--
-- RETTELSEN, når den er rød: `select * from public.recompute_derived();`
-- (sql/recompute_derived.sql), eller Admin → "Opdater ratings" for ratingen
-- alene.
--
-- ---------------------------------------------------------------------------
-- SÅDAN KØRES DEN — TO VEJE, OG DE ER IKKE OMBYTTELIGE
--
-- **Vej A — Supabase SQL-editoren.** Indsæt HELE denne fil og tilføj en linje
-- til sidst:
--
--   select * from rating_freshness;
--
-- Begge sætninger skal sendes i SAMME kørsel: en temporær view lever kun i sin
-- egen session.
--
-- 🛑 **Editoren kan kun tage imod SQL.** `psql …` nedenfor er en
-- TERMINAL-kommando; indsat i editoren giver den
-- `42601: syntax error at or near "psql"`.
--
-- **Vej B — psql fra en terminal.** Kræver en session-forbindelse (port 5432):
--
--   psql "$SUPABASE_DB_URL" -q -At -F'|' \
--     -f sql/checks/rating_freshness.sql \
--     -c 'select manglende, foraeldede, overfloedige, tilstand from rating_freshness'
--
-- Det er vej B, en workflow ville bruge; vej A er den, et menneske bruger.

-- `or replace`, så filen kan læses to gange i samme session uden at fejle.
create or replace temporary view rating_freshness as
with kilde as (
  -- ORDRET `_rs` fra recompute_ratings() (sql/rating_core.sql), på nær at
  -- `exacts` er udeladt: den bruges kun inde i Elo-skridtet og gemmes ikke.
  -- Ændres `_rs` — et nyt filter, en anden join — SKAL denne blok følge med,
  -- ellers melder kontrollen hele databasen forældet. Det er den ene pris ved
  -- at skrive aggregatet af igen, og den er billigere end alternativet: at
  -- efterprøve en beregning med den beregning selv.
  select m.round_key::text as round_key,
         p.user_id,
         sum(public.pc_points(p.pred_home, p.pred_away, m.home_score, m.away_score)) as pts,
         count(*) as n
  from public.predictions p
  join public.matches m on m.id = p.match_id
  join public.seasons s on s.id = m.season_id
  join public.leagues l on l.id = s.league_id and l.is_official
  where m.home_score is not null and m.away_score is not null
    and p.pred_home is not null and p.pred_away is not null
  group by m.round_key, p.user_id
),
gemt as (
  select round_key, user_id, round_score, matches_predicted
  from public.rating_history
  where scope = 'ALL'
),
-- `full join` og ikke to opslag: begge retninger er interessante, og en
-- forældreløs række i historikken er lige så meget en uenighed som en manglende.
sammenholdt as (
  select k.user_id is null as kun_gemt,
         g.user_id is null as kun_kilde,
         (k.user_id is not null and g.user_id is not null
          and (g.matches_predicted <> k.n
               or abs(g.round_score - (k.pts::numeric / k.n)) > 1e-9)) as uenige
  from kilde k
  full join gemt g on g.round_key = k.round_key and g.user_id = k.user_id
)
select
  count(*) filter (where kun_kilde)::int    as manglende,
  count(*) filter (where uenige)::int       as foraeldede,
  count(*) filter (where kun_gemt)::int     as overfloedige,
  count(*) filter (where not kun_kilde and not kun_gemt)::int as sammenlignede,
  case
    when count(*) filter (where kun_kilde or uenige or kun_gemt) = 0 then 'ok'
    else 'RATING ER BAGUD'
  end as tilstand
from sammenholdt;

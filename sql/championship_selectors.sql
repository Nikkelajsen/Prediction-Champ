-- Championship-fanens to vælgere svares af databasen (G146).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- 📍 `#N` er en migrering: nummeret står i kolonne 1 i filoversigten i
--    `sql/README.md`, hvor filnavnene er links. `#73` =
--    `create_competition.sql`, denne fil er `#74`.
--
-- ✅ **REN TILFØJELSE — INGEN RETTIGHED SMALNES, INGEN RÆKKE ÆNDRES.** Filen
-- tilføjer to views og deres grants. Ingen tabel, ingen policy, ingen funktion.
--
-- 🔴 **MEN DEN SKAL KØRES FØR FRONTEND-MERGEN**, og det er den eneste
-- rækkefølge-regel i filen — nøjagtig som `#62 group_counts.sql`, som denne er
-- bygget efter: `loadMonthsAvailable()` og `loadRoundsAvailable()` læser
-- viewene, og et opslag mod et view, der ikke findes, svarer `404`.
-- Rækkefølgen er altså: **SQL i produktion først, PR merget derefter.**
--
-- Vinduet er ikke en hvid skærm, hvis rækkefølgen alligevel byttes om:
-- `ChampionshipTab` fanger en fejl fra hver af de to lister og falder tilbage
-- til den indeværende måned og en tom runde-vælger. Selve stillingerne
-- (`monthly_standings`, `round_standings`) er urørte og virker hele vejen.
--
-- ---------------------------------------------------------------------------
-- HVAD DER VAR GALT
--
-- De to vælgere er dropdowns med et par snese værdier i. De blev fyldt ved at
-- hente hele grundmængden og bygge et `Set` i browseren:
--
--   loadRoundsAvailable  → én række pr. SPILLET KAMP    (`matches`)
--   loadMonthsAvailable  → én række pr. bruger PR. MÅNED (`monthly_standings`)
--
-- `G145` gjorde de to læsninger KORREKTE — de læses sidevis siden 21. august
-- 2026 og taber ikke længere runder eller måneder — men ikke billige. Prisen
-- betales, hver gang Championship-fanen åbnes, den vokser med kampe og med
-- brugere, og den tælles i `A34`s egress-budget. Ved fem officielle turneringer
-- er runde-vælgeren alene i størrelsesordenen to tusind rækker for at svare med
-- fyrre.
--
-- Kuren er `G106`s regel: **vokser antallet med noget, brugeren kan forøge,
-- hører aggregeringen hjemme i databasen.** Et `distinct`-view svarer med
-- præcis de værdier, dropdownen viser.
--
-- ---------------------------------------------------------------------------
-- HVORFOR TO VIEWS OG IKKE `db.count()` ELLER ET RPC
--
-- `db.count()` (`G139`, `G147`) er kuren, når svaret er et TAL. Her er svaret en
-- LISTE af distinkte værdier, og der findes ingen fan-out at binde den til:
-- antallet af runder er ikke kendt på forhånd.
--
-- Et RPC ville også kunne, men et view er den mindste form, der findes: det
-- læses med den samme `db.select`, den samme `order=`, den samme sidevise
-- læsning og de samme policies som alt andet. Samme valg og samme begrundelse
-- som `group_counts` (`#62`), `competition_status` (`#39`/`#41`) og
-- `round_standings` (`#20`).
--
-- ---------------------------------------------------------------------------
-- `scope` ER IKKE OPFUNDET HER
--
-- Begge views bærer kolonnen `scope` med præcis den betydning, `round_standings`
-- og `monthly_standings` allerede giver den: `'ALL'` for hele championshippet,
-- ellers turneringens `leagues.id` som tekst. Formen — `cross join lateral
-- (values ('ALL'), (l.id::text))` — er kopieret ordret fra de to, så vælgeren og
-- stillingen ikke kan komme til at mene noget forskelligt med det samme ord.
--
-- ---------------------------------------------------------------------------
-- `security_invoker` ER BÆRENDE OG IKKE PYNT
--
-- Et view kører som standard med sin EJERS rettigheder og ville da svare uden om
-- RLS. Med `security_invoker = on` gælder kalderens egne policies på hver tabel
-- under viewet — `predictions`, `matches`, `seasons`, `leagues` — altså ordret
-- de samme rækker, klienten selv læste i går. **Migreringen ændrer derfor ikke
-- én værdi i en dropdown; den flytter kun, hvor listen gøres distinkt.**

-- ---------------------------------------------------------------------------
-- Runde-vælgeren: hvilke runder har mindst én spillet kamp?
--
-- Bygget på `matches` og IKKE på `round_standings`, og forskellen er bevidst:
-- `round_standings` findes kun, hvor nogen har TIPPET, mens vælgeren skal kunne
-- vise en runde, der er spillet færdig uden et eneste gæt — `loadRoundBoard`
-- tæller selv kampene og bruger dem til fremdriften ("12 af 20 spillet").
-- Havde viewet været bygget på stillingen, ville sådan en runde forsvinde ud af
-- dropdownen, og det ville være en ÆNDRING og ikke en optimering.
--
-- `home_score is not null` er ligeledes ordret klientens gamle filter. At
-- `away_score` ikke nævnes er ikke en forglemmelse: syncen skriver de to
-- sammen, og et enkelt filter er dét, den gamle vej målte.
--
-- Det sidste led i `where` er den ene finurlighed, der er arvet frem for
-- ryddet: ved `'ALL'` tæller kun OFFICIELLE turneringer (de er dem, der afgør
-- titler), mens et scope på én turnering ikke spørger til `is_official`.
-- Sådan så `scopeSeasonIds()` ud, og Championship-fanen sender i forvejen kun
-- officielle turneringer ind — leddet er altså en tro kopi, ikke en regel med
-- en fremtid.
create or replace view public.championship_rounds
with (security_invoker = on) as
select distinct
  x.scope,
  m.round_key
from public.matches m
join public.seasons s on s.id = m.season_id
join public.leagues l on l.id = s.league_id
cross join lateral (values ('ALL'::text), (l.id::text)) x(scope)
where m.home_score is not null
  and (x.scope <> 'ALL' or l.is_official);

-- ---------------------------------------------------------------------------
-- Måneds-vælgeren: hvilke måneder har mindst én scoret måned-række?
--
-- Rækkekilden er ordret `monthly_standings`' egen `scored`+`scoped`, bare uden
-- aggregeringen: samme joins, samme fire `not null`-krav, samme `is_official`,
-- samme `to_char(date_trunc('month', kickoff_at), 'YYYY-MM')`.
--
-- **Hvorfor ikke bare `select distinct scope, month from monthly_standings`?**
-- Fordi det ville tvinge databasen gennem hele stillingen — inklusive
-- `rank() over (…)`-vinduet, der tæller rundesejre — for at nå frem til en
-- liste på et dusin strenge. Prisen for gentagelsen er, at de to kan drive fra
-- hinanden, og dét er ikke overladt til opmærksomhed: `sql/tests/
-- championship_selectors.sql` stiller netop den påstand i begge retninger
-- (`except` hver vej, nul rækker), så et hvilket som helst indgreb i
-- `monthly_standings` fælder testen i CI.
create or replace view public.championship_months
with (security_invoker = on) as
select distinct
  x.scope,
  to_char(date_trunc('month', m.kickoff_at), 'YYYY-MM') as month
from public.predictions p
join public.matches m on m.id = p.match_id
join public.seasons s on s.id = m.season_id
join public.leagues l on l.id = s.league_id and l.is_official
cross join lateral (values ('ALL'::text), (l.id::text)) x(scope)
where m.home_score is not null
  and m.away_score is not null
  and p.pred_home is not null
  and p.pred_away is not null;

-- `revoke … from public` FØR `grant`, samme regel som for funktioner (`G96`).
-- `anon` er bevidst ikke med: Championship kræver login, og `anon_grants.sql`
-- (`#34`) fjernede rollens tabel-privilegier med den begrundelse, at bredden er
-- en REGEL og ikke en liste. `security_hardening.sql` lukkede i sin tid netop
-- `monthly_standings` for `anon` (`G16`/`S3`), og et view oven på den samme
-- rækkekilde må ikke lukke den op igen ad bagvejen.
--
-- `authenticated` revokes også først. Her er det ganske vist inert — `select
-- distinct` gør et view auto-opdaterbart pr. definition umuligt — men linjen
-- står, fordi reglen er en regel: Supabases `alter default privileges` giver
-- `authenticated` ALLE privilegier på hver ny relation i `public`, og den, der
-- en dag fjerner et `distinct`, skal ikke også skulle huske et `revoke`.
revoke all on public.championship_rounds from public, anon, authenticated;
revoke all on public.championship_months from public, anon, authenticated;
grant select on public.championship_rounds to authenticated, service_role;
grant select on public.championship_months to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- ⚠️ Blokkene er KOMMENTERET UD, så hele filen kan pastes i ét stykke.
--
-- 1) Viewene findes og er security_invoker. Forvent to rækker, begge 't'.
-- select c.relname, 'security_invoker=on' = any(c.reloptions) as invoker
--   from pg_class c
--  where c.relnamespace = 'public'::regnamespace
--    and c.relname in ('championship_rounds', 'championship_months');

-- 2) `anon` kan ikke læse dem. Forvent to gange 'f'.
-- select has_table_privilege('anon', 'public.championship_rounds', 'SELECT'),
--        has_table_privilege('anon', 'public.championship_months', 'SELECT');

-- 3) Måneds-viewet er den samme mængde som stillingen. Forvent 0 rækker —
--    kør den UDEN RLS, så den måler viewets aritmetik og ikke synligheden.
-- select 'mangler' as side, * from (
--   select distinct scope, month from public.monthly_standings
--   except select scope, month from public.championship_months) a
-- union all
-- select 'for meget', * from (
--   select scope, month from public.championship_months
--   except select distinct scope, month from public.monthly_standings) b;

-- 4) 📈 **AFLÆSNINGEN (`A32`), og den er hele grunden til, at rækken blev
--    skrevet ned frem for gættet.** Venstre tal er, hvad de to vælgere HENTEDE
--    før migreringen; højre er, hvad de svarer med nu. Er venstre tal over
--    1000, har listerne været afkortet i produktion før `G145` (21. august
--    2026) — altså har nogen set en vælger uden alle sine runder.
-- select
--   (select count(*) from public.matches m
--      join public.seasons s on s.id = m.season_id
--      join public.leagues l on l.id = s.league_id and l.is_official
--     where m.home_score is not null)                                   as runder_foer,
--   (select count(*) from public.championship_rounds where scope = 'ALL') as runder_nu,
--   (select count(*) from public.monthly_standings where scope = 'ALL')   as maaneder_foer,
--   (select count(*) from public.championship_months where scope = 'ALL') as maaneder_nu;

-- ============================================================================
-- Tilbagerulning
-- ============================================================================
-- Viewene er additive og har ingen aftagere ud over de to loadere. Skal de
-- alligevel væk, skal klienten rulles tilbage FØRST:
-- drop view if exists public.championship_rounds;
-- drop view if exists public.championship_months;

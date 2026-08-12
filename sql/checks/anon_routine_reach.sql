-- Kontrol: kan `anon` nå noget i `public`, den ikke skal? (G100)
--
-- HVORFOR DEN FINDES
-- `G96` (12. august 2026, [`#56`](../anon_grants_functions.sql)) lukkede `anon`
-- ude af alle 54 funktioner i `public` og efterlod en REGEL, databasen ikke kan
-- håndhæve selv: PostgreSQLs indbyggede default giver PUBLIC — og dermed `anon`
-- — EXECUTE på hver ny funktion, og den post kan ikke fjernes med
-- `ALTER DEFAULT PRIVILEGES`. Hver ny funktion i `public` skal derfor selv bære
-- sin `revoke execute … from public`. Hele begrundelsen står i den røde blok i
-- `sql/anon_grants_functions.sql`.
--
-- Vagten over den regel var indtil nu `sql/tests/anon_grants_functions.sql` i
-- CI, og den måler `sql/schema.sql` — et ØJEBLIKSBILLEDE. Migreringerne køres i
-- hånden i SQL-editoren, og eksporten er en ugentlig mandagskørsel plus en
-- manuel knap, så en funktion kunne stå åben for `anon` i produktionen i op til
-- en uge, uden at nogen påstand nogen steder var rød. Det er `G100`, og denne
-- fil er svaret: **den samme regel stillet mod en LEVENDE database.**
--
-- HVAD DEN PÅSTÅR
-- `anon` kan nøjagtig to ting i `public` — `username_available(text)` og
-- `invite_preview(text)` — hverken flere eller færre. Begrundelsen for netop de
-- to står i `#56`s afsnit "DE TO UNDTAGELSER".
--
-- **Begge retninger tæller, og de har hver sin pris.** For meget er en funktion,
-- en fremmed kan kalde uden login; for lidt er oprettelsen af en konto eller
-- invitationens etiket, der er lukket for netop den rolle, appen bruger dem i.
-- Den anden retning er ikke teoretisk: trin 2 i `#56` er en `all functions`-
-- sætning, som tager de to med, og de gives tilbage i trin 5. Byttes de to trin
-- om, er migreringen grøn og appen lukket.
--
-- HVORFOR OGSÅ PROCEDURER OG AGGREGATER — OG HVAD DET AFDÆKKEDE
-- Kontrollen filtrerer IKKE på `prokind`, og det er ikke en detalje. Efterprøvet
-- mod PostgreSQL 16.13 under `G100`:
--
--   · `revoke execute on all functions in schema public from public` dækker
--     funktioner og aggregater — men **IKKE procedurer.** En procedure i
--     `public` bliver stående åben for `anon`, og både `#56`s trin 2 og den
--     eksisterende tests `prokind = 'f'` er blinde for den.
--   · `alter default privileges … on functions` dækker derimod ALLE tre, så
--     `#56`s trin 3 lukker `anon`s egen grant også for en ny procedure. Det er
--     kun PUBLIC-halvdelen, der slipper igennem — altså præcis den halvdel, der
--     ikke kan lukkes ved kilden.
--
-- **Der findes nul procedurer i `public` i dag**, så det er ikke en fejl, men et
-- hul i vagten: en kontrol, der deler migreringens blinde vinkel, kan ikke se
-- den. Skrives den første procedure en dag, er dette det ene sted, der siger
-- det. `slags`-kolonnen findes for at kunne skelne — en `AABEN FOR ANON` på en
-- procedure har en anden rettelse end den på en funktion (`revoke execute on
-- procedure … from public`, og `#56`s `all functions` skal blive til
-- `all routines`).
--
-- HVORFOR `egen_grant` OG `via_public`
-- De dømmer ikke, de forklarer — samme rolle som `lukkede`/`opretter_lukket` i
-- `league_admin_coverage.sql`. `anon` kommer ind ad to veje, og de har hver sin
-- årsag og hver sin rettelse:
--
--   · `via_public` → rutinens migrering glemte sin `revoke execute … from
--     public`. Det er den, reglen handler om, og den forventede årsag.
--   · `egen_grant` → nogen har skrevet et eksplicit `grant … to anon`, ELLER
--     Supabases default privileges er åbnet igen (`#56`s trin 3 rullet tilbage).
--     Det er en beslutning, nogen har truffet, og skal enten begrundes i `#56`
--     eller rulles tilbage.
--
-- ⚠️ **PÅSTANDEN SPØRGER `has_function_privilege` OG IKKE EN GRANT-TABEL.**
-- PUBLIC giver adgang uden at nævne `anon` nogen steder, så en kontrol på
-- `information_schema.role_routine_grants` ville melde "lukket" om en funktion,
-- enhver kan kalde. `egen_grant`/`via_public` læser derimod ACL'en direkte —
-- de skal netop skelne de to veje og kan ikke bruge privilegie-funktionen.
--
-- HVORFOR EN TOM UDLÆSNING ER EN FEJL OG IKKE EN ROLIG DAG
-- Modsat `kickoff_coverage` (hvor nul rækker er en landsholdspause) kan denne
-- view ALDRIG svare tomt: de to tilladte rutiner giver hver sin række, uanset om
-- de findes, er åbne eller er lukkede. Nul rækker betyder derfor, at kontrollen
-- selv er i stykker — og den, der læser den, skal behandle det som rødt.
--
-- 🔴 **Rollen `anon` skal findes.** Gør den ikke, fejler filen med
-- `42704: role "anon" does not exist`, og det er med vilje: rollen ER Supabases
-- ikke-indloggede kalder, så en database uden den er ikke den database, reglen
-- handler om. En `case when exists …`-omgåelse ville gøre kontrollen tavs
-- præcis dér, hvor den måler det forkerte.
--
-- HVORFOR EN TEMPORÆR VIEW OG IKKE EN MIGRERING
-- Samme begrundelse som de fire søskende i denne mappe: der installeres INTET i
-- produktionen — viewet lever kun i den psql-session, der lige har læst filen —
-- og den samme forespørgsel kan derfor køres både mod produktion og mod en tom
-- engangsdatabase i CI (`sql/tests/anon_routine_reach.sql`). En kontrol, der er
-- skrevet ét sted og testet et andet, er to kontroller (`G84`s begrundelse).
--
-- ---------------------------------------------------------------------------
-- SÅDAN KØRES DEN — TO VEJE, OG DE ER IKKE OMBYTTELIGE
--
-- **Vej A — Supabase SQL-editoren.** Indsæt HELE denne fil og tilføj en linje
-- til sidst:
--
--   select * from anon_routine_reach order by (tilstand <> 'ok') desc, rutine;
--
-- Begge sætninger skal sendes i SAMME kørsel, fordi en temporær view kun lever
-- i sin egen session.
--
-- 🛑 **Editoren kan kun tage imod SQL.** `psql …` nedenfor er en
-- TERMINAL-kommando; indsat i editoren giver den
-- `42601: syntax error at or near "psql"`.
--
-- **Vej B — psql fra en terminal.** Kræver en session-forbindelse (port 5432),
-- som `SUPABASE_DB_URL` har:
--
--   psql "$SUPABASE_DB_URL" -q -At -F'|' \
--     -f sql/checks/anon_routine_reach.sql \
--     -c "select rutine, slags, egen_grant, via_public, tilstand
--           from anon_routine_reach order by (tilstand <> 'ok') desc, rutine"
--
-- Det er vej B, `job-heartbeat.yml` bruger; vej A er den, et menneske bruger.

-- `or replace`, så filen kan læses to gange i samme session uden at fejle.
create or replace temporary view anon_routine_reach as
with tilladte(sig) as (
  -- **Listen står ÉT sted mere, og de to skal følges ad:** `#56`s trin 5, som
  -- uddeler de to grants. Åbnes en tredje rutine for `anon`, er det en linje
  -- begge steder — og dét, at den skal skrives to gange, er hele pointen.
  values ('username_available(text)'), ('invite_preview(text)')
),
alle as (
  select
    -- Signaturen skrives UDEN skema: `regprocedure` tager `public.` med, når
    -- skemaet ikke står i sessionens `search_path`, og udelader det, når det
    -- gør — altså to forskellige tekster for den samme rutine. En kontrol, der
    -- sammenligner strenge, må ikke afhænge af, hvem der kører den.
    regexp_replace(p.oid::regprocedure::text, '^public\.', '')          as rutine,
    case p.prokind
      when 'f' then 'funktion'
      when 'p' then 'procedure'
      when 'a' then 'aggregat'
      when 'w' then 'vinduesfunktion'
      else p.prokind::text
    end                                                                 as slags,
    has_function_privilege('anon', p.oid, 'EXECUTE')                    as kan_anon,
    -- ACL'en læses direkte, fordi de to veje skal SKELNES. `acldefault` bruges,
    -- når `proacl` er null: da gælder PostgreSQLs indbyggede default (ejeren +
    -- PUBLIC), og det er netop den, reglen ikke kan lukke ved kilden. `'f'`
    -- dækker også procedurer og aggregater.
    exists (select 1 from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where a::text like 'anon=%')                               as egen_grant,
    exists (select 1 from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where a::text like '=%')                                   as via_public
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
-- 1. Alt, `anon` FAKTISK kan nå. To af dem er `ok`; resten er rækkens emne.
select a.rutine,
       a.slags,
       a.egen_grant,
       a.via_public,
       case when t.sig is not null then 'ok' else 'AABEN FOR ANON' end  as tilstand
  from alle a
  left join tilladte t on t.sig = a.rutine
 where a.kan_anon
union all
-- 2. …og den anden retning: en af de to, der IKKE er nået. `left join` frem for
--    et opslag, så en rutine, migreringen bag den aldrig blev kørt, kan skelnes
--    fra en, et `revoke` ramte for bredt — de har intet med hinanden at gøre.
select t.sig,
       coalesce(a.slags, '-'),
       coalesce(a.egen_grant, false),
       coalesce(a.via_public, false),
       case when a.rutine is null then 'FINDES IKKE' else 'LUKKET FOR ANON' end
  from tilladte t
  left join alle a on a.rutine = t.sig
 where a.rutine is null or not a.kan_anon;

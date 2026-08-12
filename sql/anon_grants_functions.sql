-- `anon` mister også FUNKTIONERNE — og den halvdel af kilden, der kan lukkes,
-- lukkes (G96).
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- 📍 `#N` er en migrering: nummeret står i kolonne 1 i filoversigten i
--    `sql/README.md`, hvor filnavnene er links. `#34` = `anon_grants.sql`,
--    `#43` = `anon_grants_finish.sql`, denne fil er `#56`.
--
-- Tredje og sidste del af oprydningen efter `G50`: #34 tog tabellerne, #43 tog
-- sekvenserne, og denne tager det, begge sagde eksplicit, at de ikke rørte.
--
-- ---------------------------------------------------------------------------
-- HVAD RÆKKEN ER — OG HVAD DEN IKKE ER
--
-- **Der er intet hul i dag.** Hver funktion, `anon` kan nå, afviser selv en
-- kalder uden `auth.uid()` — `invite_lookup()` og `accept_invite()` med
-- `raise exception 'forbidden'`, admin-RPC'erne med deres egen vagt — og den
-- ene bevidste undtagelse, `invite_preview()`, er besluttet og afgrænset i
-- `A41`. Fundet blev gjort under `I7` (11. august 2026), og det er netop dét,
-- der gør rækken værd at køre: **vagten inde i hver funktion er BÆRENDE og ikke
-- en dobbeltsikring.** En ny funktion, der glemmer sin `auth.uid()`-kontrol, er
-- eksponeret for `anon` fra det sekund, den oprettes — og en test, der måler
-- vagten som adfærd, fanger de funktioner, der findes, ikke den næste.
--
-- Efter denne migrering er retningen vendt for de funktioner, der findes i dag:
-- `anon` kan nøjagtig to. Det er samme slags dybde, #34 gav tabellerne — ikke en
-- rettelse, men et lag mere mellem en forglemmelse og en offentlig adgang.
--
-- ⚠️ **For en funktion, der oprettes i MORGEN, gælder det kun sammen med en
-- regel, filen ikke kan håndhæve selv** — læs den røde blok nedenfor, før du
-- skriver en ny funktion i `public`.
--
-- ---------------------------------------------------------------------------
-- ⚠️ PUBLIC ER DEN HALVDEL, RÆKKEN IKKE NÆVNTE — OG UDEN DEN VIRKER RESTEN IKKE
--
-- Backloggens `G96` foreskrev "en `revoke execute … from anon` som default plus
-- en eksplicit `grant` til de få". Det er ikke nok, og grunden er, at der er TO
-- veje ind:
--
--   1. `anon`s EGEN grant, som kommer fra Supabases default privileges
--      (`ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS TO anon`).
--   2. **PUBLIC**, som PostgreSQL selv giver EXECUTE på hver ny funktion. PUBLIC
--      betyder "enhver rolle", og `anon` er en rolle.
--
-- Fjernes kun (1), har `anon` stadig adgang gennem (2), og migreringen ville
-- have set ud til at virke: `information_schema.role_routine_grants` ville ikke
-- længere nævne `anon`, mens `has_function_privilege('anon', …)` stadig svarede
-- `true`. Aflæst i produktionens skema (12. august 2026): af 54 funktioner i
-- `public` kunne `anon` nå 35 gennem sin egen grant og 32 gennem PUBLIC.
--
-- **Det er derfor testen måler `has_function_privilege` og ikke en ACL-tekst.**
-- En kontrol, der spørger om grants, ville her svare på et andet spørgsmål, end
-- den tror — nøjagtig den fælde, `sql/README.md` allerede advarer om for
-- sekvenser (`information_schema` rapporterer kun USAGE).
--
-- ---------------------------------------------------------------------------
-- 🔴 DEN HALVDEL, DER **IKKE** KAN LUKKES VED KILDEN — LÆS DENNE, FØR DU
--    SKRIVER EN NY FUNKTION I `public`
--
-- #34 og #43 kunne lukke kilden helt: en ny tabel og en ny sekvens er lukket for
-- `anon`, fordi default privileges er det ENESTE, der gav den adgang. For
-- funktioner holder det ikke, og forskellen står i PostgreSQLs egne indbyggede
-- defaults (efterprøvet mod PostgreSQL 16.13):
--
--   acldefault('r', ejer) → {postgres=arwdDxt/postgres}          ← ingen PUBLIC
--   acldefault('S', ejer) → {postgres=U/postgres}                ← ingen PUBLIC
--   acldefault('f', ejer) → {=X/postgres,postgres=X/postgres}    ← **PUBLIC**
--
-- **Og den post kan ikke fjernes med `ALTER DEFAULT PRIVILEGES`.** `pg_default_acl`
-- gemmer kun TILLÆGGET til den indbyggede default, og de to flettes ved
-- oprettelsen af hvert objekt — fletningen kan kun LÆGGE TIL. Et
-- `revoke execute on functions from public` efterlader derfor en tom post,
-- PostgreSQL sletter rækken, og den indbyggede default gælder igen. Sætningen
-- fejler ikke; den gør ingenting. Den stod i første udgave af denne fil og er
-- fjernet, fordi en linje, der ligner en sikring uden at være det, er værre end
-- ingen linje.
--
-- **Følgen er en REGEL, der skal skrives i hånden hver gang:**
--
--   ⚠️ En ny funktion i `public` skal have `revoke execute on function … from
--   public;` FØR sin `grant execute … to <roller>;` — ellers er den åben for
--   `anon` fra sit første sekund, uanset denne migrering.
--
-- ✅ **En gen-kørsel af en migrering er derimod ufarlig.** `create or replace
-- function` BEVARER funktionens ACL, så de mange filer, der gen-køres
-- rutinemæssigt (`story_engine.sql`, `career_profile.sql`,
-- `analytics_dashboard.sql`), ikke åbner noget igen. **Det gør `drop function` +
-- `create function` til gengæld:** en droppet og genskabt funktion får den
-- indbyggede default tilbage og er åben for `anon` fra det sekund. Begge dele
-- efterprøvet mod PostgreSQL 16.13. Ingen af vores migreringer dropper en
-- funktion for at genskabe den (kun `#19`, som fjerner en for altid) — men
-- gør en det en dag, skal `revoke`-linjen med i samme ombæring.
--
-- ⚠️ **REGLEN GÆLDER OGSÅ PROCEDURER — OG DENNE FILS `all functions` GØR IKKE**
-- *(tilføjet 12. august 2026 under `G100`, efterprøvet mod PostgreSQL 16.13)*.
-- `revoke … on all functions in schema public` dækker funktioner og aggregater,
-- men **springer procedurer over** — både `from anon` og `from public`. En
-- procedure i `public` er derfor åben for `anon` fra sit første sekund, og
-- hverken trin 2 nedenfor eller `sql/tests/anon_grants_functions.sql`s
-- `prokind = 'f'` kan se den. Trin 3 dækker den til gengæld: `alter default
-- privileges … on functions` gælder alle tre slags, så `anon`s EGEN grant
-- lukkes også for en ny procedure. Det er kun PUBLIC-halvdelen, der slipper
-- igennem — altså præcis den halvdel, der ikke kan lukkes ved kilden.
--
-- **Der findes nul procedurer i `public` i dag**, så filen er ikke forkert; den
-- er smallere, end dens ordlyd lyder. Skrives den første procedure, skal
-- sætningerne i trin 2 være `all routines` — og det er `sql/checks/`-kontrollen
-- nedenfor, der siger til, fordi den ikke filtrerer på `prokind`.
--
-- Konventionen findes allerede i de fleste migreringer (`#31`, `#36`, `#42`,
-- `#46`, `#52`, `#54` m.fl. skriver netop de to linjer i den rækkefølge); det,
-- der manglede, var, at den var et krav frem for en vane. **Vagten er
-- `sql/tests/anon_grants_functions.sql`s påstand om HELE skemaet** — `anon` skal
-- kunne nøjagtig to funktioner — som bliver rød ved den første nye funktion,
-- der glemmer sin revoke. Den påstand er dermed ikke pynt ved siden af
-- migreringen, men den halvdel af leverancen, databasen ikke kan bære selv.
--
-- 🟢 **Og den påstand måler siden `G100` (12. august 2026) også PRODUKTIONEN.**
-- Testen ovenfor kører mod `sql/schema.sql`, altså et øjebliksbillede, der er
-- op til en uge gammelt. `sql/checks/anon_routine_reach.sql` stiller den samme
-- regel mod den levende database og køres af `job-heartbeat.yml` hver halve
-- time. Se verifikation 4b nedenfor.
--
-- ---------------------------------------------------------------------------
-- HVORFOR TRIN 1 FINDES: PUBLIC MÅ IKKE LUKKES I BLINDE
--
-- At revokere PUBLIC er den halvdel, der KAN gøre skade. Har en funktion aldrig
-- fået sin egen grant til `authenticated` — fordi den er oprettet i hånden, af
-- en anden rolle, eller før Supabases defaults blev sat — så er PUBLIC det
-- eneste, der holder den åben, og en revoke ville lukke den for den indloggede
-- bruger midt i den varme sti.
--
-- Aflæst i produktionens skema er det ikke tilfældet: alle 43 funktioner,
-- `authenticated` kan nå, har hver sin eksplicitte grant. **Men et svar fra en
-- bestemt dag er ikke en garanti** — `#50`s policy og `#3`s indeks fandtes
-- begge kun i skema-eksporten og i ingen migrering, så "det står i dumpet" er
-- den forudsætning, dette repo oftest er blevet snydt af.
--
-- Trin 1 gør derfor migreringen sikker VED KONSTRUKTION frem for ved en
-- optælling: den fastfryser den adgang, `authenticated` og `service_role`
-- FAKTISK har i dag, som eksplicitte grants — og først derefter lukkes PUBLIC.
-- Har de adgangen i forvejen, ændrer trinnet ingenting og melder det (`notice`);
-- har de den kun gennem PUBLIC, beholder de den. Ingen af delene kan tage noget
-- fra nogen.
--
-- ⚠️ **`_anonymize_account(uuid)` er prøven på, at trinnet ikke er for bredt.**
-- Den er `security definer`, tager et bruger-id og har ingen egen `auth.uid()`-
-- vagt — den ville kunne lukke en fremmeds konto. `#42` revokerede den derfor
-- fra `public, anon, authenticated`, og fordi trin 1 kun materialiserer det,
-- rollen ALLEREDE kan, bliver den ved med at være lukket. En variant, der bare
-- havde skrevet `grant execute on all functions … to authenticated`, ville have
-- åbnet den.
--
-- ---------------------------------------------------------------------------
-- DE TO UNDTAGELSER, OG HVORFOR DER IKKE ER FLERE
--
-- `anon` er rollen FØR login, og appen laver præcis to kald i den tilstand:
--
--   · `username_available()` — oprettelsen af en konto (#3, §6).
--   · `invite_preview()`     — invitationens etiket (#54, `I7`/`A41`).
--
-- Alt andet i appen sender brugerens JWT, hvor rollen er `authenticated`.
-- Login, oprettelse og nulstilling går til `/auth/v1/*`, som slet ikke er
-- PostgREST. Skal en tredje funktion nogensinde åbnes, er det en linje her —
-- og dét, at den skal skrives, er hele pointen.
--
-- 🔴 **Filen forudsætter, at begge funktioner findes** (#3 og #54). Gør de det
-- ikke, fejler den med `42883` på den sidste blok — højlydt og med navnet i
-- fejlteksten, hvilket er den rigtige måde at opdage, at en migrering er
-- sprunget over.
--
-- ---------------------------------------------------------------------------
-- ADFÆRDSÆNDRING VED KØRSEL: INGEN, hvis appen gør som beskrevet
--
-- Skulle et flow alligevel kalde en funktion uden login, viser det sig som
-- `permission denied for function …` med det samme og ikke som forkerte data.
-- Tilbagerulningen er tre linjer og står nederst.
--
-- **Kan køres når som helst** — den er uafhængig af et deploy, fordi den ikke
-- rører en eneste funktions krop eller signatur.

-- ---------- 1. Fastfrys den adgang, de indloggede roller HAR ----------
-- Se filens hoved. Gør intet, når grants'ene allerede er eksplicitte — hvilket
-- de er i produktion pr. 12. august 2026.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig, rolle.navn as rolle
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     cross join (values ('authenticated'), ('service_role')) as rolle(navn)
     where ns.nspname = 'public'
       and p.prokind = 'f'
       and has_function_privilege(rolle.navn, p.oid, 'EXECUTE')
       -- Har rollen sin EGEN post i ACL'en, er der intet at materialisere.
       -- `acldefault` bruges, når `proacl` er null: da gælder PostgreSQLs
       -- indbyggede default (ejeren + PUBLIC), og rollen har altså adgangen
       -- gennem PUBLIC.
       and not exists (
         select 1 from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a::text like rolle.navn || '=%')
  loop
    execute format('grant execute on function %s to %I', r.sig, r.rolle);
    n := n + 1;
  end loop;
  if n = 0 then
    raise notice 'Intet at materialisere: authenticated og service_role har alle deres EXECUTE som egne grants.';
  else
    raise notice 'Materialiserede % implicitte EXECUTE-privilegier, som hidtil kom fra PUBLIC.', n;
  end if;
end $$;

-- ---------- 2. Fjern det, `anon` har i dag ----------
-- Begge veje ind, i den rækkefølge de blev fundet.
revoke all on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

-- ---------- 3. Luk den halvdel af kilden, der KAN lukkes ----------
-- `anon`s egen default-grant. PUBLIC's indbyggede EXECUTE kan ikke lukkes
-- herfra — se den røde blok i filens hoved for hvorfor, og for den regel, der
-- træder i stedet.
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- ---------- 4. Forsøg kilden for det, Supabase selv opretter ----------
-- Samme forbehold og samme form som #34 og #43: sætningen kræver medlemskab af
-- `supabase_admin`, som SQL-editorens session normalt ikke har. Følgen er
-- snævrere, end den lyder — reglen gælder kun objekter, der oprettes AF den
-- rolle, og alt, vi selv opretter, ejes af `postgres` og er dækket af trin 3.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon';
  raise notice 'supabase_admin-defaults for funktioner lukket.';
exception when others then
  raise warning $m$Kunne ikke ændre default privileges for supabase_admin (%).
Det betyder: en funktion, der oprettes AF rollen supabase_admin i public, vil stadig få EXECUTE til anon.
Alt, vi selv opretter, kører som postgres og er dækket af trin 3.$m$, sqlerrm;
end $$;

-- ---------- 5. Åbn de to, der SKAL være åbne ----------
-- Rækkefølgen er bindende: trin 2 tog dem med, fordi det er en `all functions`-
-- sætning, og de gives tilbage her. Står de to linjer FØR trin 2, lukker
-- migreringen oprettelsen af nye konti og invitationens etiket.
grant execute on function public.username_available(text) to anon;
grant execute on function public.invite_preview(text) to anon;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- ⚠️ Blokkene er KOMMENTERET UD, så hele filen kan pastes i ét stykke.
--
-- 1) `anon` kan nøjagtig to funktioner i public — hverken flere eller færre.
--    Forvent præcis disse to rækker: username_available, invite_preview.
--    Spørg `has_function_privilege` og ikke en grant-tabel: PUBLIC giver adgang
--    uden at nævne `anon` nogen steder.
-- select p.oid::regprocedure as funktion
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prokind = 'f'
--    and has_function_privilege('anon', p.oid, 'EXECUTE')
--  order by 1;

-- 2) PUBLIC har intet tilbage i public. Forvent 0 rækker.
-- select p.oid::regprocedure
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prokind = 'f'
--    and exists (select 1 from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a
--                 where a::text like '=%')
--  order by 1;

-- 3) De indloggede roller er urørte. Forvent samme tal som før kørslen —
--    43 og 54 pr. 12. august 2026.
-- select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated,
--        count(*) filter (where has_function_privilege('service_role',  p.oid, 'EXECUTE')) as service_role,
--        count(*) as i_alt
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prokind = 'f';

-- 4) Kilden: forvent INGEN 'anon=' for grantor postgres på objekttype 'f'.
--    Står der stadig en for supabase_admin, er trin 4 afvist, og forbeholdet i
--    hovedet gælder. **Forvent til gengæld ikke, at PUBLIC er væk her** — den
--    står slet ikke i tabellen, fordi den er PostgreSQLs indbyggede default og
--    ikke et tillæg. Det er dét, den røde blok i hovedet handler om.
-- select r.rolname as grantor, d.defaclobjtype, d.defaclacl
--   from pg_default_acl d
--   join pg_roles r on r.oid = d.defaclrole
--   join pg_namespace n on n.oid = d.defaclnamespace
--  where n.nspname = 'public' and d.defaclobjtype = 'f';

-- 4b) **Den kontrol, der skal køres efter HVER ny funktion i `public`, har fået
--     sin egen fil:** [`sql/checks/anon_routine_reach.sql`](./checks/anon_routine_reach.sql)
--     (`G100`, 12. august 2026). Forespørgslen stod her som en udkommenteret
--     blok, indtil den fik en fil, en test og et CI-trin — og et sted, der
--     kører den. Indsæt filen i SQL-editoren efterfulgt af
--
--       select * from anon_routine_reach order by (tilstand <> 'ok') desc, rutine;
--
--     og forvent præcis to rækker, begge `ok`. `job-heartbeat.yml` kører den
--     samme fil mod produktion hver halve time, så en glemt `revoke` melder sig
--     selv inden for en halv time frem for ved næste skema-eksport.
--
--     Den nye fil er BREDERE end blokken, der stod her: den filtrerer ikke på
--     `prokind` — se den røde blok ovenfor om procedurer.

-- 5) Oprettelsen af en konto virker stadig.
-- set role anon; select public.username_available('et-eller-andet-navn'); reset role;

-- 6) Invitationens etiket virker stadig (`I7`). Brug en rigtig kode.
-- set role anon; select public.invite_preview('din-kode-her'); reset role;

-- ============================================================================
-- Tilbagerulning
-- ============================================================================
-- grant all on all functions in schema public to anon;
-- grant execute on all functions in schema public to public;
-- alter default privileges for role postgres in schema public grant all on functions to anon;

# Udrulning af `A43` — læsefladen smalnes

🔴 **IKKE KØRT ENDNU.** Koden er merget; de to migreringer skal køres i hånden i
Supabase, og de har et **deploy imellem sig**. Samme form som
[`UDRULNING-A40.md`](./UDRULNING-A40.md), som er skabelonen: en additiv halvdel,
der kan køres når som helst, og en indsnævrende, der køres efter udrulningen.

## Register — hvor står vi?

Sæt ✅ efterhånden. Bliver du afbrudt, er registeret det eneste, der fortæller,
hvor du var.

| Trin | Hvad | Tilstand |
|---|---|---|
| 1 | `sql/read_scope_functions.sql` (#59) kørt i **staging** | ⬜ |
| 2 | Staging afprøvet med den GAMLE klient: intet er gået i stykker | ⬜ |
| 3 | `sql/read_scope_narrow.sql` (#60) kørt i **staging** | ⬜ |
| 4 | Staging afprøvet med den NYE klient — de syv skærme nedenfor | ⬜ |
| 5 | 📈 **Prisen målt i staging:** liga-siden med rigtige tal | ⬜ |
| 6 | `sql/read_scope_functions.sql` (#59) kørt i **produktion** | ⬜ |
| 7 | PR merget, Vercel-deploy færdig | ⬜ |
| 8 | Produktionen afprøvet: login, Rating, en konkurrence, navneskift | ⬜ |
| 9 | `sql/read_scope_narrow.sql` (#60) kørt i **produktion** | ⬜ |
| 10 | Produktionen afprøvet igen, og fladen efterprøvet smal | ⬜ |

---

## Hvorfor to trin og ikke ét

Præcis `A40`s begrundelse: Supabase betjenes i hånden, Vercel deployer af sig
selv, og de to kan ikke ramme det samme sekund. Uanset hvilken rækkefølge man
valgte for én samlet fil, ville der være et vindue, hvor appen var i stykker:

- **SQL først:** den gamle klient henter sin egen profilrække med `select=*` og
  Admin → Brugere med fire lukkede kolonner. Begge svarer `permission denied for
  table profiles` fra det sekund, `#60` er kørt — altså **hele indlogningen**,
  ikke bare en skærm.
- **Frontend først:** den nye klient kalder `my_profile()` og `admin_profiles()`,
  som ikke findes endnu. Samme symptom, anden årsag.

Delt i to har hvert trin en tilstand, hvor det, der er i produktion, virker:

| Efter | Gammel klient | Ny klient | Hullet |
|---|---|---|---|
| #59 | virker | virker | åbent |
| deploy | væk | virker | åbent |
| #60 | — | virker | **lukket** |

Mellemtilstanden er ikke en formodning: `sql/tests/read_scope.sql` afsnit 2b
måler den — den gamle klients brede opslag skal stadig virke efter `#59`.

---

## Trin for trin

### Staging først (trin 1–5)

1. **Kør `sql/read_scope_functions.sql`** i staging-projektets SQL-editor med
   "Run without RLS". Additiv: tre funktioner og deres grants.
2. **Afprøv med den GAMLE klient** (staging peger på `main` indtil PR'en
   merges): log ind, åbn en konkurrence, åbn Admin → Brugere. Alt skal virke
   uændret — det er dét, der gør trin 6 sikkert at køre før mergen.
   📈 **Kør samtidig måleblokken fra trin 5 her**, mens den gamle policy stadig
   står. Det er FØR-tallet, og det kan ikke hentes bagefter.
3. **Kør `sql/read_scope_narrow.sql`.** Nu er fladen smal.
4. **Afprøv med den NYE klient** (preview-deployet af PR'en). Seks skærme, og de
   er valgt, fordi de hver rammer en gren, der kunne fejle (den syvende kom
   til, da `write_surface`-testen fandt de tre policies, der læser `is_admin`):

   | Skærm | Hvad der bevises |
   |---|---|
   | Login / app-start | `my_profile()` — ellers er man navnløs |
   | Rating-fanen | `read profiles` er urørt: navnene står stadig |
   | En konkurrence | `competitionState.js`s smalle `select=` |
   | Liga-siden | deltagerantallet på hvert kort er ikke 0 |
   | Skift brugernavn | `returning` med et `select=` |
   | Admin → Brugere | `admin_profiles()` og dens `is_admin`-vagt |
   | Admin → Drift | `is_platform_admin()` — `job_runs`' policy læste `is_admin` |

5. 📈 **Mål prisen — det er rækkens ene åbne omkostningsspørgsmål.**
   `loadGroupDetail` henter deltagere for ALLE konkurrencer i en liga, og hver
   række koster nu et `is_competition_visible()`-kald.

   **Hvor:** i **staging-projektets SQL-editor** (Supabase → SQL Editor), ikke i
   produktionen og ikke i en terminal. `explain analyze` UDFØRER forespørgslen,
   men den er ren læsning og står desuden i en transaktion, der rulles tilbage.
   **Sæt IKKE "Run without RLS"** — RLS er præcis det, der skal måles.

   🔴 **Editoren forbinder altid som `postgres`, og `postgres` er tabellernes
   ejer, så RLS gælder den ikke.** Kører du forespørgslen bare, måler du derfor
   en verden uden policies — altså baseline, ikke prisen. Rollen og brugeren
   skal sættes eksplicit; det er de tre linjer over `explain` nedenfor, og de er
   hele forskellen på en måling og et tal, der ser rigtigt ud.

   **Find først de to id'er, blokken skal bruge.** Der er to veje, og de er
   HELE forespørgsler hver for sig — kør den ene, ikke stumper af begge.

   Vej A, den sikre: de fem ligaer med flest konkurrencer, uanset hvad de
   hedder.

   ```sql
   select g.id as gruppe_id, g.name,
          (select count(*) from public.competitions c where c.group_id = g.id) as konkurrencer,
          (select min(m.user_id::text) from public.group_members m where m.group_id = g.id) as et_medlem
     from public.groups g
    order by konkurrencer desc
    limit 5;
   ```

   Vej B, hvis du hellere vil pege på en bestemt liga: `invite_code` er den kode,
   der kan kopieres i appen (8 tegn). **Den skal i anførselstegn** — uden dem
   læser PostgreSQL den som et kolonnenavn og svarer `42703`.

   ```sql
   select g.id as gruppe_id, g.name,
          (select count(*) from public.competitions c where c.group_id = g.id) as konkurrencer,
          (select min(m.user_id::text) from public.group_members m where m.group_id = g.id) as et_medlem
     from public.groups g
    where g.invite_code = '<KODEN-FRA-APPEN>';
   ```

   ⚠️ **Koden skal komme fra STAGING-appen.** Staging har sin egen database med
   sine egne ligaer, så en kode kopieret fra produktionen findes ikke her —
   forespørgslen svarer bare tomt, hvilket ligner en fejl i forespørgslen frem
   for i valget af database. Vej A kan ikke ramme den fælde, fordi den kun kan
   give dig ligaer, der findes i den database, du står i.

   Uanset vej: `gruppe_id` er en **uuid** og går ind i `<GRUPPE-ID>`; `et_medlem`
   går ind i `<BRUGER-ID>`. Invitationskoden bruges kun til at FINDE ligaen —
   den skal ikke ind i måleblokken.

   Sæt de to id'er ind og kør så denne. Den impersonerer et rigtigt medlem, og
   `rollback` gør hele blokken uden virkning:

   ```sql uddrag
   begin;
     select set_config('request.jwt.claim.sub',  '<BRUGER-ID>', true);
     select set_config('request.jwt.claim.role', 'authenticated', true);
     set local role authenticated;

     -- Kvitteringen: uden den er resten et tal, der ser rigtigt ud.
     select current_user::text as rolle,
            current_setting('request.jwt.claim.sub', true) as bruger;

     explain analyze
     select competition_id from public.competition_participants
      where competition_id in (select id from public.competitions where group_id = '<GRUPPE-ID>');
   rollback;
   ```

   🔴 **Sådan ser du, at impersoneringen virkede:** den lille `select` skal svare
   `authenticated` og dit bruger-id. Svarer den `postgres`, gælder RLS ikke, og
   `Execution Time` er baseline frem for prisen.

   **Kvitteringen er bevidst et `current_user`-opslag og ikke en linje i planen.**
   Første udgave af trinnet bad om at genkende
   `Filter: (… OR is_competition_visible(competition_id))` — men den linje findes
   kun EFTER `#60`, så kontrollen ville have meldt "impersoneringen virkede ikke"
   på FØR-målingen, hvor alt var i orden. Samme fejlklasse som `B26`s runbog
   faldt i tre gange: forkert på formen, ikke på indholdet. `current_user` er
   sandt i begge tilstande.

   *(Og den må ikke skrives som `select auth.uid()`: det kræver USAGE på skemaet
   `auth`, som Supabase giver `authenticated`, men en lokal kopi af skemaet ikke
   nødvendigvis gør — så kvitteringen ville fejle netop dér, hvor man prøver den
   af. `current_setting` læser den samme værdi uden at røre skemaet.)*

   Efterprøvet mod PostgreSQL 16.13 med Supabases egen `auth.uid()`, i BEGGE
   tilstande.

   **Den bedste sammenligning er før/efter og ikke bruger/ejer**, og staging går
   gennem begge tilstande af sig selv: kør den samme blok i **trin 2** (hvor
   `read all participation` stadig er `auth.role() = 'authenticated'`) og igen
   her. Forskellen mellem de to `Execution Time` ER policyens pris på rigtige
   tal.

   Er forskellen mærkbar på en rigtig liga, er svaret **ikke** at rulle policyen
   tilbage, men at lade `loadGroupDetail` hente deltagerantallet ét sted fra —
   linjen står i backloggens indbakke.

### Produktion (trin 6–10)

6. **Kør `sql/read_scope_functions.sql`** i produktionens SQL-editor. Sikker at
   køre før mergen; adfærdsændring: ingen.
7. **Merge PR'en** og vent, til Vercel-deployet er færdigt.
8. **Afprøv produktionen** med den nye klient: log ind, åbn Rating, åbn en
   konkurrence, skift dit brugernavn og skift det tilbage. **Hullet er stadig
   åbent her, og det er meningen** — først når denne prøve er bestået, må trin 9
   køres.
9. **Kør `sql/read_scope_narrow.sql`** i produktionen.
10. **Afprøv igen** (samme syv skærme som trin 4), og kør efterprøvningen.
    Den er **ét statement** med vilje: en blok af udkommenterede forespørgsler
    svarer *"Success. No rows returned"*, som ligner et svar på et spørgsmål,
    der aldrig blev stillet — det skete under `A40` 11. august 2026. Denne er
    kørbar, som den er, og samler alle seks tjek i ét svar:

    ```sql
    select 'laesbare kolonner (forvent anonymized_at, display_name, id)' as tjek,
           coalesce(string_agg(column_name, ', ' order by column_name), 'ingen') as svar
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'profiles'
       and grantee = 'authenticated' and privilege_type = 'SELECT'
    union all
    select 'bred SELECT paa profiles (forvent f)',
           has_table_privilege('authenticated', 'public.profiles', 'SELECT')::text
    union all
    select 'nye policies (forvent 2)', count(*)::text from pg_policies
     where schemaname = 'public'
       and policyname in ('competitions_select_involved',
                          'competition_participants_select_visible')
    union all
    select 'gamle policies (forvent 0)', count(*)::text from pg_policies
     where schemaname = 'public' and policyname = 'read all participation'
    union all
    select 'read profiles uroert (forvent t)',
           exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'profiles'
                      and policyname = 'read profiles'
                      and qual = '(auth.role() = ''authenticated''::text)')::text
    union all
    select 'policies der laeser profiles (forvent 0)', count(*)::text from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%profiles%'
    union all
    select 'funktioner (forvent 4)', count(*)::text from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('my_profile', 'admin_profiles', 'is_platform_admin',
                       'is_competition_visible');
    ```

    **anonymized_at, display_name, id / f / 2 / 0 / t / 0 / 4.** Den næstsidste er
    den vigtigste og den mest overraskende: et RLS-udtryk evalueres med den
    KALDENDE rolles privilegier, så en policy, der læser `profiles.is_admin`,
    holder op med at filtrere og begynder at FEJLE (`42501`), når kolonnen
    lukkes. Er tallet over nul, er Admin → Drift brækket — også for dig. Skriv svaret ind i
    registeret ovenfor, som `A40` gjorde. Et tal i et register kan efterprøves;
    et ✅ kan ikke.

---

## Hvis noget går galt

**Tilbagerulningen står nederst i `sql/read_scope_narrow.sql`** og er tre
statements. Den gør læsefladen bred igen — præcis som den har været hele tiden —
og det er den rigtige pris at betale for at få appen tilbage med det samme.

| Symptom | Sandsynlig årsag | Gør dette |
|---|---|---|
| `permission denied for table profiles` ved login | `#60` kørt før deployet | Kør tilbagerulningen, eller færdiggør deployet |
| Admin-fanen er forsvundet for dig selv | `my_profile()` svarer ikke — `#59` ikke kørt | Kør `#59` |
| Admin → Brugere: "Kunne ikke hente brugerne" | `admin_profiles()` findes ikke, eller du er ikke `is_admin` | Kør `#59`; tjek `select is_admin from public.profiles where id = '<dit id>'` |
| Admin → Drift svarer `permission denied for table profiles` | `#60`s afsnit 2 er ikke kørt — policyen læser stadig `is_admin` direkte | Kør `#60` igen; efterprøvning: 0 policies må nævne `profiles` |
| Navne mangler i en stilling | `read profiles` er blevet rørt alligevel | Efterprøvning 5 ovenfor |
| Liga-siden viser 0 deltagere på hvert kort | `is_competition_visible()` er smallere end `#53`s regel | Efterprøvning 6; sammenlign med testens matrix |
| `42P17 infinite recursion` | En policy er skrevet om til at slå direkte op i `competitions` | Kør `#60` igen — den lægger reglen tilbage i funktionen |
| `create policy` fejler med `42883` | `#60` kørt uden `#59` | Kør `#59` først |

---

## Hvad ændrer sig for brugerne

**Ingenting, hvis det gøres rigtigt.** Ikke én skærm skal se anderledes ud:
navnene står stadig i hver stilling, deltagerantallet står stadig på hvert kort,
og Admin → Brugere viser den samme liste.

Det, der ændrer sig, er, hvad en fremmed med en konto kan hente ved siden af
appen: ikke længere hele brugerlisten med `is_admin` og `last_seen_at`, og ikke
længere hele det sociale netværk med ét kald.

**Det, rækken IKKE lukker, er `A44`:** listen af visningsnavne er stadig
offentlig for enhver med en konto, fordi Rating og Championship (`scope='ALL'`)
publicerer den med vilje. Det er en produktbeslutning om, hvad tavlen skal VISE,
og den står åben i [`BACKLOG.md`](./BACKLOG.md).

-- Prediction Champ — Sikkerhedsstramning (G14, G15, G16 — august 2026)
-- Idempotent — kan køres igen når som helst. Kør i Supabase SQL-editor med
-- "Run without RLS".
--
-- Lukker de tre 🔴-fund i docs/reviews/2026-08-app-review.md §3 (S1-S3). Alle
-- tre er huller i ADGANGSLAGET, ikke i logikken: intet af det, appen viser eller
-- beregner, ændrer sig af denne migrering. Den ændrer kun, HVEM der må gøre det.
--
--   G14/S1  matches kunne skrives af enhver indlogget bruger
--   G15/S2  recompute_ratings() kunne kaldes uautentificeret
--   G16/S3  monthly_standings lækkede per-bruger-point til anon
--
-- RÆKKEFØLGE: kør efter #0 (rating_core.sql), #5 (rating_trigger_optimization.sql)
-- og #20 (tournament_scope.sql). Alle tre findes for længst i produktion.
--
-- ⚠️ TRE ÆLDRE FILER RULLER DENNE MIGRERING TILBAGE, hvis de gen-køres alene:
--    rating_core.sql (#0) og rating_trigger_optimization.sql (#5) er rettet i
--    samme ombæring og er derfor sikre — men `tournament_scope.sql` (#20) og
--    `standings_tiebreakers.sql` (#12) genskaber `monthly_standings`. #20 er
--    også rettet; #12 er det IKKE (den er i forvejen afløst og må ikke køres).
--    Se sql/README.md.

-- ============================================================================
-- G14 — skriveadgang til `matches` gøres admin-only
-- ============================================================================
-- FØR: `insert matches` og `update matches` krævede kun `auth.role() =
-- 'authenticated'`, og UPDATE havde slet ingen `with check`. Den publishable
-- nøgle ligger i klient-bundlen, så enhver, der havde oprettet en konto, kunne
-- sætte home_score/away_score på en vilkårlig kamp med ét PostgREST-kald — det
-- tildeler point, flytter alle stillinger og udløser rating-triggeren.
--
-- EFTER: samme is_admin-tjek, som resten af skemaet allerede bruger
-- (job_runs_read_admin, admin_*-funktionerne, api/_shared.js:165). Det er
-- bevidst IKKE service_role-only: Admin-skærmens resultatfelt
-- (AdminScreen.jsx:164) skriver direkte med brugerens eget token, og knappen
-- vises i forvejen kun for `profile.is_admin` (MainApp.jsx:29,391). Med denne
-- policy er den regel nu håndhævet i databasen frem for kun i brugerfladen.
--
-- `service_role` er upåvirket — den omgår RLS, og det er den, syncen bruger.
--
-- Undersøgt i samme ombæring: `teams`, `seasons` og `leagues` har samme
-- `grant all`, men INGEN skrive-policies, så RLS afviser dem allerede.
-- `matches` var det eneste hul.

drop policy if exists "insert matches" on public.matches;
drop policy if exists "update matches" on public.matches;
drop policy if exists matches_insert_admin on public.matches;
drop policy if exists matches_update_admin on public.matches;

create policy matches_insert_admin on public.matches
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- `using` afgør, hvilke rækker der må rettes; `with check`, hvordan de må se ud
-- bagefter. Den gamle policy havde kun `using` — uden `with check` er der ingen
-- grænse for, hvad rækken ændres TIL.
create policy matches_update_admin on public.matches
  for update to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- DELETE har hverken før eller nu en policy, så RLS afviser den for begge
-- klient-roller. Table-grant'en fjernes alligevel: RLS er ét lag, privilegier er
-- et andet, og et hul kræver at begge svigter.
revoke insert, update, delete, truncate on public.matches from anon;
revoke delete, truncate on public.matches from authenticated;
-- SELECT beholdes for anon med vilje: `read matches` afviser den allerede
-- (auth.role() = 'authenticated'), og at fjerne grant'en ville skifte fejlen fra
-- "tomt resultat" til "permission denied" for en klient uden session.

-- ============================================================================
-- G15 — recompute_ratings() lukkes for klient-roller
-- ============================================================================
-- FØR: `grant all on function public.recompute_ratings() to anon, ...`. Funktionen
-- er SECURITY DEFINER og havde — modsat hver eneste admin_*-funktion — intet
-- is_admin-tjek. Et `POST /rest/v1/rpc/recompute_ratings` med anon-nøglen fra
-- bundlen sletter og genopbygger hele ratings/rating_history fra runde nul: en
-- gratis, gentagelig DB-dækkende skrivning og CPU-forstærker.
--
-- EFTER: tre kaldere, tre veje ind — og ingen af dem er anon.
--
--   1. Rating-triggeren på `matches`. Trigger-funktionen gøres SECURITY DEFINER,
--      så den kan kalde motoren, uanset hvem der skrev resultatet. Uden det ville
--      admin-skrivningen ovenfor fejle på netop den revoke, vi lige har lavet.
--   2. Admin-skærmens "Opdater ratings". Den kalder nu wrapperen
--      admin_recompute_ratings() med sit eget is_admin-tjek — samme mønster som
--      admin_user_stats() og admin_job_health().
--   3. service_role (backend, SQL-editor). Uændret.
--
-- Motorens KROP røres bevidst ikke: den er frosset af ækvivalenstesten i
-- sql/tests/rating_equivalence.sql, og et adgangsproblem skal ikke koste en
-- ændring i en funktion, hvis tal er under test. Kun grant'en flyttes.

-- `from public` er IKKE overflødigt ved siden af de to navngivne roller: Postgres
-- giver som standard EXECUTE til pseudorollen PUBLIC på hver ny funktion, og den
-- arver anon og authenticated. Uden denne linje ville de to revokes nedenfor
-- ikke lukke noget som helst.
revoke execute on function public.recompute_ratings() from public;
revoke execute on function public.recompute_ratings() from anon;
revoke execute on function public.recompute_ratings() from authenticated;
grant execute on function public.recompute_ratings() to service_role;

-- Triggeren skal kunne kalde motoren, selv når skriveren er en admin i rollen
-- `authenticated`. Kroppen er uændret (se rating_trigger_optimization.sql) —
-- kun rettighedskonteksten skifter. `set search_path` hører med til enhver
-- SECURITY DEFINER-funktion; transition tables (new_rows/old_rows) og temp-
-- tabellen slås op uden om search_path, så de er upåvirkede.
alter function public.recompute_ratings_if_scores_changed() security definer;
alter function public.recompute_ratings_if_scores_changed() set search_path to 'public';

-- Admin-vejen ind. Wrapper frem for en guard inde i motoren, så motorens krop —
-- og dermed ækvivalenstesten — står urørt.
create or replace function public.admin_recompute_ratings()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Kun administratorer kan genberegne ratings';
  end if;
  perform public.recompute_ratings();
end;
$$;

revoke execute on function public.admin_recompute_ratings() from public;
revoke execute on function public.admin_recompute_ratings() from anon;
grant execute on function public.admin_recompute_ratings() to authenticated, service_role;

-- ============================================================================
-- G16 — monthly_standings holder op med at omgå RLS
-- ============================================================================
-- FØR: viewet blev oprettet uden `security_invoker` og kørte dermed med ejerens
-- rettigheder. Sammen med `grant select … to anon` kunne en UAUTENTIFICERET
-- kalder læse per-bruger månedspoint. `round_standings` og `season_standings`
-- sætter i forvejen `security_invoker = on` og returnerer derfor intet til anon;
-- at monthly manglede det, var en forglemmelse — kommentaren i
-- standings_tiebreakers.sql:33-37 siger kun, at DEN migrering ikke rørte
-- adgangsregler, ikke at fraværet var et valg.
--
-- INGEN ADFÆRDSÆNDRING FOR INDLOGGEDE BRUGERE, og det er selve grunden til, at
-- rettelsen er sikker: viewet tæller kun kampe med resultat (`home_score is not
-- null`), og `predictions_select_visible` gør præcis de tips synlige for enhver
-- authenticated bruger. De rækker, RLS nu filtrerer, er de samme rækker, viewet
-- alligevel ikke medtog. For anon findes der derimod slet ingen SELECT-policy på
-- predictions, så den vej giver nu nul rækker.
--
-- `alter view` frem for `drop`/`create`: definitionen bliver liggende ét sted
-- (tournament_scope.sql), så de to filer ikke kan drive fra hinanden.
alter view public.monthly_standings set (security_invoker = on);

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) matches: kun de to admin-policies tilbage, ingen bar authenticated-regel.
--    Forvent 2 rækker, begge med is_admin i udtrykket.
-- select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr,
--        pg_get_expr(polwithcheck, polrelid) as check_expr
-- from pg_policy where polrelid = 'public.matches'::regclass and polcmd <> 'r';

-- 2) matches: klient-rollerne har ingen skrive-privilegier tilbage.
--    Forvent 0 rækker.
-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_name = 'matches' and grantee in ('anon','authenticated')
--   and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');

-- 3) Funktions-grants. Forvent: recompute_ratings kun til service_role,
--    admin_recompute_ratings til authenticated + service_role.
-- select p.proname, p.prosecdef, coalesce(array_to_string(p.proacl, ', '), '(ejer only)')
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('recompute_ratings','admin_recompute_ratings','recompute_ratings_if_scores_changed');

-- 4) Alle tre stillings-views er nu invoker. Forvent tre gange `true`.
-- select c.relname, 'security_invoker=on' = any(c.reloptions) as invoker
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in ('round_standings','season_standings','monthly_standings');

-- 5) Røgtest i brugerfladen (kræver en rigtig session, jf. §11-tjeklisten):
--    Admin → Kampe → skriv et resultat (skal virke som admin, fejle for alle
--    andre), Admin → "Opdater ratings" (skal virke), Championship → Måned
--    (samme tal som før).

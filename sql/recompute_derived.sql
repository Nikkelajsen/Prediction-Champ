-- Samlet genberegning af de afledte rækker (G83).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- HVORFOR DEN FINDES
-- Appen har fem afledte størrelser — rating, historier, lokale kåringer,
-- milepæle og milepælenes kapring af dagskortet — og indtil august 2026 fandtes
-- der ingen samlet måde at regne dem om. Fem kald, i en rækkefølge, der ikke er
-- fri, og som kun stod skrevet i api/send-notifications.js og docs/CRON.md.
--
-- Det gjorde ondt ét bestemt sted: `docs/RESTORE.md` scenarie 1 foreskriver
-- `pg_restore --disable-triggers` — netop for at indlæsningen IKKE skal kalde
-- `recompute_ratings()` og `generate_stories()` midt i det hele — og sagde så
-- ikke, hvad man gør bagefter. Runbogen efterlod dermed en database, hvor
-- rækkerne var rigtige og alt det udledte forkert, uden at nævne det. Den
-- rettelse er én linje i runbogen, og denne fil er den linje.
--
-- RÆKKEFØLGEN ER IKKE FRI, og det er filens egentlige indhold:
--   1. rating          — alt andet læser `rating_history.rnk` og `ratings`.
--   2. historier       — bagstopperen skriver de dage og runder, der mangler.
--   3. kåringer        — pr. konkurrence med `mode_params.awards` (A22).
--   4. milepæle        — nogle af dem afhænger af, at kåringerne står der.
--   5. milepæls-kort   — SKAL stå efter 4: en milepæl kaprer dagens ene slot,
--      og kapringen kan ikke ske, før milepælen er uddelt.
-- Punkt 5 efter 4 er den samme bindende rækkefølge som i kaldelisten i
-- api/send-notifications.js. Står de forkert, sker der ikke en fejl — der sker
-- ingenting, og det opdages ikke.
--
-- HVAD DEN IKKE ER
-- Den er ikke et cron-job. Genberegningen er dyr (den sletter og genopbygger
-- hele `rating_history` fra runde nul), og den hører til efter en hændelse, ikke
-- hvert kvarter. Bagstopperen i drift er `sql/checks/rating_freshness.sql`, som
-- job-heartbeat.yml læser hver halve time og som SIGER, når denne fil skal
-- køres. Overvågning frem for gentagelse: det er en kontrol, ikke et arbejde.
--
-- HVEM MÅ KALDE DEN
-- Kun `service_role` og admin-wrapperen nedenfor. Funktionen er SECURITY
-- DEFINER og rører hele databasen — nøjagtig samme begrundelse som ved
-- `recompute_ratings()` (G15).

-- ---------------------------------------------------------------------------
-- recompute_derived()
-- ---------------------------------------------------------------------------
-- Returnerer én række pr. trin, så en kørsel kan LÆSES bagefter. Det er ikke
-- pynt: efter en gendannelse er spørgsmålet "kom historierne med?", og et
-- `void` ville have svaret med tavshed.
--
-- Hvert trin er pakket ind, så ét trin, der fejler, ikke tager resten med. En
-- gendannelse under pres skal have så meget som muligt tilbage, og et rødt trin
-- ved siden af fire grønne er en bedre besked end en fejl og ingen rating.

create or replace function public.recompute_derived()
returns table (trin text, resultat text, varighed interval)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  t0 timestamptz;
  v_n int;
  c record;
  v_awards int := 0;
  v_comps  int := 0;
begin
  -- ---------- 1. Rating ----------
  t0 := clock_timestamp();
  begin
    perform public.recompute_ratings();
    select count(*) into v_n from public.rating_history where scope = 'ALL';
    trin := 'rating'; resultat := v_n || ' rækker i rating_history';
  exception when others then
    trin := 'rating'; resultat := 'FEJLEDE: ' || sqlerrm;
  end;
  varighed := clock_timestamp() - t0; return next;

  -- ---------- 2. Historier ----------
  -- `p_grace => 0`: bagstopperen springer normalt de seneste to dage over,
  -- fordi en dag kan få flere resultater endnu. Efter en gendannelse er der
  -- ingen grund til at vente — de data, der findes, er dem, der kommer.
  t0 := clock_timestamp();
  begin
    select public.generate_stories_catchup(0) into v_n;
    trin := 'historier'; resultat := v_n || ' dage/runder efterfyldt';
  exception when others then
    trin := 'historier'; resultat := 'FEJLEDE: ' || sqlerrm;
  end;
  varighed := clock_timestamp() - t0; return next;

  -- ---------- 3. Lokale kåringer ----------
  -- Kun konkurrencer, der har slået dem til. Funktionen er lazy og ville ellers
  -- først skrive, når nogen åbnede boardet (B11).
  t0 := clock_timestamp();
  begin
    for c in
      select id from public.competitions
       where coalesce((mode_params->>'awards')::boolean, false)
       order by created_at
    loop
      v_comps := v_comps + 1;
      v_awards := v_awards + coalesce(public.award_competition_periods(c.id), 0);
    end loop;
    trin := 'kåringer'; resultat := v_awards || ' nye i ' || v_comps || ' konkurrencer';
  exception when others then
    trin := 'kåringer'; resultat := 'FEJLEDE: ' || sqlerrm;
  end;
  varighed := clock_timestamp() - t0; return next;

  -- ---------- 4. Milepæle ----------
  t0 := clock_timestamp();
  begin
    select public.award_milestones(null) into v_n;
    trin := 'milepæle'; resultat := v_n || ' nye';
  exception when others then
    trin := 'milepæle'; resultat := 'FEJLEDE: ' || sqlerrm;
  end;
  varighed := clock_timestamp() - t0; return next;

  -- ---------- 5. Milepæls-kort ----------
  -- SKAL stå efter 4. Se rækkefølgen i hovedet.
  t0 := clock_timestamp();
  begin
    select public.apply_milestone_stories() into v_n;
    trin := 'milepæls-kort'; resultat := v_n || ' dagskort kapret';
  exception when others then
    trin := 'milepæls-kort'; resultat := 'FEJLEDE: ' || sqlerrm;
  end;
  varighed := clock_timestamp() - t0; return next;
end;
$fn$;

revoke execute on function public.recompute_derived() from public, anon, authenticated;
grant execute on function public.recompute_derived() to service_role;

-- ---------------------------------------------------------------------------
-- admin_recompute_derived() — den samme, med et adgangstjek
-- ---------------------------------------------------------------------------
-- Samme mønster som `admin_recompute_ratings()` i sql/security_hardening.sql:
-- motoren er service_role-only, og mennesker kommer ind gennem en wrapper, der
-- spørger `is_admin` først. Findes for at gøre en gendannelse mulig fra
-- Supabase-editoren under en almindelig session — ikke fordi appen kalder den.

create or replace function public.admin_recompute_derived()
returns table (trin text, resultat text, varighed interval)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from public.recompute_derived();
end;
$fn$;

revoke execute on function public.admin_recompute_derived() from public, anon;
grant execute on function public.admin_recompute_derived() to authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Funktionerne findes. Forvent to rækker.
-- select proname from pg_proc where proname in ('recompute_derived', 'admin_recompute_derived');
--
-- 2) Kør den. Forvent fem rækker, ingen med 'FEJLEDE'.
-- select * from public.recompute_derived();
--
-- 3) Og kontrollen bagefter — den skal være grøn, når genberegningen er kørt.
--    (Kræver, at sql/checks/rating_freshness.sql er læst i samme session.)
-- select * from rating_freshness;

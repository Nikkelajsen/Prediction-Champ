-- ===========================================================================
-- 🔴 GENERERET FIL — REDIGÉR IKKE
--
-- Skrevet af .github/workflows/schema-export.yml (pg_dump --schema=public
-- --schema-only --no-owner) mod produktionsdatabasen. En håndredigering her
-- bliver TAVST overskrevet ved næste eksport: ingen fejl, ingen konflikt,
-- bare arbejde, der forsvinder. Skal skemaet ændres, skrives en migrering i
-- sql/ og køres i Supabases SQL-editor — se sql/README.md.
--
-- Skemaet ændrede sig sidst: 2026-08-17
--
-- DATOEN ER FILENS HOLDBARHED, ikke dens kørselsstempel. Den står stille,
-- når en eksport ikke fandt noget nyt, og siger dermed "skemaet er uændret
-- siden". Er en migrering kørt i produktionen EFTER den dato, er denne fil
-- bagud — og det er den tilstand, sql/checks/anon_routine_reach.sql findes
-- for at kunne se, fordi CI's egne vagter måler netop dette dump (G124).
-- =================== SLUT PÅ GENERERET HOVED ===================
--
-- PostgreSQL database dump
--

\restrict egxlvuOjOq4I3MvpanE20uVfwca4VWZSi7TVXdLlmlkBXfUg3uzcYZ74is0Lr5Z

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Ubuntu 17.11-1.pgdg24.04+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: _anonymize_account(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._anonymize_account(p_user_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_navn text;
  v_hex  int := 8;
begin
  if p_user_id is null then
    raise exception 'forbidden';
  end if;

  -- Allerede lukket: gør ingenting, men svar det samme, så kalderen kan gentage
  -- kaldet uden at skulle skelne.
  select display_name into v_navn from public.profiles
   where id = p_user_id and anonymized_at is not null;
  if found then
    return v_navn;
  end if;

  -- Navnet er unikt på lower(display_name) (profiles_display_name_lower_idx) og
  -- skal være 2–20 tegn (profiles_display_name_len). "Slettet bruger" kan
  -- derfor kun bruges ÉN gang. Otte hex-tegn af brugerens eget id giver 16 tegn
  -- og er unikt — men "unikt nok" er ikke godt nok, når fejlen ville ramme
  -- netop den, der har bedt om at forsvinde, så der forlænges ved kollision.
  loop
    v_navn := 'Slettet ' || left(replace(p_user_id::text, '-', ''), v_hex);
    exit when not exists (
      select 1 from public.profiles
      where lower(display_name) = lower(v_navn) and id <> p_user_id
    );
    v_hex := v_hex + 2;
    if v_hex > 12 then
      raise exception 'kunne ikke danne et ledigt pseudonym';
    end if;
  end loop;

  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.notification_log   where user_id = p_user_id;
  delete from public.stories            where user_id = p_user_id;
  delete from public.analytics_events   where user_id = p_user_id;
  delete from public.user_activity_days where user_id = p_user_id;

  update public.feedback set user_id = null where user_id = p_user_id;
  -- Kontoen soft-lukkes (auth.users-rækken består), så client_errors' egen
  -- `on delete set null` udløses aldrig — koblingen skal fjernes her.
  update public.client_errors set user_id = null where user_id = p_user_id;

  -- ---------------------------------------------------------------------
  -- Framelding fra det, der ikke er BEGYNDT (A25, 5. august 2026)
  -- ---------------------------------------------------------------------
  -- Alt andet her bevarer deltagelsen, og begrundelsen er vennernes historik:
  -- en fjernet række ville give en afsluttet konkurrence én deltager færre og
  -- kunne gøre en delt sejr udelt. Den begrundelse har en grænse. I en
  -- konkurrence, hvor ingen kamp er låst endnu, findes der ingen historik at
  -- beskytte — dér er pseudonymet ikke et spor af noget, der er sket, men en
  -- deltager, der aldrig kommer til at spille: deltagerantallet er forkert
  -- FREMADRETTET, og navnet står på listen hele sæsonen. Det er samme skel, som
  -- A30 traf for de globale lister; her er det bare skåret på konkurrencen frem
  -- for på listen.
  --
  -- TO BETINGELSER, og den anden vejer lige så meget som den første:
  --   (a) ingen af konkurrencens kampe er låst eller spillet. "Ikke begyndt"
  --       måles på KONKURRENCEN og ikke på brugerens egne tips: en deltager
  --       uden tips i en igangværende konkurrence står stadig i en stilling,
  --       de andre har set, og den må ikke kunne skrives om.
  --   (b) der er mindst én anden deltager tilbage. Er der ingen, er der heller
  --       ingen, pseudonymet generer — og frameldingen ville efterlade en
  --       konkurrence uden deltagere, altså en ny slags rod i stedet for den
  --       gamle.
  --
  -- Invarianten er urørt: `group_membership_invariant.sql` kræver deltager ⇒
  -- medlem, og der fjernes kun i deltager-enden. **Ligamedlemskabet håndteres
  -- lige nedenfor** (`A36`/`A37`, 7. august 2026) — indtil da blev det stående.
  --
  -- TIPPENE RØRES IKKE. Ét tip gælder i ALLE de konkurrencer, kampen indgår i,
  -- så en sletning her kunne flytte tal i en konkurrence, brugeren stadig ER
  -- med i. Tippene bliver stående og tæller uændret alle de andre steder,
  -- kampen indgår — de tæller bare ikke i den konkurrence, rækken lige er
  -- meldt af.
  delete from public.competition_participants cp
   where cp.user_id = p_user_id
     and not exists (
       select 1
       from public.competition_matches cm
       join public.matches m on m.id = cm.match_id
       where cm.competition_id = cp.competition_id
         and (
           public.match_locked(m.kickoff_at, m.kickoff_tbd)
           -- Bæltet til selen: et resultat uden en overskredet lås burde ikke
           -- kunne findes, men hvis det gør, ER konkurrencen begyndt.
           or m.home_score is not null
         )
     )
     and exists (
       select 1
       from public.competition_participants o
       where o.competition_id = cp.competition_id
         and o.user_id <> p_user_id
     );

  -- ---------------------------------------------------------------------
  -- Ligamedlemskabet: overdrag først, forlad derefter (A36 + A37)
  -- ---------------------------------------------------------------------
  -- To beslutninger, truffet 7. august 2026, og de hænger sammen:
  --   `A37` — admin overdrages til det ældste levende medlem.
  --   `A36` — den lukkede konto forlader ligaen.
  --
  -- **Rækkefølgen er ikke valgfri.** Overdragelsen skal ske FØR frameldingen,
  -- fordi den bruger den lukkede kontos egen `role = 'admin'` til at finde de
  -- ligaer, der skal have en ny administrator. Bytter man om, er oplysningen
  -- væk, og ligaen fryser præcis som `A37` beskriver.
  --
  -- **Hvorfor overdragelsen overhovedet er nødvendig.** Admin-rollen kan kun
  -- uddeles ÉN gang — af opretteren til sig selv ved oprettelsen — og der
  -- findes ingen UPDATE-policy på `group_members`, altså ingen forfremmelse.
  -- En lukket konto kan aldrig logge ind igen (`api/delete-account.js`
  -- soft-sletter `auth.users`). Uden overdragelsen kan `is_group_admin()`
  -- derfor aldrig blive sand for den liga igen: den kan hverken omdøbes,
  -- slettes, få fjernet en deltager eller få slettet en konkurrence.
  -- Aflæst i produktion 7. august 2026: fire rigtige ligaer, 5–9 medlemmer
  -- hver, og præcis én levende admin i hver af dem.
  --
  -- **"Ældste" = længst i ligaen** (`group_members.joined_at`), ikke ældste
  -- konto. Det er den aflæsning, der giver mening i et fællesskab: den, der
  -- har været med længst, er den, de andre kender. `user_id` bryder
  -- uafgjort, så to medlemmer med samme tidsstempel ikke gør resultatet
  -- afhængigt af rækkefølgen på disken.
  with mine as (
    -- Ligaer, hvor den lukkede konto ER administrator.
    select group_id
      from public.group_members
     where user_id = p_user_id and role = 'admin'
  ),
  arving as (
    select distinct on (m.group_id) m.group_id, m.user_id
      from public.group_members m
      join mine           on mine.group_id = m.group_id
      join public.profiles pr on pr.id = m.user_id
     where m.user_id <> p_user_id
       -- Kun en LEVENDE konto kan arve. Ellers flyttes problemet blot.
       and pr.anonymized_at is null
     order by m.group_id, m.joined_at, m.user_id
  )
  update public.group_members gm
     set role = 'admin'
    from arving a
   where gm.group_id = a.group_id
     and gm.user_id  = a.user_id;

  -- Frameldingen. **Guarden er invarianten og ikke en bekvemmelighed:**
  -- `group_membership_invariant.sql` kræver deltager ⇒ medlem, så
  -- medlemskabet må kun fjernes i de ligaer, hvor der ikke er en deltagelse
  -- tilbage. A25 ovenfor har netop fjernet dem, der ikke var begyndt — det,
  -- der står tilbage, er spillet historik, og dér BLIVER pseudonymet på
  -- listen. Det er samme skel som hele resten af funktionen: alt, der er
  -- sket, bevares.
  delete from public.group_members gm
   where gm.user_id = p_user_id
     and not exists (
       select 1
         from public.competition_participants cp
         join public.competitions c on c.id = cp.competition_id
        where cp.user_id = p_user_id
          and c.group_id = gm.group_id
     );

  -- Blev medlemskabet stående (historik i ligaen), må rollen ikke blive ved
  -- at være `admin`: en konto, der ikke kan logge ind, er ikke en
  -- administrator, og `league_admin_coverage` ville tælle den som en.
  update public.group_members
     set role = 'member'
   where user_id = p_user_id and role = 'admin';

  update public.profiles
     set display_name  = v_navn,
         anonymized_at = now(),
         is_admin      = false,
         last_seen_at  = null
   where id = p_user_id;

  return v_navn;
end $$;


--
-- Name: accept_invite(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_invite(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid    uuid := auth.uid();
  v_code   text := btrim(coalesce(p_code, ''));
  v_group  public.groups%rowtype;
  v_comp   public.competitions%rowtype;
  v_ny_liga boolean := false;
  v_rk      bigint  := 0;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_code = '' then
    return jsonb_build_object('kind', 'none');
  end if;

  select * into v_group from public.groups where invite_code = v_code;
  if found then
    insert into public.group_members (group_id, user_id, role)
    select v_group.id, v_uid, 'member'
     where not exists (select 1 from public.group_members
                        where group_id = v_group.id and user_id = v_uid);
    get diagnostics v_rk = row_count;
    v_ny_liga := v_rk > 0;
    return jsonb_build_object('kind', 'group', 'group_id', v_group.id, 'joined', v_ny_liga);
  end if;

  select * into v_comp from public.competitions where invite_code = v_code;
  if not found then
    return jsonb_build_object('kind', 'none');
  end if;

  -- Liga før konkurrence — men IKKE fordi triggeren ville afvise den modsatte
  -- rækkefølge (det gør den ikke; se filens hoved). Linjen er her for det ene
  -- tilfælde, triggeren ikke dækker: en bruger, der allerede ER deltager, men
  -- mangler medlemskabet. Der indsættes da ingen deltager-række, triggeren fyrer
  -- ikke, og `A8`s halve tilstand ville blive stående, hver gang brugeren
  -- forsøgte at rette den ved at bruge invitationen igen.
  if v_comp.group_id is not null then
    insert into public.group_members (group_id, user_id, role)
    select v_comp.group_id, v_uid, 'member'
     where not exists (select 1 from public.group_members
                        where group_id = v_comp.group_id and user_id = v_uid);
  end if;

  insert into public.competition_participants (competition_id, user_id)
  select v_comp.id, v_uid
   where not exists (select 1 from public.competition_participants
                      where competition_id = v_comp.id and user_id = v_uid);
  get diagnostics v_rk = row_count;

  return jsonb_build_object(
    'kind', 'competition',
    'competition_id', v_comp.id,
    'group_id', v_comp.group_id,
    'joined', v_rk > 0);
end;
$$;


--
-- Name: admin_analytics_engagement(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_engagement(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  result jsonb;
begin
  perform public.analytics_require_admin();

  select jsonb_build_object(
    'window_days', p_days,

    'events', (
      select coalesce(jsonb_object_agg(event_name, jsonb_build_object('count', c, 'users', u)), '{}'::jsonb)
      from (
        select event_name, count(*) as c, count(distinct user_id) as u
        from public.analytics_events
        where created_at >= now() - make_interval(days => p_days)
        group by event_name
      ) t
    ),

    -- "opened_league" dækker BÅDE liga-listen og én bestemt liga (metadata i
    -- klienten skelner via view: "list"/"detail") — Liga Views som ét tal er
    -- league_views_total; league_views_detail (group_id is not null) er den
    -- cut Liga Health-scoren faktisk bruger.
    'league_views_total',  (select count(*) from public.analytics_events
                             where event_name = 'opened_league' and created_at >= now() - make_interval(days => p_days)),
    'league_views_detail', (select count(*) from public.analytics_events
                             where event_name = 'opened_league' and group_id is not null and created_at >= now() - make_interval(days => p_days)),

    -- DELINGSFLADERNE (B37, august 2026). `events` ovenfor tæller hvert NAVN,
    -- og det er for groft: `story_shared` er ét navn med TRE afsendere, som kun
    -- kan skelnes på `metadata->>'from'`. Uden opdelingen kan man se AT der
    -- deles og ikke HVORFRA — altså ikke forskellen på "dagskortets del-knap
    -- bruges" og "nogen delte noget".
    --
    --   'frame:X'    rundekortet (v3's tap-through). X er framens NAVN —
    --                'ROUND_SUM' eller 'RATING', de to felter, der kan deles
    --   'day_card'   dagskortet (I25)
    --   'milestone'  milepælen på karriereprofilen
    --   (intet felt) rundekortet FØR v3 gav frames. Historiske rækker har
    --                ingen `from`, og de er alle rundekort — derfor falder
    --                `else` sammen med 'round' og ikke i en 'ukendt'-spand.
    --
    -- `standings_shared` (I22) er sit eget navn og kommer med her, fordi
    -- spørgsmålet "hvorfra deles der?" ikke kan besvares uden den fjerde flade.
    -- Den blandes IKKE ind i Story Engine-tallene; se hovedet i
    -- sql/analytics_standings_share.sql for hvorfor navnet er skilt ad.
    'shares', (
      with s as (
        select
          case
            when e.event_name = 'standings_shared' then 'standings'
            when e.metadata->>'from' = 'day_card'  then 'day_card'
            when e.metadata->>'from' = 'milestone' then 'milestone'
            else 'round'
          end as surface,
          e.user_id
        from public.analytics_events e
        where e.event_name in ('story_shared', 'standings_shared')
          and e.created_at >= now() - make_interval(days => p_days)
      )
      -- Tomt vindue giver `{}` og ikke `null`: klienten skelner mellem "nul
      -- delinger" (målt) og "nøglen mangler" (RPC'en er ikke gen-kørt), og de
      -- to må aldrig se ens ud.
      select coalesce(jsonb_object_agg(surface, jsonb_build_object('count', c, 'users', u)), '{}'::jsonb)
      from (select surface, count(*) as c, count(distinct user_id) as u from s group by surface) t
    ),

    'events_by_day', (
      select coalesce(jsonb_object_agg(event_name, series), '{}'::jsonb)
      from (
        select event_name, jsonb_agg(jsonb_build_object('day', day, 'count', c) order by day) as series
        from (
          select event_name, created_at::date as day, count(*) as c
          from public.analytics_events
          where event_name in ('opened_home', 'opened_tip', 'opened_league', 'opened_rating',
                                'opened_career', 'opened_standings', 'opened_championship', 'story_viewed')
            and created_at >= now() - make_interval(days => p_days)
          group by event_name, created_at::date
        ) d
        group by event_name
      ) e
    ),

    -- Push Notification Open Rate. "sent" kommer fra notification_log (ikke
    -- push_sent-events — den findes ikke, se sql/analytics_events.sql).
    -- notification_log claimes FØR web-push-kaldet (sql/push_notifications.sql
    -- + api/send-notifications.js), så en fejlet levering tæller stadig som
    -- sendt — raten er derfor et gulv, ikke et loft.
    'push', (
      with sent as (
        select split_part(key, ':', 1) as kind, count(*) as c
        from public.notification_log
        where sent_at >= now() - make_interval(days => p_days)
        group by 1
      ), opened as (
        select coalesce(metadata->>'kind', 'unknown') as kind, count(*) as c
        from public.analytics_events
        where event_name = 'push_opened' and created_at >= now() - make_interval(days => p_days)
        group by 1
      )
      select jsonb_build_object(
        'sent', coalesce((select sum(c) from sent), 0),
        'opened', coalesce((select sum(c) from opened), 0),
        'open_rate', case when coalesce((select sum(c) from sent), 0) = 0 then null
          else round(100.0 * coalesce((select sum(c) from opened), 0) / (select sum(c) from sent), 1) end,
        'by_kind', coalesce((
          select jsonb_agg(jsonb_build_object(
            'kind', s.kind, 'sent', s.c, 'opened', coalesce(o.c, 0),
            'pct', case when s.c = 0 then null else round(100.0 * coalesce(o.c, 0) / s.c, 1) end
          ) order by s.kind)
          from sent s left join opened o on o.kind = s.kind
        ), '[]'::jsonb),

        -- ---- Push-EFFEKT (juli 2026) ----
        -- Open rate siger, om beskeden blev åbnet. Den siger intet om, hvorvidt
        -- den VIRKEDE. Deadline-påmindelsen er produktets eneste aktive
        -- fastholdelses-værktøj, så det spørgsmål er værd at kunne svare på:
        -- tippede de, der åbnede den, oftere end de, der ikke gjorde?
        --
        -- Enheden er (bruger, senddag): én modtaget deadline-påmindelse. "Tippede"
        -- = mindst ét tip på en kamp, der låste efter beskeden og inden for syv
        -- dage, læst fra analytics_completion_facts — altså fra predictions, ikke
        -- fra loggen.
        --
        -- ⚠️ KORRELATION, IKKE ÅRSAG. Folk, der åbner notifikationer, er de
        -- engagerede i forvejen; forskellen er derfor et LOFT over pushets
        -- reelle effekt, ikke et estimat af den. Det står også i måle-ordbogen
        -- (src/lib/analyticsMetrics.js, `push_effect`), fordi det er den
        -- eneste måde, tallet kan læses forkert på.
        'effect', (
          with sent as (
            -- Nøglen er `deadline:<dato>` (se api/send-notifications.js). Efter A21
            -- er beskeden samlet pr. BRUGER PR. DAG i stedet for pr. runde, fordi en
            -- runde ikke længere har ét låsetidspunkt at varsle om. Enheden her er
            -- derfor (bruger, senddag).
            --
            -- ⚠️ SERIEN STARTER FORFRA 1. AUGUST 2026. Gamle rækker har formatet
            -- `deadline:<season_id>:<round_key>:<dato>`, hvis felt 2 er et uuid og
            -- ikke en dato — de falder derfor ud af regex-tjekket frem for at blive
            -- fejltolket. Det er med vilje: at parse dem ind ville blande to
            -- definitioner i samme kurve.
            select nl.user_id, split_part(nl.key, ':', 2)::date as sent_day, min(nl.sent_at) as sent_at
            from public.notification_log nl
            where nl.key like 'deadline:%'
              and nl.sent_at >= now() - make_interval(days => p_days)
              and split_part(nl.key, ':', 2) ~ '^\d{4}-\d{2}-\d{2}$'
            group by 1, 2
          ), opened as (
            -- push_opened bærer stadig et round_key i sin metadata (deep-linket
            -- peger på den runde, den første manglende kamp ligger i), men det kan
            -- ikke længere joines mod afsendelsen — dén kender kun dagen. Åbningen
            -- bindes derfor til dagen, den skete.
            select distinct e.user_id, e.created_at::date as sent_day
            from public.analytics_events e
            where e.event_name = 'push_opened'
              and e.metadata->>'kind' = 'deadline'
              and e.created_at >= now() - make_interval(days => p_days)
          ), followed as (
            -- De kampe, brugeren stadig kunne NÅ, da beskeden blev sendt: dem der
            -- låste efter sent_at. "Fulgte op" = tippede mindst én af dem. Vinduet
            -- på syv dage svarer til en spillerunde og forhindrer, at en besked får
            -- æren for et tip afgivet en uge senere.
            select s.user_id, s.sent_day,
              bool_or(f.predicted) as did_predict,
              min(f.lock_at)       as next_lock_at
            from sent s
            join public.analytics_completion_facts f
              on f.user_id = s.user_id
             and f.lock_at >  s.sent_at
             and f.lock_at <  s.sent_at + interval '7 days'
            group by 1, 2
          ), j as (
            select s.user_id, s.sent_day, s.sent_at, fw.next_lock_at,
              (o.user_id is not null)                as did_open,
              coalesce(fw.did_predict, false)        as did_predict,
              case
                when fw.next_lock_at is null then null
                when fw.next_lock_at - s.sent_at <  interval '3 hours'  then 1
                when fw.next_lock_at - s.sent_at <  interval '6 hours'  then 2
                when fw.next_lock_at - s.sent_at <  interval '12 hours' then 3
                when fw.next_lock_at - s.sent_at <  interval '24 hours' then 4
                else 5
              end as lead_bucket
            from sent s
            left join opened   o  on o.user_id  = s.user_id and o.sent_day = s.sent_day
            left join followed fw on fw.user_id = s.user_id and fw.sent_day = s.sent_day
          )
          select jsonb_build_object(
            'recipients', (select count(*) from j),
            'opened_n',       (select count(*) from j where did_open),
            'opened_pred',    (select count(*) from j where did_open and did_predict),
            'opened_rate',    (select case when count(*) = 0 then null
                                 else round(100.0 * count(*) filter (where did_predict) / count(*), 1) end
                               from j where did_open),
            'not_opened_n',    (select count(*) from j where not did_open),
            'not_opened_pred', (select count(*) from j where not did_open and did_predict),
            'not_opened_rate', (select case when count(*) = 0 then null
                                 else round(100.0 * count(*) filter (where did_predict) / count(*), 1) end
                               from j where not did_open),
            -- Varsel: hvor lang tid før den FØRSTE lås, brugeren stadig kunne nå,
            -- blev beskeden sendt. Den eneste knap, der reelt kan drejes på —
            -- cron-tidspunktet.
            'by_lead_time', coalesce((
              select jsonb_agg(jsonb_build_object(
                'bucket', bucket, 'sort', sort, 'n', n, 'predicted', pred,
                'rate', case when n = 0 then null else round(100.0 * pred / n, 1) end
              ) order by sort)
              from (
                select
                  coalesce(lead_bucket, 0) as sort,
                  case coalesce(lead_bucket, 0)
                    when 0 then 'ukendt' when 1 then 'under 3 t' when 2 then '3-6 t'
                    when 3 then '6-12 t' when 4 then '12-24 t'  else 'over 24 t' end as bucket,
                  count(*) as n, count(*) filter (where did_predict) as pred
                from j group by 1, 2
              ) b
            ), '[]'::jsonb)
          )
        )
      )
    ),

    -- Gennemsnitlig sessionstid: sessionisering med 30-minutters inaktivitets-
    -- grænse (SESSION_GAP — den ene tunbare konstant i denne RPC, samme
    -- ånd som vægtene i admin_analytics_league_health nedenfor). En sessions
    -- varighed er FØRSTE hændelse → SIDSTE hændelse, så en session med kun
    -- ét event måler 0 sekunder — gennemsnittet er derfor en NEDRE grænse.
    -- avg_seconds_multi og medianen findes, så tallet kan læses ærligt.
    'session', (
      with e as (
        select user_id, created_at,
               lag(created_at) over (partition by user_id order by created_at) as prev
        from public.analytics_events
        where created_at >= now() - make_interval(days => p_days)
      ), marked as (
        select user_id, created_at,
               case when prev is null or created_at - prev > interval '30 minutes' then 1 else 0 end as is_new
        from e
      ), numbered as (
        select user_id, created_at,
               sum(is_new) over (partition by user_id order by created_at rows between unbounded preceding and current row) as sid
        from marked
      ), sessions as (
        select user_id, sid, min(created_at) as t0, max(created_at) as t1, count(*) as n
        from numbered group by 1, 2
      )
      select jsonb_build_object(
        'sessions', (select count(*) from sessions),
        'avg_seconds', (select coalesce(round(avg(extract(epoch from (t1 - t0)))), 0) from sessions),
        'avg_seconds_multi', (select coalesce(round(avg(extract(epoch from (t1 - t0)))), 0) from sessions where n > 1),
        'median_seconds', (select coalesce(round(percentile_cont(0.5) within group (order by extract(epoch from (t1 - t0)))), 0) from sessions),
        'avg_events', (select coalesce(round(avg(n), 1), 0) from sessions)
      )
    )
  ) into result;

  return result;
end;
$_$;


--
-- Name: admin_analytics_funnel(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_funnel(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  perform public.analytics_require_admin();

  with base as (
    select
      p.id as user_id,
      p.created_at,
      (select min(gm.joined_at) from public.group_members gm where gm.user_id = p.id) as league_at,
      (select min(cp.joined_at) from public.competition_participants cp where cp.user_id = p.id) as competition_at,
      (select min(pr.updated_at) from public.predictions pr where pr.user_id = p.id) as prediction_at,
      -- SELVSTARTER ELLER INVITERET afgøres af den FØRSTE liga, brugeren kom
      -- med i: oprettede de den selv, eller trådte de ind i en andens?
      -- En bruger UDEN liga regnes som selvstarter: A8-invarianten indmelder
      -- automatisk i ligaen i samme øjeblik, en invitation accepteres, så
      -- ingen liga betyder, at der aldrig blev accepteret en invitation.
      coalesce((
        select g.created_by = p.id
        from public.group_members gm
        join public.groups g on g.id = gm.group_id
        where gm.user_id = p.id
        order by gm.joined_at asc, g.id asc
        limit 1
      ), true) as is_selfstarter
    from public.profiles p
    where p.created_at is not null
  ),
  labelled as (
    select b.*,
      case when b.is_selfstarter then 'selvstarter' else 'inviteret' end as path,
      -- STALL-PARTITIONEN: hvor står brugeren NU. Modsat trin-tællingerne
      -- nedenfor er disse fire gensidigt udelukkende og dækker hele kohorten,
      -- så "hvor mister vi dem" har præcis ét svar pr. bruger.
      case
        when b.prediction_at  is not null then 'gennemfoert'
        when b.competition_at is not null then 'uden_tip'
        when b.league_at      is not null then 'uden_konkurrence'
        else 'uden_liga'
      end as stalled_at
    from base b
  ),
  scopes as (select 'window' as scope union all select 'all_time' as scope),
  tagged as (
    select s.scope, l.*
    from labelled l cross join scopes s
    where s.scope = 'all_time' or l.created_at >= now() - make_interval(days => p_days)
  ),
  -- grouping sets giver både totalen (path = null) og opdelingen i ét pass.
  agg as (
    select
      scope,
      path,
      count(*)                                                as cohort,
      count(*) filter (where league_at      is not null)      as reached_league,
      count(*) filter (where competition_at is not null)      as reached_competition,
      count(*) filter (where prediction_at  is not null)      as reached_prediction,
      count(*) filter (where stalled_at = 'uden_liga')        as stalled_uden_liga,
      count(*) filter (where stalled_at = 'uden_konkurrence') as stalled_uden_konkurrence,
      count(*) filter (where stalled_at = 'uden_tip')         as stalled_uden_tip,
      count(*) filter (where stalled_at = 'gennemfoert')      as stalled_gennemfoert,
      round(percentile_cont(0.5) within group (
        order by extract(epoch from (league_at - created_at)) / 60)::numeric, 1)      as median_min_league,
      round(percentile_cont(0.5) within group (
        order by extract(epoch from (competition_at - created_at)) / 60)::numeric, 1) as median_min_competition,
      round(percentile_cont(0.5) within group (
        order by extract(epoch from (prediction_at - created_at)) / 60)::numeric, 1)  as median_min_prediction
    from tagged
    group by grouping sets ((scope), (scope, path))
  )
  select jsonb_build_object(
    'window_days', p_days,
    'rows', coalesce(jsonb_agg(to_jsonb(a) order by a.scope, a.path nulls first), '[]'::jsonb)
  ) into result
  from agg a;

  return result;
end;
$$;


--
-- Name: admin_analytics_health(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_health(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
  today date := (now() at time zone 'utc')::date;
begin
  perform public.analytics_require_admin();

  select jsonb_build_object(
    'window_days', p_days,

    'active_users_7d',  (select count(distinct user_id) from public.user_activity_days where day >= today - 6),
    'active_users_30d', (select count(distinct user_id) from public.user_activity_days where day >= today - 29),

    'groups_total', (select count(*) from public.groups),
    -- En liga er "aktiv", når nogen faktisk har TIPPET i den for nylig —
    -- ikke blot åbnet appen. groups_with_active_member (nedenfor) er den
    -- svagere version, og gabet mellem de to er selv interessant ("ligaer
    -- hvor folk kigger forbi, men ingen spiller").
    'active_groups', (
      select count(distinct c.group_id)
      from public.predictions p
      join public.matches m on m.id = p.match_id
      join public.competition_matches cm on cm.match_id = m.id
      join public.competitions c on c.id = cm.competition_id
      where c.group_id is not null
        and p.updated_at >= now() - make_interval(days => p_days)
    ),
    -- VINDUE (rettet juli 2026): dag-granulære vinduer er `today - (p_days-1)`,
    -- så p_days = 30 betyder 30 kalenderdage inkl. i dag — ikke 31. Før talte
    -- dette felt (og deadline_miss' nævner) én dag mere end de tidsstempel-
    -- baserede felter i samme svar, så to tal i samme sektion målte over hver
    -- sin periode uden at sige det.
    'groups_with_active_member', (
      select count(distinct gm.group_id)
      from public.group_members gm
      join public.user_activity_days d on d.user_id = gm.user_id
      where d.day >= today - (p_days - 1)
    ),

    'competitions_total', (select count(*) from public.competitions),
    'active_competitions', (
      select count(distinct cm.competition_id)
      from public.predictions p
      join public.matches m on m.id = p.match_id
      join public.competition_matches cm on cm.match_id = m.id
      where p.updated_at >= now() - make_interval(days => p_days)
    ),
    -- "Aktiv" og "i gang" er bevidst to forskellige tal: en konkurrence kan
    -- have masser af historisk aktivitet uden at have en eneste ulåst runde
    -- tilbage (sæsonen er slut), og omvendt en helt ny konkurrence uden
    -- aktivitet endnu, men med ulåste runder foran sig.
    'live_competitions', (
      select count(distinct cm.competition_id)
      from public.competition_matches cm
      join public.matches m on m.id = cm.match_id
      join public.analytics_round_locks rl
        on rl.season_id is not distinct from m.season_id and rl.round_key = m.round_key
      where not rl.has_started
    ),

    -- Prediction Completion Rate (North Star) — se analytics_completion_facts
    -- for definitionen af "mulige tips" og grain-reglen.
    'completion_rate', (
      select case when count(*) = 0 then null
        else round(100.0 * count(*) filter (where predicted) / count(*), 1) end
      from (
        select distinct user_id, match_id, predicted
        from public.analytics_completion_facts
        where lock_at >= now() - make_interval(days => p_days)
      ) t
    ),
    'completion_slots', (
      select count(*) from (
        select distinct user_id, match_id
        from public.analytics_completion_facts
        where lock_at >= now() - make_interval(days => p_days)
      ) t
    ),
    'completion_done', (
      select count(*) from (
        select distinct user_id, match_id
        from public.analytics_completion_facts
        where lock_at >= now() - make_interval(days => p_days) and predicted
      ) t
    ),
    'completion_rate_all_time', (
      select case when count(*) = 0 then null
        else round(100.0 * count(*) filter (where predicted) / count(*), 1) end
      from (select distinct user_id, match_id, predicted from public.analytics_completion_facts) t
    ),
    -- Det FOREGÅENDE lige så lange vindue, så headline-tallet kan vises med en
    -- retning. Et dashboard uden retning kan sige "62 %", men ikke om 62 % er
    -- på vej op eller ned — og retningen er det eneste, en beslutning kan
    -- hænge på. Nøglen er null, når det foregående vindue ikke havde nok
    -- mulige tips (< MIN_SLOTS_FOR_TREND) at sammenligne med; UI'et skjuler
    -- pilen i det tilfælde i stedet for at kalde støj for et fald.
    'completion_rate_prev', (
      select case when count(*) < 5 then null
        else round(100.0 * count(*) filter (where predicted) / count(*), 1) end
      from (
        select distinct user_id, match_id, predicted
        from public.analytics_completion_facts
        where lock_at >= now() - make_interval(days => 2 * p_days)
          and lock_at <  now() - make_interval(days => p_days)
      ) t
    ),
    'completion_by_week', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'week', week, 'slots', slots, 'done', done,
        'pct', case when slots = 0 then null else round(100.0 * done / slots, 1) end
      ) order by week), '[]'::jsonb)
      from (
        select week, count(*) as slots, count(*) filter (where predicted) as done
        from (
          select distinct week, user_id, match_id, predicted
          from public.analytics_completion_facts
          where week >= today - 84 -- seneste ~12 uger
        ) t
        group by week
      ) w
    ),
    'completion_by_month', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', month, 'slots', slots, 'done', done,
        'pct', case when slots = 0 then null else round(100.0 * done / slots, 1) end
      ) order by month), '[]'::jsonb)
      from (
        select month, count(*) as slots, count(*) filter (where predicted) as done
        from (
          select distinct month, user_id, match_id, predicted
          from public.analytics_completion_facts
          where month >= to_char(today - interval '6 months', 'YYYY-MM')
        ) t
        group by month
      ) mth
    ),

    -- Deadline Miss Rate. Enheden er fortsat RUNDEN, men af en ny grund. Før A21
    -- var runden dér, låsen og deadline-push'en var forankret; efter A21 låser
    -- hver kamp for sig, og påmindelsen samles pr. dag. Runden er nu valgt, fordi
    -- den er den enhed, SPØRGSMÅLET har: "sad en bruger en spillerunde over?".
    -- Alternativet — at tælle hver ubesvaret kamp — er allerede dækket af
    -- Completion Rate, og ville gøre de to metrikker til det samme tal.
    -- En bruger "missede deadline i runde R", hvis de havde ≥1 muligt tip i R og
    -- NUL af dem blev afgivet — en bruger der tippede 3 af 5 kampe missede IKKE
    -- deadline. Tre tal returneres:
    -- miss_rate (brugerens godkendte formel: missede / AKTIVE brugere,
    -- headline), miss_rate_of_exposed (missede / brugere der reelt HAVDE en
    -- deadline — forhindrer at raten falder kunstigt, når brugerbasen vokser
    -- med folk uden konkurrencer) og round_miss_rate (volumen i runder).
    'deadline_miss', (
      with rounds as (
        select user_id, season_id, round_key, bool_or(predicted) as any_predicted
        from public.analytics_completion_facts
        where lock_at >= now() - make_interval(days => p_days)
        group by 1, 2, 3
      ), active as (
        select count(distinct user_id) as n from public.user_activity_days where day >= today - (p_days - 1)
      )
      select jsonb_build_object(
        'rounds_missed', (select count(*) filter (where not any_predicted) from rounds),
        'rounds_with_deadline', (select count(*) from rounds),
        'round_miss_rate', (select case when count(*) = 0 then null
          else round(100.0 * count(*) filter (where not any_predicted) / count(*), 1) end from rounds),
        'users_missed', (select count(distinct user_id) filter (where not any_predicted) from rounds),
        'users_with_deadline', (select count(distinct user_id) from rounds),
        'active_users', (select n from active),
        'miss_rate', (select case when (select n from active) = 0 then null
          else round(100.0 * (select count(distinct user_id) filter (where not any_predicted) from rounds) / (select n from active), 1) end),
        'miss_rate_of_exposed', (select case when (select count(distinct user_id) from rounds) = 0 then null
          else round(100.0 * (select count(distinct user_id) filter (where not any_predicted) from rounds) / (select count(distinct user_id) from rounds), 1) end)
      )
    ),

    -- Gennemførte spillerunder: kun runder der faktisk indgår i mindst én
    -- konkurrence (ikke blot Sportmonks-runder ingen tipper på), og hvor
    -- ALLE kampe har resultat. BEMÆRK: dette tal er ALT-TID, ikke p_days —
    -- derfor står "(alt tid)" i UI-etiketten, så det ikke læses som om
    -- vinduesvælgeren gælder det.
    'rounds_completed', (
      select count(*) from public.analytics_round_locks rl
      where rl.finished_count = rl.match_count
        and exists (
          select 1 from public.competition_matches cm
          join public.matches m on m.id = cm.match_id
          where m.season_id is not distinct from rl.season_id and m.round_key = rl.round_key
        )
    ),
    'rounds_completed_by_week', (
      select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'count', c) order by wk), '[]'::jsonb)
      from (
        select date_trunc('week', rl.first_kickoff)::date as wk, count(*) as c
        from public.analytics_round_locks rl
        where rl.finished_count = rl.match_count
          and exists (
            select 1 from public.competition_matches cm
            join public.matches m on m.id = cm.match_id
            where m.season_id is not distinct from rl.season_id and m.round_key = rl.round_key
          )
          and rl.first_kickoff >= now() - interval '12 weeks'
        group by 1
      ) r
    )
  ) into result;

  return result;
end;
$$;


--
-- Name: admin_analytics_league_health(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_league_health(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  perform public.analytics_require_admin();

  with k as (
    select
      28 as retention_min_age_days,   -- medlem skal have været med så længe …
      14 as retention_window_days     -- … og været aktiv inden for så længe
  ),
  win as (
    select
      now() - make_interval(days => p_days)     as t0,
      now() - make_interval(days => 2 * p_days) as t0_prev,
      (now() at time zone 'utc')::date - (p_days - 1) as d0
  ),
  -- GRAIN-REGLEN: ét tip kan ligge i flere konkurrencer i samme liga (delt
  -- predictions-tabel), så alt herunder tælles på distinct (group, user, match).
  -- `predicted` afhænger kun af (user, match) og duplikerer derfor ikke rækken.
  facts as (
    select distinct f.group_id, f.user_id, f.match_id, f.season_id, f.round_key, f.predicted
    from public.analytics_completion_facts f cross join win w
    where f.group_id is not null and f.lock_at >= w.t0
  ),
  facts_prev as (
    select distinct f.group_id, f.user_id, f.match_id, f.predicted
    from public.analytics_completion_facts f cross join win w
    where f.group_id is not null and f.lock_at >= w.t0_prev and f.lock_at < w.t0
  ),
  participation as (
    select group_id,
      count(*)                                                    as slots,
      count(*) filter (where predicted)                           as done,
      -- BREDDE: hvor mange forskellige medlemmer der faktisk tippede. Det
      -- signal v1 manglede helt: "andel aktive medlemmer" målte, om folk
      -- ÅBNEDE appen, ikke om de spillede. En liga hvor én tipper alt og fire
      -- kigger på, og en liga hvor alle fem tipper, kunne få samme score.
      count(distinct user_id) filter (where predicted)             as predictors,
      count(distinct user_id)                                      as exposed_members,
      -- PULS: spillede runder ÷ runder der var noget at spille i.
      count(distinct (season_id, round_key))                       as rounds_available,
      count(distinct (season_id, round_key)) filter (where predicted) as rounds_played
    from facts group by group_id
  ),
  participation_prev as (
    select group_id, count(*) as slots, count(*) filter (where predicted) as done
    from facts_prev group by group_id
  ),
  -- KONCENTRATION: den mest aktive tippers andel af ligaens afgivne tips.
  -- Høj koncentration + få tippere = ligaen bæres af én person, det klassiske
  -- vennegruppe-sammenbrud. Diagnosen bruger `predictors`; dette tal er
  -- nuancen i drill-in'en.
  concentration as (
    select group_id, max(n) as top_n, sum(n) as total_n
    from (select group_id, user_id, count(*) as n from facts where predicted group by 1, 2) t
    group by group_id
  ),
  member_counts as (
    select group_id, count(*) as members from public.group_members group by group_id
  ),
  -- Følger nu p_days. FØR var denne CTE hårdkodet til 30 dage, mens etiketten
  -- fulgte vinduesvælgeren: valgte man "7 dage", viste kolonnen stadig 30
  -- dages tal uden at sige det.
  active_members as (
    select gm.group_id, count(distinct gm.user_id) as n
    from public.group_members gm
    join public.user_activity_days d on d.user_id = gm.user_id
    cross join win w
    where d.day >= w.d0
    group by gm.group_id
  ),
  retention_eligible as (
    select gm.group_id,
      count(*) as eligible,
      count(*) filter (where exists (
        select 1 from public.user_activity_days d
        where d.user_id = gm.user_id
          and d.day >= (now() at time zone 'utc')::date - (select retention_window_days from k)
      )) as retained
    from public.group_members gm
    where gm.joined_at <= now() - make_interval(days => (select retention_min_age_days from k))
    group by gm.group_id
  ),
  story_views as (
    select e.group_id, count(*) as views
    from public.analytics_events e cross join win w
    where e.event_name = 'story_viewed' and e.group_id is not null and e.created_at >= w.t0
    group by e.group_id
  ),
  last_activity as (
    select g.id as group_id, greatest(
      (select max(d.day)::timestamptz from public.group_members gm
        join public.user_activity_days d on d.user_id = gm.user_id where gm.group_id = g.id),
      (select max(p2.updated_at) from public.competitions c
        join public.competition_matches cm on cm.competition_id = c.id
        join public.predictions p2 on p2.match_id = cm.match_id
        where c.group_id = g.id),
      (select max(e.created_at) from public.analytics_events e where e.group_id = g.id)
    ) as last_activity_at
    from public.groups g
  ),
  signals as (
    select
      g.id as group_id, g.name, g.created_at,
      floor(extract(epoch from (now() - g.created_at)) / 86400)::int as age_days,
      coalesce(mc.members, 0)                as members,
      coalesce(am.n, 0)                      as active_members,
      coalesce(pa.predictors, 0)             as predictors,
      coalesce(pa.exposed_members, 0)        as exposed_members,
      coalesce(pa.slots, 0)                  as completion_slots,
      coalesce(pa.done, 0)                   as completion_done,
      coalesce(pa.rounds_available, 0)       as rounds_available,
      coalesce(pa.rounds_played, 0)          as rounds_played,
      coalesce(sv.views, 0)                  as story_views,
      la.last_activity_at,
      case when la.last_activity_at is null then null
        else floor(extract(epoch from (now() - la.last_activity_at)) / 86400)::int end as days_since_activity,
      (select count(*) from public.competitions c where c.group_id = g.id) as competitions_total,
      (select count(distinct cm.competition_id) from public.competitions c
        join public.competition_matches cm on cm.competition_id = c.id
        join public.matches m on m.id = cm.match_id
        join public.analytics_round_locks rl on rl.season_id is not distinct from m.season_id and rl.round_key = m.round_key
        where c.group_id = g.id and not rl.has_started) as competitions_active,
      case when coalesce(pa.slots, 0) = 0 then null
        else round(100.0 * pa.done / pa.slots, 1) end as completion_rate,
      -- Trend-nøglen er null, når det foregående vindue havde under 5 mulige
      -- tips: en enkelt kamp mere eller mindre må ikke kunne læses som "faldende".
      case when coalesce(pp.slots, 0) < 5 then null
        else round(100.0 * pp.done / pp.slots, 1) end as completion_rate_prev,
      case when coalesce(mc.members, 0) = 0 then null
        else round(100.0 * coalesce(pa.predictors, 0) / mc.members, 1) end as predictor_share,
      case when coalesce(mc.members, 0) = 0 then null
        else round(100.0 * coalesce(am.n, 0) / mc.members, 1) end as active_share,
      case when coalesce(pa.rounds_available, 0) = 0 then null
        else round(100.0 * pa.rounds_played / pa.rounds_available, 1) end as pulse,
      case when coalesce(cn.total_n, 0) = 0 then null
        else round(100.0 * cn.top_n / cn.total_n, 1) end as top_predictor_share,
      re.eligible as retention_eligible,
      re.retained as retention_retained,
      case when coalesce(re.eligible, 0) = 0 then null
        else round(100.0 * re.retained / re.eligible, 1) end as retention_rate
    from public.groups g
    left join member_counts       mc on mc.group_id = g.id
    left join active_members      am on am.group_id = g.id
    left join participation       pa on pa.group_id = g.id
    left join participation_prev  pp on pp.group_id = g.id
    left join concentration       cn on cn.group_id = g.id
    left join retention_eligible  re on re.group_id = g.id
    left join story_views         sv on sv.group_id = g.id
    left join last_activity       la on la.group_id = g.id
  )
  select jsonb_build_object(
    'window_days', p_days,
    'retention_min_age_days', (select retention_min_age_days from k),
    'retention_window_days', (select retention_window_days from k),
    -- Usorteret bevidst: rækkefølgen bestemmes af diagnosens alvor i
    -- klienten (diagnoseLeague), som er det eneste sted, alvor er defineret.
    'leagues', coalesce(jsonb_agg(to_jsonb(s) order by s.name), '[]'::jsonb)
  ) into result
  from signals s;

  return result;
end;
$$;


--
-- Name: admin_analytics_retention(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_retention() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
  v_activity_since date;
begin
  perform public.analytics_require_admin();
  select min(day) into v_activity_since from public.user_activity_days;

  with milestones as (
    select unnest(array[1, 4, 12, 26, 52]) as wk
  ),
  user_ret as (
    select m.wk,
      count(*) as eligible,
      count(*) filter (where exists (
        select 1 from public.user_activity_days d
        where d.user_id = p.id
          and d.day >= (p.created_at + make_interval(weeks => m.wk))::date
          and d.day <  (p.created_at + make_interval(weeks => m.wk + 1))::date
      )) as retained
    from public.profiles p
    cross join milestones m
    where p.created_at is not null
      and p.created_at + make_interval(weeks => m.wk + 1) <= now()
    group by m.wk
  ),
  -- Sidste 12 ugentlige kohorter × 5 milepæle, så én dårlig uge er synlig i
  -- stedet for at blive udjævnet af det samlede gennemsnit ovenfor.
  user_cohorts as (
    select date_trunc('week', p.created_at)::date as cohort_week, m.wk,
      count(*) as eligible,
      count(*) filter (where exists (
        select 1 from public.user_activity_days d
        where d.user_id = p.id
          and d.day >= (p.created_at + make_interval(weeks => m.wk))::date
          and d.day <  (p.created_at + make_interval(weeks => m.wk + 1))::date
      )) as retained
    from public.profiles p
    cross join milestones m
    where p.created_at is not null
      and p.created_at + make_interval(weeks => m.wk + 1) <= now()
      and p.created_at >= now() - interval '12 weeks'
    group by 1, m.wk
  ),
  -- Liga-retention: en liga tælles som "i live" ved milepæl N, hvis et
  -- NUVÆRENDE medlem enten har en aktivitetsdag eller afgav et tip i vinduet
  -- [created_at+N uger, created_at+(N+1) uger). Bevidst tilnærmelse:
  -- medlemskab evalueres som det ser ud NU, ikke som det så ud dengang
  -- (leavere er væk) — acceptabelt for et liga-niveau livstegn, og billigere
  -- end at rekonstruere historisk medlemskab.
  league_ret as (
    select m.wk,
      count(*) as eligible,
      count(*) filter (where
        exists (
          select 1 from public.group_members gm
          join public.user_activity_days d on d.user_id = gm.user_id
          where gm.group_id = g.id
            and d.day >= (g.created_at + make_interval(weeks => m.wk))::date
            and d.day <  (g.created_at + make_interval(weeks => m.wk + 1))::date
        )
        or exists (
          select 1 from public.competitions c
          join public.competition_matches cm on cm.competition_id = c.id
          join public.predictions p2 on p2.match_id = cm.match_id
          where c.group_id = g.id
            and p2.updated_at >= (g.created_at + make_interval(weeks => m.wk))
            and p2.updated_at <  (g.created_at + make_interval(weeks => m.wk + 1))
        )
      ) as retained
    from public.groups g
    cross join milestones m
    where g.created_at + make_interval(weeks => m.wk + 1) <= now()
    group by m.wk
  )
  select jsonb_build_object(
    'activity_since', v_activity_since,
    'user_retention', coalesce((
      select jsonb_agg(jsonb_build_object('week', wk, 'eligible', eligible, 'retained', retained,
        'pct', case when eligible = 0 then null else round(100.0 * retained / eligible, 1) end) order by wk)
      from user_ret
    ), '[]'::jsonb),
    'user_cohorts', coalesce((
      select jsonb_agg(jsonb_build_object('cohort_week', cohort_week, 'week', wk, 'eligible', eligible, 'retained', retained,
        'pct', case when eligible = 0 then null else round(100.0 * retained / eligible, 1) end) order by cohort_week, wk)
      from user_cohorts
    ), '[]'::jsonb),
    'league_retention', coalesce((
      select jsonb_agg(jsonb_build_object('week', wk, 'eligible', eligible, 'retained', retained,
        'pct', case when eligible = 0 then null else round(100.0 * retained / eligible, 1) end) order by wk)
      from league_ret
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;


--
-- Name: admin_analytics_rounds(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_rounds(p_rounds integer DEFAULT 12) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
  -- Klampet som `&hours=` i api/send-notifications.js: et vindue er en
  -- oplysning fra klienten, ikke en tillid.
  n int := least(greatest(coalesce(p_rounds, 12), 1), 52);
begin
  perform public.analytics_require_admin();

  with base as (
    -- Kun runder, der indgår i mindst én konkurrence — samme afgrænsning som
    -- rounds_completed. En Sportmonks-runde, ingen tipper på, er ikke en runde,
    -- nogen kunne have været aktiv i.
    select
      rl.round_key,
      min(rl.kickoff_at)                     as first_kickoff,
      max(rl.kickoff_at)                     as last_kickoff,
      count(*)                               as match_count,
      count(*) filter (where rl.is_locked)   as locked_count,
      count(*) filter (where m.home_score is not null and m.away_score is not null) as finished_count
    from public.analytics_match_locks rl
    join public.matches m on m.id = rl.match_id
    where exists (select 1 from public.competition_matches cm where cm.match_id = rl.match_id)
    group by rl.round_key
  ),
  -- `locked_count > 0`: runden er gået i gang. En runde, hvor intet er låst
  -- endnu, har ingen mulige tips og ville tegne en tom søjle i fremtiden.
  win as (
    select * from base where locked_count > 0 order by round_key desc limit n
  ),
  floor_key as (select min(round_key) as k from win),
  facts as (
    select f.round_key, f.user_id, bool_or(f.predicted) as any_predicted
    from public.analytics_completion_facts f
    where f.round_key >= (select k from floor_key)
    group by 1, 2
  ),
  per_round as (
    select round_key,
           count(*)                              as exposed,
           count(*) filter (where any_predicted) as players
    from facts group by 1
  ),
  -- Volumen: distinkte (bruger, kamp) — grain-reglen fra
  -- analytics_completion_facts. Uden `distinct` tælles ét tip én gang pr.
  -- konkurrence, kampen indgår i.
  tips as (
    select round_key, count(*) as tips
    from (
      select distinct f.round_key, f.user_id, f.match_id
      from public.analytics_completion_facts f
      where f.predicted and f.round_key >= (select k from floor_key)
    ) t
    group by 1
  ),
  -- Første runde, brugeren nogensinde SPILLEDE — over hele historikken og ikke
  -- kun vinduet. Læses opgørelsen inden for vinduet, ville enhver, der ikke var
  -- med i vinduets første runde, tælle som ny hver eneste gang vinduet flyttes.
  -- Det koster en fuld gennemløbning af viewet, præcis som
  -- completion_rate_all_time i RPC 1.
  debut as (
    select user_id, min(round_key) as first_round
    from public.analytics_completion_facts
    where predicted
    group by 1
  ),
  newcomers as (
    select d.first_round as round_key, count(*) as new_players
    from debut d
    where d.first_round >= (select k from floor_key)
    group by 1
  ),
  -- Rundens uge er [round_key, round_key + 7). round_key er tirsdag i DANSK
  -- tid, mens user_activity_days.day er en UTC-dato — et besøg mellem midnat
  -- og 02.00 dansk tid falder derfor i den foregående runde. Kendt og
  -- accepteret: skævheden er to timer på en uge og står i måle-ordbogen.
  visitors as (
    select w.round_key, count(distinct d.user_id) as visitors
    from win w
    join public.user_activity_days d
      on d.day >= w.round_key and d.day < w.round_key + 7
    group by 1
  ),
  since as (select min(day) as d from public.user_activity_days)
  select jsonb_build_object(
    'rounds_window', n,
    'rounds_available', (select count(*) from base where locked_count > 0),
    'activity_since', (select d from since),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round_key',      w.round_key,
        'first_kickoff',  w.first_kickoff,
        'last_kickoff',   w.last_kickoff,
        'match_count',    w.match_count,
        'locked_count',   w.locked_count,
        'finished_count', w.finished_count,
        'is_open',        w.locked_count < w.match_count,
        'exposed',        coalesce(p.exposed, 0),
        'players',        coalesce(p.players, 0),
        'missed',         coalesce(p.exposed, 0) - coalesce(p.players, 0),
        'play_rate',      case when coalesce(p.exposed, 0) = 0 then null
                               else round(100.0 * p.players / p.exposed, 1) end,
        'new_players',    coalesce(nc.new_players, 0),
        'tips',           coalesce(t.tips, 0),
        'visitors',       case when (select d from since) is null or w.round_key < (select d from since)
                               then null else coalesce(v.visitors, 0) end
      ) order by w.round_key)
      from win w
      left join per_round p  on p.round_key = w.round_key
      left join tips t       on t.round_key = w.round_key
      left join newcomers nc on nc.round_key = w.round_key
      left join visitors v   on v.round_key = w.round_key
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;


--
-- Name: admin_analytics_stories(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics_stories(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  perform public.analytics_require_admin();

  with win as (select now() - make_interval(days => p_days) as t0),
  -- Regelkataloget som DATA: alle regler, der nogensinde har udløst. En regel,
  -- der har udløst før, men ikke i vinduet, skal stå med 0 — ikke mangle.
  -- Regler, der ALDRIG har udløst, kan ikke ses herfra (de findes kun i
  -- generate_stories()); klienten holder katalogen og markerer dem.
  rules as (select distinct rule from public.stories),
  gen as (
    select s.rule,
      count(*)                                              as generated,
      -- Kunne kortet OVERHOVEDET nå en skærm? Se hovedkommentaren ovenfor.
      -- `round_key` er tekst ('YYYY-MM-DD', rundens tirsdag), så +7 giver
      -- tirsdagen efter, og zonen er dansk ligesom i public.round_key().
      count(*) filter (where s.created_at
        < ((s.round_key::date + 7)::timestamp at time zone 'Europe/Copenhagen'))
                                                            as viewable,
      count(distinct s.user_id)                             as users,
      count(*) filter (where s.dismissed_at is not null)    as dismissed,
      round(avg(s.priority), 1)                             as avg_priority,
      max(s.created_at)                                     as last_generated_at
    from public.stories s cross join win w
    where s.created_at >= w.t0
    group by s.rule
  ),
  ev as (
    select e.metadata->>'rule' as rule,
      count(*) filter (where e.event_name = 'story_viewed')  as viewed,
      -- MILEPÆLS-DELINGER HØRER IKKE TIL I EN REGELTABEL (B37, august 2026).
      -- Karriereprofilens del-knap skriver `story_shared` med milepælens nøgle
      -- som `rule`, og nøglerne bor i et andet navnerum end motorens regler.
      -- For de fleste er følgen usynlig — `COMP_COMEBACK` matcher ingen
      -- story-regel og falder ud af joinet nedenfor — men `MONTH_CHAMP` er
      -- BEGGE dele, bevidst (se kommentaren i src/lib/milestones.js), og den
      -- rules delinger blev derfor talt med i en tabel over motorens kort.
      -- Fladen aflæses nu for sig i admin_analytics_engagement's `shares`.
      count(*) filter (where e.event_name = 'story_shared'
                         and coalesce(e.metadata->>'from', '') <> 'milestone') as shared
    from public.analytics_events e cross join win w
    where e.event_name in ('story_viewed', 'story_shared')
      and e.created_at >= w.t0
      and e.metadata->>'rule' is not null
    group by 1
  ),
  joined as (
    select r.rule,
      coalesce(g.generated, 0) as generated,
      coalesce(g.viewable, 0)  as viewable,
      coalesce(g.users, 0)     as users,
      coalesce(g.dismissed, 0) as dismissed,
      g.avg_priority,
      g.last_generated_at,
      coalesce(e.viewed, 0)    as viewed,
      coalesce(e.shared, 0)    as shared,
      -- BEGGE rater deler nævner, og det er med vilje: en afvisning kræver et
      -- kort på skærmen lige så meget som en visning gør (dismissed_at sættes
      -- kun fra karusellen, `dismissStory`), så et efterfyldt kort kan hverken
      -- ses eller afvises. Havde de to hver sin nævner, ville summen af rater
      -- kunne overstige det mulige.
      case when coalesce(g.viewable, 0) = 0 then null
        else round(100.0 * coalesce(e.viewed, 0) / g.viewable, 1) end as view_rate,
      case when coalesce(g.viewable, 0) = 0 then null
        else round(100.0 * g.dismissed / g.viewable, 1) end as dismiss_rate,
      case when coalesce(e.viewed, 0) = 0 then null
        else round(100.0 * coalesce(e.shared, 0) / e.viewed, 1) end as share_rate
    from rules r
    left join gen g on g.rule = r.rule
    left join ev  e on e.rule = r.rule
  )
  select jsonb_build_object(
    'window_days', p_days,
    'quiet_tier_min', 90,  -- skal matche QUIET_TIER_MIN i src/lib/stories.js
    'generated_total', (select coalesce(sum(generated), 0) from joined),
    -- Forskellen på de to totaler er selve G73-oplysningen: hvor stor en del af
    -- motorens produktion der aldrig kunne nå en skærm.
    'viewable_total', (select coalesce(sum(viewable), 0) from joined),
    'users_reached', (
      select count(distinct s.user_id) from public.stories s cross join win w where s.created_at >= w.t0
    ),
    -- Dækning: hvor stor en del af de brugere, der HAVDE en afsluttet runde i
    -- vinduet, fik overhovedet en historie. Det tal, v1.1-leverancen blev målt
    -- på ("1 af 8 → 8 af 8 brugere i premiereugen"), gjort permanent.
    'users_with_rounds', (
      select count(distinct f.user_id) from public.analytics_completion_facts f cross join win w
      where f.lock_at >= w.t0
    ),
    'rules', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.generated desc, j.rule) from joined j
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;


--
-- Name: admin_anonymize_account(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_anonymize_account(p_user_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Din egen konto lukkes fra Profil, ikke herfra';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and is_admin) then
    raise exception 'En administrator kan ikke lukkes herfra';
  end if;
  return public._anonymize_account(p_user_id);
end $$;


--
-- Name: admin_client_errors(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_client_errors(max_rows integer DEFAULT 100) RETURNS TABLE(id uuid, user_id uuid, display_name text, kind text, message text, stack text, component_stack text, screen text, app_version text, url text, user_agent text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and coalesce(p.is_admin, false)
  ) then
    raise exception 'Kun administratorer kan læse fejlrapporter';
  end if;

  return query
  select e.id, e.user_id, p.display_name, e.kind, e.message, e.stack,
         e.component_stack, e.screen, e.app_version, e.url, e.user_agent, e.created_at
  from public.client_errors e
  left join public.profiles p on p.id = e.user_id
  order by e.created_at desc
  limit greatest(1, least(coalesce(max_rows, 100), 500));
end;
$$;


--
-- Name: admin_feedback(boolean, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_feedback(only_open boolean DEFAULT false, max_rows integer DEFAULT 200) RETURNS TABLE(id uuid, user_id uuid, display_name text, kind text, message text, context jsonb, created_at timestamp with time zone, handled_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- `pr.` og ikke bare `id`: returtabellen ovenfor erklærer en OUT-parameter,
  -- der HEDDER id, og plpgsql kan ikke se forskel på den og profiles-kolonnen.
  -- Uden aliasset fejler funktionen med "column reference id is ambiguous" —
  -- ikke ved oprettelsen, men først når den kaldes. admin_job_health() slipper
  -- for det, fordi ingen af dens kolonner deler navn med en tabel-kolonne i
  -- vagten; det er ikke en forskel, man kan se ved at kopiere mønstret.
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'forbidden';
  end if;

  return query
  select f.id, f.user_id, p.display_name, f.kind, f.message, f.context, f.created_at, f.handled_at
  from public.feedback f
  left join public.profiles p on p.id = f.user_id
  where not only_open or f.handled_at is null
  order by f.created_at desc
  -- Loftet er eksplicit og ikke PostgREST's tavse 1000: en liste, der bare
  -- holder op, ligner en tom liste. `max_rows` kan hæves fra kaldestedet den
  -- dag, det bliver nødvendigt.
  limit greatest(max_rows, 1);
end $$;


--
-- Name: admin_feedback_set_handled(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_feedback_set_handled(feedback_id uuid, handled boolean) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_at timestamptz;
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'forbidden';
  end if;

  update public.feedback
     set handled_at = case when handled then now() else null end,
         handled_by = case when handled then auth.uid() else null end
   where id = feedback_id
  returning handled_at into v_at;

  return v_at;
end $$;


--
-- Name: admin_job_health(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_job_health() RETURNS TABLE(job text, last_run_at timestamp with time zone, last_ok_at timestamp with time zone, consecutive_failures integer, hour_runs integer, hour_failures integer, day_runs integer, day_failures integer, last_duration_ms integer, hour_p50_ms integer, hour_max_ms integer, day_p50_ms integer, day_max_ms integer, last_error text, last_detail jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;

  return query
  with koersler as (
    -- Varigheden regnes ÉT sted og genbruges af alle fire mål. Stod udtrykket
    -- i hvert `filter`, ville de fire kunne komme ud af trit ved en rettelse —
    -- og en median, der måler noget andet end sit eget maksimum, er værre end
    -- ingen af delene.
    --
    -- `finished_at is null` giver `ms is null`, og det er med vilje: en kørsel,
    -- der aldrig afsluttede, har ingen varighed. Aggregaterne springer null
    -- over af sig selv.
    select
      r.job,
      r.ok,
      r.started_at > now() - interval '1 hour'                                as i_timen,
      (extract(epoch from (r.finished_at - r.started_at)) * 1000)::integer    as ms
    from public.job_runs r
    where r.started_at > now() - interval '24 hours'
  ),
  vindue as (
    -- ÉT gennemløb for begge vinduer: døgnet afgrænser rækkerne, og timen er et
    -- `filter` oven i. To separate opslag ville læse de samme rækker to gange.
    --
    -- Aliasserne hedder med vilje IKKE det samme som OUT-parametrene: plpgsql
    -- kan ikke skelne en OUT-parameter fra en kolonne med samme navn, og fejlen
    -- viser sig først, når funktionen KALDES (samme fælde som `admin_feedback()`s
    -- `id`, se docs/CHANGELOG.md).
    select
      k.job                                                                   as jobnavn,
      count(*) filter (where k.i_timen)::integer                              as t_antal,
      count(*) filter (where k.i_timen and k.ok is distinct from true)::integer as t_fejl,
      count(*)::integer                                                       as d_antal,
      count(*) filter (where k.ok is distinct from true)::integer             as d_fejl,
      -- `percentile_cont` er en ordered-set-aggregat og tager `filter` som
      -- enhver anden (efterprøvet mod PostgreSQL 16.13).
      --
      -- ⚠️ **Her stod `and k.ms is not null` i første udgave, og begrundelsen
      -- var forkert.** Den sagde, at en afbrudt kørsel ellers ville indgå i
      -- sorteringen som en null og flytte medianen. Det gør den ikke:
      -- ordered-set-aggregater springer null-input over af sig selv — målt mod
      -- PostgreSQL 16.13, hvor `(1000, null, 3000, 5000, null)` og
      -- `(1000, 3000, 5000)` begge giver 3000. Sætningen var altså et no-op med
      -- en forklaring, der lød rigtig, og den slags er dyrere end ingen
      -- forklaring: den næste læser tror, mekanismen findes. Fundet ved at
      -- mutere filen og se testen forblive grøn.
      --
      -- At null holdes ude af medianen er stadig en PÅSTAND, der skal vogtes —
      -- den står som påstand 4 i `sql/tests/job_run_duration.sql` og måler
      -- udfaldet frem for skrivemåden.
      (percentile_cont(0.5) within group (order by k.ms)
         filter (where k.i_timen))::integer                                   as t_p50,
      max(k.ms) filter (where k.i_timen)                                      as t_max,
      (percentile_cont(0.5) within group (order by k.ms))::integer            as d_p50,
      max(k.ms)                                                               as d_max
    from koersler k
    group by k.job
  ),
  seneste_ok as (
    select r.job, max(r.started_at) as ok_at
    from public.job_runs r
    where r.ok
    group by r.job
  ),
  seneste as (
    select distinct on (r.job) r.job, r.started_at, r.finished_at, r.error, r.detail
    from public.job_runs r
    order by r.job, r.started_at desc
  )
  select
    s.job,
    s.started_at,
    o.ok_at,
    (select count(*)::integer
       from public.job_runs f
      where f.job = s.job
        and f.ok is distinct from true
        and (o.ok_at is null or f.started_at > o.ok_at)),
    -- `coalesce` og ikke null: et job, hvis seneste kørsel er ældre end
    -- vinduet, har målt NUL kørsler i det. Det er et tal og ikke en manglende
    -- måling — tavsheden fanges af `last_run_at`.
    coalesce(v.t_antal, 0),
    coalesce(v.t_fejl, 0),
    coalesce(v.d_antal, 0),
    coalesce(v.d_fejl, 0),
    -- …og her IKKE `coalesce`. En varighed, der ikke findes, er umålt, ikke
    -- nul; se den røde blok i filens hoved. Den seneste kørsel kan ligge uden
    -- for døgnvinduet og har alligevel en varighed, så den regnes af sin egen
    -- række frem for af `vindue`.
    (extract(epoch from (s.finished_at - s.started_at)) * 1000)::integer,
    v.t_p50,
    v.t_max,
    v.d_p50,
    v.d_max,
    s.error,
    s.detail
  from seneste s
  left join seneste_ok o on o.job = s.job
  left join vindue v on v.jobnavn = s.job
  order by s.job;
end;
$$;


--
-- Name: admin_profiles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_profiles() RETURNS TABLE(id uuid, display_name text, created_at timestamp with time zone, last_seen_at timestamp with time zone, is_admin boolean, anonymized_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select p.id, p.display_name, p.created_at, p.last_seen_at, p.is_admin, p.anonymized_at
      from public.profiles p
     order by p.created_at desc;
end;
$$;


--
-- Name: admin_recompute_derived(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_recompute_derived() RETURNS TABLE(trin text, resultat text, varighed interval)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from public.recompute_derived();
end;
$$;


--
-- Name: admin_recompute_ratings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_recompute_ratings() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Kun administratorer kan genberegne ratings';
  end if;
  perform public.recompute_ratings();
end;
$$;


--
-- Name: admin_seasons(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_seasons() RETURNS TABLE(season_id uuid, league_name text, season_name text, ends_at date, is_finished boolean, last_kickoff timestamp with time zone, matches integer, unplayed integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select s.id, l.name, s.name, s.ends_at, s.is_finished,
         max(m.kickoff_at),
         count(m.id)::int,
         count(*) filter (where m.id is not null and m.home_score is null)::int
  from public.seasons s
  join public.leagues l on l.id = s.league_id
  left join public.matches m on m.season_id = s.id
  where exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  group by s.id, l.name, s.name, s.ends_at, s.is_finished
  order by l.name, s.name desc;
$$;


--
-- Name: admin_set_season_finished(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_season_finished(p_season_id uuid, p_finished boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;
  update public.seasons set is_finished = coalesce(p_finished, false) where id = p_season_id;
  if not found then
    raise exception 'Sæsonen findes ikke';
  end if;
end $$;


--
-- Name: admin_user_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_user_stats() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  today  date := (now() at time zone 'utc')::date;
  result jsonb;
begin
  -- Kun admins må se statistik om alle brugere.
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    -- Brugere
    'total',   (select count(*) from public.profiles),
    'new_7d',  (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'new_30d', (select count(*) from public.profiles where created_at >= now() - interval '30 days'),

    -- Aktivitet
    'dau', (select count(distinct user_id) from public.user_activity_days where day = today),
    'wau', (select count(distinct user_id) from public.user_activity_days where day >= today - 6),
    'mau', (select count(distinct user_id) from public.user_activity_days where day >= today - 29),
    'avg_active_days_30d', (
      select coalesce(round(avg(c)::numeric, 1), 0)
      from (select count(*) c from public.user_activity_days where day >= today - 29 group by user_id) t
    ),

    -- Engagement
    'has_predicted',   (select count(distinct user_id) from public.predictions),
    'never_predicted', (select count(*) from public.profiles p
                        where not exists (select 1 from public.predictions pr where pr.user_id = p.id)),
    'avg_predictions', (
      select coalesce(round(avg(c)::numeric, 1), 0)
      from (select count(*) c from public.predictions group by user_id) t
    ),
    'in_private_league', (select count(distinct user_id) from public.competition_participants),

    -- Frafald
    'inactive_30d', (select count(*) from public.profiles p
                     where not exists (
                       select 1 from public.user_activity_days d
                       where d.user_id = p.id and d.day >= today - 29
                     )),

    -- Kurver
    'signups_by_week', (
      select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'count', c) order by wk), '[]'::jsonb)
      from (
        select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') wk, count(*) c
        from public.profiles
        where created_at is not null and created_at >= now() - interval '84 days'
        group by 1
      ) w
    ),
    'active_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'count', c) order by day), '[]'::jsonb)
      from (
        select day, count(distinct user_id) c
        from public.user_activity_days
        where day >= today - 29
        group by day
      ) d
    )
  ) into result;

  return result;
end;
$$;


--
-- Name: analytics_require_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_require_admin() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;
end;
$$;


--
-- Name: anonymize_my_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anonymize_my_account() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;
  return public._anonymize_account(v_uid);
end $$;


--
-- Name: apply_milestone_stories(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_milestone_stories(p_max_age_hours integer DEFAULT 48) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_n int := 0;
  r record;
begin
  -- ---- 1. Kapring af dagens kort ----
  with fresh as (
    select distinct on (m.user_id, d.day)
      m.user_id, d.day, m.key, m.payload, m.competition_id
    from public.milestones m
    cross join lateral (
      select (select max(mm.match_day) from public.matches mm
              where mm.match_day <= public.match_day(m.achieved_at)) as day
    ) d
    where m.achieved_at > now() - make_interval(hours => p_max_age_hours)
      and d.day is not null
    order by m.user_id, d.day,
             case m.family when 'competition' then 0 when 'rating' then 1
                           when 'precision'  then 2 when 'community' then 3 else 4 end,
             m.tier desc, m.key asc
  )
  update public.stories s
  set rule = 'MILESTONE',
      priority = 110,
      competition_id = fresh.competition_id,
      -- `- 'mini'` er ikke oprydning, men den ene halvdel af en invariant (G88,
      -- 8. august 2026). Kapringen flytter kortets `competition_id` til
      -- milepælens, og en mini-stilling, der blev pakket for den GAMLE
      -- konkurrence, ville så vise én konkurrences stilling under en anden
      -- konkurrences kort. Motoren udelader mini for MILESTONE af samme grund,
      -- så de to veje til samme kort giver samme række — acceptkriterie 7.
      payload = (s.payload - 'mini') || jsonb_build_object(
        'milestone_key', fresh.key, 'milestone_payload', fresh.payload,
        'winner_rule', 'MILESTONE'),
      -- 120 = grundvægt 100 + nærhed 20. Størrelsesbidraget er nul for en
      -- milepæl (se _sd_scored), så tallet er det SAMME, som motoren ville have
      -- skrevet — og en gen-kørsel af generate_daily_stories() giver derfor
      -- byte-samme række som denne kapring. Et hardkodet tal to steder er
      -- prisen; alternativet var, at cron og motor scorede samme kort
      -- forskelligt, hvilket ville bryde determinismen i acceptkriterie 7.
      news_value = 120,
      headline = 'Ny milepæl',
      body = fresh.key
  from fresh
  where s.user_id = fresh.user_id
    and s.day_key = fresh.day
    and s.period = 'day'
    and s.news_value is not null
    and s.rule <> 'MILESTONE'                          -- allerede kapret ⇒ rør den ikke
    and s.created_at > now() - make_interval(hours => p_max_age_hours);

  get diagnostics v_n = row_count;

  -- ---- 2. Frame 5 i allerede genererede rundestories ----
  -- build_round_frames() bygger hele arrayet om, så en milepæl, der lander
  -- efter rundekortet, får sin frame uden at de fire andre kan drive.
  for r in
    select distinct s.round_key
    from public.stories s
    where s.period = 'round'
      and exists (
        select 1 from public.milestones m
        where m.user_id = s.user_id
          and m.achieved_at > now() - make_interval(hours => p_max_age_hours)
          and public.match_day(m.achieved_at)
              between s.round_key::date and s.round_key::date + 6
      )
  loop
    perform public.build_round_frames(r.round_key);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;


--
-- Name: award_competition_periods(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.award_competition_periods(p_comp_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rounds integer := 0;
  v_months integer := 0;
begin
  -- Guard: en deltager (eller service_role, jf. B10/B11) — fremmede kan ikke
  -- engang trigge beregningen. Uden opt-in ved oprettelsen sker der intet.
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from competition_participants cp
    where cp.competition_id = p_comp_id and cp.user_id = auth.uid()
  ) then
    return 0;
  end if;

  if not exists (
    select 1 from competitions c
    where c.id = p_comp_id and (c.mode_params ->> 'awards') = 'true'
  ) then
    return 0;
  end if;

  -- ---------- Ugens bedste (pr. færdigspillet runde) ----------
  with comp_matches as (
    select m.id, m.round_key, m.home_score, m.away_score,
           m.kickoff_at, m.kickoff_tbd
    from competition_matches cm
    join matches m on m.id = cm.match_id
    where cm.competition_id = p_comp_id
  ),
  complete_rounds as (
    select round_key
    from comp_matches
    group by round_key
    having count(*) filter (where home_score is null or away_score is null) = 0
  ),
  scored as (
    select m.round_key, pr.user_id,
           pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
           abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score) as goal_err
    from comp_matches m
    join complete_rounds r on r.round_key = m.round_key
    join predictions pr on pr.match_id = m.id
    join competition_participants cp
      on cp.competition_id = p_comp_id and cp.user_id = pr.user_id
    where pr.pred_home is not null and pr.pred_away is not null
      and coalesce(match_lock_at(m.kickoff_at, m.kickoff_tbd) > cp.joined_at, true)  -- A53
  ),
  totals as (
    select round_key, user_id,
           sum(pts)::int as points,
           count(*)::int as matches,
           (count(*) filter (where pts = 3))::int as exact_count,
           (count(*) filter (where pts = 1))::int as outcome_count,
           round(sum(goal_err)::numeric / count(*), 4) as avg_goal_error,
           rank() over (
             partition by round_key
             order by sum(pts) desc,
                      (count(*) filter (where pts = 3)) desc,
                      (count(*) filter (where pts = 1)) desc,
                      round(sum(goal_err)::numeric / count(*), 4) asc
           ) as rnk
    from scored
    group by round_key, user_id
  ),
  winners as (
    select *, (count(*) over (partition by round_key)) > 1 as is_shared
    from totals where rnk = 1
  ),
  ins as (
    insert into competition_awards
      (competition_id, period_type, period_key, user_id, points, shared, stats)
    select p_comp_id, 'round', w.round_key::text, w.user_id, w.points, w.is_shared,
           jsonb_build_object('exact', w.exact_count, 'outcome', w.outcome_count,
                              'matches', w.matches, 'goal_error', w.avg_goal_error)
    from winners w
    on conflict do nothing
    returning 1
  )
  select count(*) into v_rounds from ins;

  -- ---------- Månedens bedste (pr. afsluttet kalendermåned) ----------
  with comp_matches as (
    select m.id,
           to_char(m.kickoff_at at time zone 'Europe/Copenhagen', 'YYYY-MM') as month_key,
           m.home_score, m.away_score,
           m.kickoff_at, m.kickoff_tbd
    from competition_matches cm
    join matches m on m.id = cm.match_id
    where cm.competition_id = p_comp_id
  ),
  complete_months as (
    select month_key
    from comp_matches
    group by month_key
    having count(*) filter (where home_score is null or away_score is null) = 0
       -- Kalendermåneden skal være forbi — ellers kunne en kåring falde, mens
       -- måneden stadig kan få nye kampe (efterfyldning, udsatte kampe).
       and month_key < to_char(now() at time zone 'Europe/Copenhagen', 'YYYY-MM')
  ),
  scored as (
    select m.month_key, pr.user_id,
           pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
           abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score) as goal_err
    from comp_matches m
    join complete_months cm on cm.month_key = m.month_key
    join predictions pr on pr.match_id = m.id
    join competition_participants cp
      on cp.competition_id = p_comp_id and cp.user_id = pr.user_id
    where pr.pred_home is not null and pr.pred_away is not null
      and coalesce(match_lock_at(m.kickoff_at, m.kickoff_tbd) > cp.joined_at, true)  -- A53
  ),
  totals as (
    select month_key, user_id,
           sum(pts)::int as points,
           count(*)::int as matches,
           (count(*) filter (where pts = 3))::int as exact_count,
           (count(*) filter (where pts = 1))::int as outcome_count,
           round(sum(goal_err)::numeric / count(*), 4) as avg_goal_error,
           rank() over (
             partition by month_key
             order by sum(pts) desc,
                      (count(*) filter (where pts = 3)) desc,
                      (count(*) filter (where pts = 1)) desc,
                      round(sum(goal_err)::numeric / count(*), 4) asc
           ) as rnk
    from scored
    group by month_key, user_id
  ),
  winners as (
    select *, (count(*) over (partition by month_key)) > 1 as is_shared
    from totals where rnk = 1
  ),
  ins as (
    insert into competition_awards
      (competition_id, period_type, period_key, user_id, points, shared, stats)
    select p_comp_id, 'month', w.month_key, w.user_id, w.points, w.is_shared,
           jsonb_build_object('exact', w.exact_count, 'outcome', w.outcome_count,
                              'matches', w.matches, 'goal_error', w.avg_goal_error)
    from winners w
    on conflict do nothing
    returning 1
  )
  select count(*) into v_months from ins;

  return v_rounds + v_months;
end;
$$;


--
-- Name: award_milestones(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.award_milestones(p_user_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_n int := 0;
begin
  drop table if exists _ms_new;
  create temporary table _ms_new (
    user_id uuid, key text, family text, tier int,
    competition_id uuid, round_key text, payload jsonb
  );

  -- ================= FAMILIE: rating =================
  -- Tærskler måles mod PEAK og ikke mod nuværende rating, så en senere nedtur
  -- ikke gør en allerede opnået milepæl usand i det øjeblik, den vises.
  insert into _ms_new
  select rh.user_id, 'RATING_' || t.tier, 'rating', t.tier, null, null,
         jsonb_build_object('peak', round(rh.peak)::int)
  from (
    select user_id, max(rating_after) as peak
    from public.rating_history
    where scope = 'ALL' and (p_user_id is null or user_id = p_user_id)
    group by user_id
  ) rh
  cross join (values (1100), (1200), (1300), (1400)) t(tier)
  where rh.peak >= t.tier;

  -- Etableret: de fem provisoriske runder er gennemført.
  insert into _ms_new
  select r.user_id, 'RATING_ESTABLISHED', 'rating', 5, null, null,
         jsonb_build_object('rounds', r.rounds_played)
  from public.ratings r
  where r.scope = 'ALL' and r.rounds_played >= 5
    and (p_user_id is null or r.user_id = p_user_id);

  -- Rangliste. FELTSTØRRELSE-GUARDEN ER IKKE VALGFRI: uden den uddeles
  -- "top 3 af 3" på dag ét, og så betyder milepælen ingenting.
  insert into _ms_new
  select r.user_id, x.key, 'rating', x.tier, null, null,
         jsonb_build_object('rank', r.rnk, 'total', r.total)
  from (
    select user_id,
           rank() over (order by rating desc)::int as rnk,
           (count(*) over ())::int as total
    from public.ratings
    where scope = 'ALL' and coalesce(provisional, false) = false
  ) r
  cross join (values
    ('LEADERBOARD_NO1',   1,  1,  5),
    ('LEADERBOARD_TOP3',  3,  3,  8),
    ('LEADERBOARD_TOP10', 10, 10, 10)
  ) x(key, tier, max_rnk, min_field)
  where r.rnk <= x.max_rnk and r.total >= x.min_field
    and (p_user_id is null or r.user_id = p_user_id);

  -- ================= FAMILIE: precision =================
  insert into _ms_new
  select c.user_id, 'TIPS_' || t.tier, 'precision', t.tier, null, null,
         jsonb_build_object('tips', c.n)
  from (
    select user_id, count(*)::int as n from public.predictions
    where pred_home is not null and pred_away is not null
      and (p_user_id is null or user_id = p_user_id)
    group by user_id
  ) c
  cross join (values (100), (500), (1000)) t(tier)
  where c.n >= t.tier;

  insert into _ms_new
  select c.user_id, 'EXACT_' || t.tier, 'precision', t.tier, null, null,
         jsonb_build_object('exact', c.n)
  from (
    select pr.user_id, count(*)::int as n
    from public.predictions pr
    join public.matches m on m.id = pr.match_id
    where m.home_score is not null and m.away_score is not null
      and pr.pred_home is not null and pr.pred_away is not null
      and public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) = 3
      and (p_user_id is null or pr.user_id = p_user_id)
    group by pr.user_id
  ) c
  cross join (values (50), (250)) t(tier)
  where c.n >= t.tier;

  -- Perfekt runde. Guard `n >= 5`: en runde med én kamp er ikke en perfekt
  -- runde. Kan ikke komme fra round_standings — den kender ikke pr.-kamp-minimum.
  insert into _ms_new
  select r.user_id, x.key, 'precision', x.tier, null, r.round_key::text,
         jsonb_build_object('matches', r.n, 'points', r.pts)
  from (
    select pr.user_id, m.round_key, count(*)::int as n,
           sum(public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score))::int as pts,
           min(public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score))::int as worst
    from public.predictions pr
    join public.matches m on m.id = pr.match_id
    join public.seasons s on s.id = m.season_id
    join public.leagues l on l.id = s.league_id and l.is_official
    where m.home_score is not null and m.away_score is not null
      and pr.pred_home is not null and pr.pred_away is not null
      and (p_user_id is null or pr.user_id = p_user_id)
    group by pr.user_id, m.round_key
    having count(*) >= 5
  ) r
  cross join (values
    ('PERFECT_ROUND', 1, 1), ('PERFECT_ROUND_EXACT', 2, 3)
  ) x(key, tier, min_pts)
  where r.worst >= x.min_pts;

  -- Kampe i træk med point.
  --
  -- LÆSNING AF SPEC-LINJEN: den lød "5/10/20 eksakte resultater i træk hvor du
  -- fik point". En stime på 20 EKSAKTE er statistisk uopnåelig (eksakt-raten er
  -- ~15 %, så 0,15^20), mens 5/10/20 kampe i træk MED POINT er en rigtig
  -- bedrift, man kan jagte. Derfor tælles point-stimen. Samme vindue som
  -- STREAK_STATUS-dagsreglen (sql/story_engine_v2.sql), så de to aldrig kan
  -- modsige hinanden.
  insert into _ms_new
  select b.user_id, 'POINTS_STREAK_' || t.tier, 'precision', t.tier, null, null,
         jsonb_build_object('streak', b.len)
  from (
    with hist as (
      select pr.user_id, m.kickoff_at, m.id as match_id,
             (public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) >= 1) as hit
      from public.predictions pr
      join public.matches m on m.id = pr.match_id
      join public.seasons s on s.id = m.season_id
      join public.leagues l on l.id = s.league_id and l.is_official
      where m.home_score is not null and m.away_score is not null
        and pr.pred_home is not null and pr.pred_away is not null
        and (p_user_id is null or pr.user_id = p_user_id)
    ),
    grp as (
      select *,
        row_number() over (partition by user_id order by kickoff_at, match_id)
        - row_number() over (partition by user_id, hit order by kickoff_at, match_id) as g
      from hist
    ),
    runs as (select user_id, hit, count(*)::int as len from grp group by user_id, hit, g)
    select user_id, max(len) as len from runs where hit group by user_id
  ) b
  cross join (values (5), (10), (20)) t(tier)
  where b.len >= t.tier;

  -- Runder i træk med ALLE tips afgivet ("aldrig glemt").
  -- analytics_completion_facts definerer allerede præcist, hvilke kampe en
  -- bruger var SAT til at tippe: låsen skal være passeret, og kampen skal ligge
  -- efter brugerens joined_at. Den definition genbruges frem for at udlede en ny.
  insert into _ms_new
  select b.user_id, 'ROUNDS_COMPLETE_' || t.tier, 'precision', t.tier, null, null,
         jsonb_build_object('rounds', b.len)
  from (
    with slots as (
      -- distinct: den samme kamp kan ligge i flere konkurrencer
      select distinct user_id, round_key, match_id, predicted
      from public.analytics_completion_facts
      where (p_user_id is null or user_id = p_user_id)
    ),
    per_round as (
      select user_id, round_key, bool_and(predicted) as full_round
      from slots group by user_id, round_key
    ),
    grp as (
      select *,
        row_number() over (partition by user_id order by round_key)
        - row_number() over (partition by user_id, full_round order by round_key) as g
      from per_round
    ),
    runs as (select user_id, full_round, count(*)::int as len from grp group by user_id, full_round, g)
    select user_id, max(len) as len from runs where full_round group by user_id
  ) b
  cross join (values (10), (30), (100)) t(tier)
  where b.len >= t.tier;

  -- ================= FAMILIE: competition =================
  -- Månedens Champion (global). Kriteriet er byte-identisk med
  -- career_profile.titles.monthly og med story-regel 10 — samme spørgsmål må
  -- ikke få to svar (K3). `month` udregnes præcis som i monthly_standings
  -- (date_trunc uden zone), fordi det er DEN tabel, vi rangerer i.
  insert into _ms_new
  select w.user_id, 'MONTH_CHAMP', 'competition', 1, null, null,
         jsonb_build_object('month', w.month, 'points', w.total_points, 'shared', w.n_top > 1)
  from (
    select ms.month, ms.user_id, ms.total_points, count(*) over (partition by ms.month) as n_top
    from (
      select month, user_id, total_points,
             rank() over (partition by month
                          order by total_points desc, exact_count desc, outcome_count desc,
                                   round_wins desc, avg_goal_error asc) as rnk
      from public.monthly_standings where scope = 'ALL'
    ) ms
    join (
      -- måneden skal være færdigspillet, ellers kan kåringen nå at skifte
      select to_char(date_trunc('month', m.kickoff_at), 'YYYY-MM') as month
      from public.matches m
      join public.seasons s on s.id = m.season_id
      join public.leagues l on l.id = s.league_id and l.is_official
      group by 1
      having count(*) filter (where m.home_score is null or m.away_score is null) = 0
    ) md on md.month = ms.month
    where ms.rnk = 1
  ) w
  where (p_user_id is null or w.user_id = p_user_id);

  -- Sæsonens Champion (global), samme mønster.
  insert into _ms_new
  select w.user_id, 'SEASON_CHAMP', 'competition', 2, null, null,
         jsonb_build_object('points', w.total_points, 'shared', w.n_top > 1)
  from (
    select ss.user_id, ss.total_points, count(*) over (partition by ss.season_id) as n_top
    from (
      select season_id, user_id, total_points,
             rank() over (partition by season_id
                          order by total_points desc, exact_count desc, outcome_count desc,
                                   round_wins desc, avg_goal_error asc) as rnk
      from public.season_standings
    ) ss
    join (
      select s.id as season_id
      from public.seasons s
      join public.leagues l on l.id = s.league_id and l.is_official
      join public.matches m on m.season_id = s.id
      group by s.id
      having count(*) filter (where m.home_score is null or m.away_score is null) = 0
    ) sd on sd.season_id = ss.season_id
    where ss.rnk = 1
  ) w
  where (p_user_id is null or w.user_id = p_user_id);

  -- Sejr, podie og storsejr i en AFSLUTTET konkurrence.
  drop table if exists _ms_final;
  create temporary table _ms_final as
  select p.competition_id, p.user_id, sum(p.pts)::int as pts,
    rank() over (partition by p.competition_id
                 order by sum(p.pts) desc,
                          (count(*) filter (where p.pts = 3)) desc,
                          (count(*) filter (where p.pts = 1)) desc,
                          round(sum(p.goal_err)::numeric / count(*), 4) asc)::int as rnk
  from public.competition_match_points p
  join public.competition_status cs
    on cs.competition_id = p.competition_id and cs.concluded
  group by p.competition_id, p.user_id;

  insert into _ms_new
  select f.user_id, x.key, 'competition', x.tier, f.competition_id, null,
         jsonb_build_object('league', c.name, 'points', f.pts, 'rank', f.rnk, 'total', sz.n)
  from _ms_final f
  join public.competitions c on c.id = f.competition_id
  join (select competition_id, count(*)::int as n
        from public.competition_participants group by competition_id) sz
    on sz.competition_id = f.competition_id
  cross join (values
    ('COMP_FIRST_WIN',  1, 1, 2),   -- sejr i en konkurrence med mindst 2 deltagere
    ('COMP_WIN_BIG_8',  3, 1, 8),   -- sejr i en konkurrence med mindst 8
    ('COMP_PODIUM',     2, 3, 5)    -- podie kræver mindst 5, ellers er alle på podiet
  ) x(key, tier, max_rnk, min_players)
  where f.rnk <= x.max_rnk and sz.n >= x.min_players
    and (p_user_id is null or f.user_id = p_user_id);

  -- Comeback: vandt konkurrencen uden at have ligget nr. 1 i nogen runde før
  -- den sidste. Katalogets dyreste regel — den kræver, at hele konkurrencens
  -- rundevise stilling genopbygges, fordi rang pr. runde ikke gemmes noget sted.
  --
  -- BEMÆRK en kendt upræcished: en bruger uden tips i en given runde har ingen
  -- række dér, og indgår derfor ikke i den rundes rangering. Det kan gøre en
  -- mellemliggende førsteplads usynlig. Konsekvensen er konservativ i den
  -- forkerte retning (milepælen kan uddeles lidt for let), men aldrig at en
  -- ægte comeback-sejr overses.
  --
  -- YDELSE: rangene bygges ÉN GANG for alle afsluttede konkurrencer og lægges i
  -- en temp-tabel. Første udgave havde genopbygningen som en korreleret
  -- `not exists` pr. vinder-række, altså én fuld gennemregning af konkurrencens
  -- historik pr. kandidat. Et skaleringsforsøg på en syntetisk fuld sæson
  -- (sql/tests/story_engine_scale.sql) målte den til **726 ms af funktionens
  -- 1087** — to tredjedele af hele milepæls-beregningen lå i denne ene regel.
  drop table if exists _ms_lead;
  create temporary table _ms_lead as
  with per_round as (
    select p.competition_id, p.user_id, p.round_key,
           sum(p.pts) as rpts,
           count(*) filter (where p.pts = 3) as rex,
           count(*) filter (where p.pts = 1) as rout,
           sum(p.goal_err) as rerr, count(*) as rm
    from public.competition_match_points p
    join public.competition_status cs
      on cs.competition_id = p.competition_id and cs.concluded
    group by p.competition_id, p.user_id, p.round_key
  ),
  cum as (
    select competition_id, user_id, round_key,
           sum(rpts) over w as pts, sum(rex) over w as ex,
           sum(rout) over w as outc, sum(rerr) over w as err, sum(rm) over w as m
    from per_round
    window w as (partition by competition_id, user_id order by round_key
                 rows between unbounded preceding and current row)
  ),
  ranked as (
    select competition_id, user_id, round_key,
           rank() over (partition by competition_id, round_key
                        order by pts desc, ex desc, outc desc,
                                 round(err::numeric / m, 4) asc) as rnk,
           max(round_key) over (partition by competition_id) as last_round
    from cum
  )
  -- Alle, der har ligget nr. 1 i en runde FØR den sidste. Er man ikke i denne
  -- liste og vandt alligevel, er det per definition et comeback.
  select distinct competition_id, user_id from ranked
  where rnk = 1 and round_key < last_round;

  -- GRÆNSERNE ER IKKE VALGFRIE. Uden dem uddeles milepælen for noget, der ikke
  -- kan være sket: en konkurrence med ÉN runde har ingen "før sidste runde", så
  -- `_ms_lead` er tom, `not exists` er sandt, og alle vindere fik et comeback.
  -- Og man kan ikke komme bagfra mod ingen — reglen manglede helt den
  -- deltagergrænse, alle de øvrige konkurrence-milepæle har.
  --   ≥ 3 runder     : der skal være en historie at vende
  --   ≥ 3 deltagere  : en føring skal betyde noget
  insert into _ms_new
  select f.user_id, 'COMP_COMEBACK', 'competition', 4, f.competition_id, null,
         jsonb_build_object('league', c.name, 'points', f.pts, 'rounds', rc.n_rounds)
  from _ms_final f
  join public.competitions c on c.id = f.competition_id
  join (select competition_id, count(*)::int as n
        from public.competition_participants group by competition_id) sz
    on sz.competition_id = f.competition_id and sz.n >= 3
  join (select competition_id, count(distinct round_key)::int as n_rounds
        from public.competition_match_points group by competition_id) rc
    on rc.competition_id = f.competition_id and rc.n_rounds >= 3
  where f.rnk = 1
    and (p_user_id is null or f.user_id = p_user_id)
    and not exists (
      select 1 from _ms_lead ml
      where ml.competition_id = f.competition_id and ml.user_id = f.user_id
    );

  -- ================= FAMILIE: community =================
  insert into _ms_new
  select g.created_by, 'FIRST_LEAGUE_CREATED', 'community', 1, null, null,
         jsonb_build_object('league', g.name)
  from public.groups g
  where (p_user_id is null or g.created_by = p_user_id);

  insert into _ms_new
  select c.created_by, 'FIRST_COMPETITION_CREATED', 'community', 1, c.id, null,
         jsonb_build_object('competition', c.name)
  from public.competitions c
  where (p_user_id is null or c.created_by = p_user_id);

  -- Liga-vækst.
  --
  -- HVORFOR IKKE "5/10 venner tilmeldt via DIT link": den attribution findes
  -- ikke i skemaet. groups.invite_code er ÉN kode pr. liga og ikke pr. bruger,
  -- så koden kan ikke identificere afsenderen; hverken group_members eller
  -- competition_participants har en invited_by-kolonne; og analytics_events er
  -- erklæret lossy by design (sql/analytics_events.sql) og må aldrig bære noget,
  -- en bruger kan bestride — hvilket en permanent bedrift per definition er.
  -- Personlige invite-links er en selvstændig feature (se backloggens indbakke);
  -- indtil da tæller vi det, der ER sandt: hvor mange der kom med i en liga, du
  -- har oprettet. Det er en anden bedrift, og den hedder noget andet.
  insert into _ms_new
  select b.created_by, 'LEAGUE_GREW_' || t.tier, 'community', t.tier, null, null,
         jsonb_build_object('members', b.n)
  from (
    select g.created_by, max(x.n)::int as n
    from public.groups g
    join lateral (
      select count(*)::int as n from public.group_members gm
      where gm.group_id = g.id and gm.user_id <> g.created_by
    ) x on true
    where (p_user_id is null or g.created_by = p_user_id)
    group by g.created_by
  ) b
  cross join (values (5), (10)) t(tier)
  where b.n >= t.tier;

  -- Sæsoner deltaget i. Guard `>= 5` tips pr. sæson, så et strøtip ikke tæller.
  --
  -- TÆLLER FODBOLDSÆSONER, IKKE RÆKKER I `seasons`. Den fejl var live i to
  -- dage: `seasons` har én række pr. TURNERING pr. år, så en bruger, der
  -- tippede Superliga og Premier League i den samme sæson, fik "To sæsoner med"
  -- efter en uge. Tabellens navn beskriver dens korn, ikke begrebet.
  --
  -- Sæsonåret udledes af kampens danske kickoff frem for af `seasons.name`:
  -- navnet er leverandørens tekst ("2026/27" hos den ene, "2026/2027" hos den
  -- anden), og to leverandører er allerede i drift. Måneden er skillelinjen —
  -- en sæson løber juli→juni, så alt før juli hører til året før.
  insert into _ms_new
  select b.user_id, 'SEASONS_' || t.tier, 'community', t.tier, null, null,
         jsonb_build_object('seasons', b.n)
  from (
    select user_id, count(*)::int as n
    from (
      select pr.user_id,
             (case
                when extract(month from m.kickoff_at at time zone 'Europe/Copenhagen') >= 7
                then extract(year from m.kickoff_at at time zone 'Europe/Copenhagen')
                else extract(year from m.kickoff_at at time zone 'Europe/Copenhagen') - 1
              end)::int as season_year
      from public.predictions pr
      join public.matches m on m.id = pr.match_id
      where pr.pred_home is not null and pr.pred_away is not null
        and (p_user_id is null or pr.user_id = p_user_id)
      group by 1, 2
      having count(*) >= 5
    ) s
    group by user_id
  ) b
  cross join (values (2), (3)) t(tier)
  where b.n >= t.tier;

  -- ================= Skriv =================
  -- `distinct on (user_id, key)` fordi flere blokke kan producere samme nøgle i
  -- samme kørsel (fx to afsluttede konkurrencer, der begge giver COMP_PODIUM).
  -- Den ÆLDSTE begivenhed vinder ikke her — vi har ingen tidsstempel pr.
  -- kandidat — men rækken skrives kun én gang, og det er hele pointen.
  with ins as (
    insert into public.milestones
      (user_id, key, family, tier, competition_id, round_key, payload)
    select distinct on (user_id, key)
           user_id, key, family, tier, competition_id, round_key, payload
    from _ms_new
    -- `user_id is not null` er et sikkerhedsnet, ikke en forventning: både
    -- groups.created_by og competitions.created_by er NOT NULL med fremmednøgle,
    -- så en null kan ikke opstå i dag. Filteret står her, fordi konsekvensen er
    -- uforholdsmæssig — funktionen skriver ALLE brugeres milepæle i ét insert,
    -- så én dårlig række afbryder hele batchen for alle, og den afbrydelse sker
    -- TAVST bag matches-triggerens exception-guard. Ét filter på den fælles vej
    -- ud dækker enhver kilde-blok, også dem der tilføjes senere.
    where user_id is not null
    order by user_id, key, tier desc
    on conflict (user_id, key) do nothing
    returning 1
  )
  select count(*)::int into v_n from ins;

  drop table if exists _ms_new;
  drop table if exists _ms_final;
  drop table if exists _ms_lead;
  return v_n;
end;
$$;


--
-- Name: build_round_frames(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_round_frames(p_round_key text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_round date := p_round_key::date;
  v_label text := to_char(p_round_key::date, 'DD.MM') || ' – ' || to_char(p_round_key::date + 6, 'DD.MM');
  v_month text := to_char(p_round_key::date, 'YYYY-MM');
  v_n int := 0;
begin
  -- Rundens vinder(e) globalt. Delt sejr nævnes som sådan.
  drop table if exists _bf_champ;
  create temporary table _bf_champ as
  select pr.display_name as name, rs.total_points as points,
         count(*) over ()::int as n_winners
  from public.round_standings rs
  join public.profiles pr on pr.id = rs.user_id
  where rs.round_key = v_round and rs.scope = 'ALL'
    and rs.total_points = (select max(total_points) from public.round_standings
                           where round_key = v_round and scope = 'ALL');

  -- Frame 1's percentil kræver hele feltet, ikke kun brugerens række.
  drop table if exists _bf_me;
  create temporary table _bf_me as
  select rs.user_id, rs.total_points, rs.exact_count, rs.matches,
         rank() over (order by rs.total_points desc)::int as rnk,
         count(*) over ()::int as n_field
  from public.round_standings rs
  where rs.round_key = v_round and rs.scope = 'ALL';

  -- Bedste og værste tip i runden. Samme afgrænsning som round_standings (kun
  -- officielle ligaer), så frame 2 ikke kan nævne en kamp, frame 1 ikke talte.
  drop table if exists _bf_tips;
  create temporary table _bf_tips as
  select pr.user_id, th.name as home, ta.name as away,
         m.home_score || '-' || m.away_score as score,
         pr.pred_home || '-' || pr.pred_away as guess,
         public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) as pts,
         abs(pr.pred_home - m.home_score) + abs(pr.pred_away - m.away_score) as goal_err,
         m.kickoff_at, m.id as match_id
  from public.predictions pr
  join public.matches m on m.id = pr.match_id
  join public.seasons s on s.id = m.season_id
  join public.leagues l on l.id = s.league_id and l.is_official
  join public.teams th on th.id = m.home_team_id
  join public.teams ta on ta.id = m.away_team_id
  where m.round_key = v_round
    and m.home_score is not null and m.away_score is not null
    and pr.pred_home is not null and pr.pred_away is not null;

  -- Bedste og værste tip PRÆ-AGGREGERES med `distinct on` frem for at blive
  -- slået op med en lateral pr. bruger. Det er ikke mikro-optimering: med en
  -- lateral sorterede Postgres hele _bf_tips forfra for hver eneste bruger, og
  -- rundemotoren gik fra 77 ms til 886 ms på en syntetisk fuld sæson —
  -- 7× referencen recompute_ratings(), stik imod acceptkriterie 10. To
  -- distinct on-pas koster to sorteringer i alt.
  -- Tiebreak på kickoff og match_id, så to lige gode tips altid giver samme svar.
  drop table if exists _bf_best;
  create temporary table _bf_best as
  select distinct on (user_id) * from _bf_tips
  order by user_id, pts desc, goal_err asc, kickoff_at asc, match_id asc;
  create index on _bf_best (user_id);

  drop table if exists _bf_worst;
  create temporary table _bf_worst as
  select distinct on (user_id) * from _bf_tips
  order by user_id, pts asc, goal_err desc, kickoff_at asc, match_id asc;
  create index on _bf_worst (user_id);

  -- Månedsstillingen materialiseres ÉN gang. Som lateral blev vinduesfunktionen
  -- kørt om for hver bruger — samme kvadratiske form som tips-opslaget ovenfor.
  drop table if exists _bf_month;
  create temporary table _bf_month as
  select user_id, total_points,
         rank() over (order by total_points desc)::int as rnk,
         count(*) over ()::int as n_field
  from public.monthly_standings where month = v_month and scope = 'ALL';
  create index on _bf_month (user_id);

  -- Vinder-rækken pr. bruger — byte-samme ORDER BY som latest_story-viewet.
  drop table if exists _bf_row;
  create temporary table _bf_row as
  select distinct on (user_id) id, user_id
  from public.stories
  where round_key = p_round_key and period = 'round'
  order by user_id, priority asc, league_size desc nulls last, competition_id asc nulls last;

  with frames as (
    select r.id, r.user_id,
      jsonb_build_array(
        -- Frame 1 · Din runde. Percentilen er "bedre end X %" og afrundes ned,
        -- så tallet aldrig lover mere, end det kan holde.
        jsonb_build_object('frame', 'ROUND_SUM', 'label', v_label,
          'points', coalesce(me.total_points, 0), 'exact', coalesce(me.exact_count, 0),
          'matches', coalesce(me.matches, 0), 'rank', me.rnk, 'total', me.n_field,
          'percentile', case when me.n_field > 1
                             then floor(100.0 * (me.n_field - me.rnk) / (me.n_field - 1))::int
                             else null end),
        -- Frame 2 · Kampen der afgjorde det.
        jsonb_build_object('frame', 'BEST_WORST',
          'best', case when bst.match_id is null then null else
            jsonb_build_object('home', bst.home, 'away', bst.away, 'score', bst.score,
                               'guess', bst.guess, 'points', bst.pts) end,
          'worst', case when wst.match_id is null or wst.match_id = bst.match_id then null else
            jsonb_build_object('home', wst.home, 'away', wst.away, 'score', wst.score,
                               'guess', wst.guess, 'points', wst.pts) end),
        -- Frame 3 · Rating. Uden en ratingrække (provisorisk/ingen tips) står
        -- rammen med null'er, og klienten springer den over.
        jsonb_build_object('frame', 'RATING',
          'rating', rh.rating_after, 'delta', rh.delta,
          'rank', rh.rnk, 'moved', prev.rnk - rh.rnk),
        -- Frame 4 · Rundens Champion + Månedsligaen (begge globale).
        jsonb_build_object('frame', 'CHAMPION',
          'winner', ch.name, 'winner_points', ch.points, 'shared', ch.n_winners > 1,
          'month', v_month, 'month_rank', ms.rnk, 'month_total', ms.n_field,
          'month_points', ms.total_points)
      ) as arr
    from _bf_row r
    left join _bf_me me on me.user_id = r.user_id
    left join public.rating_history rh on rh.user_id = r.user_id and rh.scope = 'ALL'
      and rh.round_key = p_round_key
    left join public.rating_history prev on prev.user_id = r.user_id and prev.scope = 'ALL'
      and prev.round_key = (v_round - 7)::text
    left join lateral (select * from _bf_champ order by name limit 1) ch on true
    left join _bf_month ms  on ms.user_id  = r.user_id
    left join _bf_best  bst on bst.user_id = r.user_id
    left join _bf_worst wst on wst.user_id = r.user_id
  ),
  -- Frame 5 er BETINGET: præcis én frame uanset antal milepæle i runden
  -- (acceptkriterie 6). Rangordenen er MILESTONE_FAMILIES' egen, spejlet fra
  -- src/lib/milestones.js — samme stige som kapringen bruger.
  ms5 as (
    select distinct on (m.user_id) m.user_id, m.key, m.payload
    from public.milestones m
    where public.match_day(m.achieved_at) between v_round and v_round + 6
    order by m.user_id,
             case m.family when 'competition' then 0 when 'rating' then 1
                           when 'precision'  then 2 when 'community' then 3 else 4 end,
             m.tier desc, m.key asc
  )
  update public.stories s
  set payload = s.payload || jsonb_build_object('frames',
        case when ms5.user_id is null then f.arr
             else f.arr || jsonb_build_array(jsonb_build_object(
               'frame', 'MILESTONE', 'milestone_key', ms5.key,
               'milestone_payload', ms5.payload))
        end)
  from frames f
  left join ms5 on ms5.user_id = f.user_id
  where s.id = f.id;

  get diagnostics v_n = row_count;

  drop table if exists _bf_champ;
  drop table if exists _bf_me;
  drop table if exists _bf_tips;
  drop table if exists _bf_best;
  drop table if exists _bf_worst;
  drop table if exists _bf_month;
  drop table if exists _bf_row;
  return v_n;
end;
$$;


--
-- Name: career_profile(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.career_profile(profile_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_own   boolean := (profile_user_id = auth.uid());
  v_rivals jsonb := '[]'::jsonb;
  v_h2h    jsonb := null;
  -- Tunbar tærskel, navngivet frem for indlejret — samme princip som Story
  -- Engines kalibrerede tærskler (v1.1): ét møde gør ingen til en rival, men i
  -- en ung sæson med få runder vil en høj tærskel give nul rivaler. Hæves, når
  -- der er runder nok til, at 2 møder ikke længere er meget.
  v_rival_min_meetings int := 2;
  months text[] := array['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
  result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- ---------- K1: adgang ----------
  -- Enhver indlogget bruger må se enhver karriere (hoved, titler, kurve, basistal).
  -- Kun et ukendt id afvises — ellers ville svaret være et hoved uden navn.
  if not exists (select 1 from public.profiles where id = profile_user_id) then
    raise exception 'not found';
  end if;

  -- ---------- Rivaler (kun egen profil — private, jf. K1) ----------
  -- K3 LUKKET (30. juli 2026): rangeres på JÆVNBYRDIGHED fra faktiske møder,
  -- ikke på antal historier.
  --
  -- Før: ren stories-optælling af regel 40 (H2H_PASS) / 60 (STREAK). K3 valgte
  -- den som det billigste udgangspunkt og forudsagde selv problemet: "udvid hvis
  -- den giver for få rivaler i små ligaer". Tragten var for smal — kun 2 af 16
  -- regler skriver et rival-navn, regel 40 kræver en overhaling i netop den
  -- runde og regel 60 en AKTUEL stime på ≥2 sejre, og begge har
  -- `distinct on (competition_id, user_id)`, så der gemmes ÉN rival pr.
  -- konkurrence pr. runde. I en lille liga med stabil rækkefølge sker der
  -- næsten ingen overhalinger → nul rivaler efter 20 runder mod de samme tre
  -- personer. Teksten sagde desuden "Din tætteste rival", men rangeringen målte
  -- ikke tæthed — den målte, hvor dramatisk forholdet havde været.
  --
  -- K3's egen foreslåede udvej (`rating_history.rnk`, placerings-nabo) er
  -- BEVIDST ikke valgt: `rnk` er den globale ratingplacering, så den ville
  -- kunne udpege folk, man ikke deler konkurrence med — i strid med den
  -- ufravigelige designregel fra juli 2026 (en historie må kun nævne personer,
  -- modtageren deler konkurrence med). Denne beregning starter i
  -- `competition_participants` og kan derfor per konstruktion ikke nævne en
  -- fremmed.
  --
  -- INGEN REGRESSION: en story-rival er altid også en møde-rival. Regel 40
  -- kræver en stilling FØR runden for begge parter (altså ≥1 tidligere fælles
  -- runde) og regel 60 kræver ≥2 sejre i træk — begge medfører ≥2 møder, så
  -- alle, den gamle optælling kunne finde, er med her.
  if v_own then
    with pair_matches as (
      -- Kampe fra konkurrencer, hvor BÅDE profilens ejer og modstanderen
      -- deltager. `distinct`: samme kamp kan ligge i flere delte konkurrencer,
      -- og et møde må kun tælle én gang — samme dedup-regel som h2h
      -- (K4-rettelsen 30. juli 2026), her blot pr. modstander.
      --
      -- DELTAGERENS NULPUNKT GÆLDER OGSÅ HER (G107, 14. august 2026): kampen
      -- tæller kun, hvis den låste, EFTER BEGGE havde meldt sig til den delte
      -- konkurrence. `predictions` er én række pr. (bruger, kamp) og deles på
      -- tværs af konkurrencer, så uden leddet kunne opgøret hvile på gæt, den
      -- ene afgav i en HELT anden konkurrence, længe før den anden kunne nå at
      -- være med — og så ville "I har mødt hinanden N gange" tælle runder, der
      -- aldrig var et møde. Leddet ligger FØR `distinct`, så en kamp tæller,
      -- hvis den kvalificerer i mindst én delt konkurrence; dedup'en er
      -- uændret. Reglen er ordret `#61`s (`A53`) og står ét sted i JS
      -- (`wasTippableAt`) og ét sted i SQL: `match_lock_at(…) > joined_at`,
      -- `coalesce(…, true)` fordi en kamp uden fastsat kickoff ikke har en
      -- låsetid at måle mod.
      select distinct theirs.user_id as rival_id, cm.match_id,
             m.round_key, m.home_score, m.away_score
      from public.competition_participants mine
      join public.competition_participants theirs
        on theirs.competition_id = mine.competition_id
       and theirs.user_id <> profile_user_id
      join public.competition_matches cm on cm.competition_id = mine.competition_id
      join public.matches m on m.id = cm.match_id
      where mine.user_id = profile_user_id
        and m.home_score is not null and m.away_score is not null
        and coalesce(public.match_lock_at(m.kickoff_at, m.kickoff_tbd)
                       > greatest(mine.joined_at, theirs.joined_at), true)
    ),
    pair_round as (
      -- Point pr. (modstander, runde, spiller). Hver side tæller de kampe, DEN
      -- selv har tippet — præcis samme semantik som h2h-blokken nedenfor og som
      -- round_standings, der heller ikke normaliserer for antal tippede kampe.
      -- Det er ikke en detalje: samme spørgsmål må ikke få to forskellige svar
      -- to steder i produktet (jf. tiebreaker- og Story Engine-leverancerne),
      -- og møde-tallene her skal stemme med H2H-linjen på den andens profil.
      select pm.rival_id, pm.round_key, pr.user_id,
        sum(public.pc_points(pr.pred_home, pr.pred_away, pm.home_score, pm.away_score))::int as pts
      from pair_matches pm
      join public.predictions pr
        on pr.match_id = pm.match_id
       and pr.user_id in (profile_user_id, pm.rival_id)
      where pr.pred_home is not null and pr.pred_away is not null
      group by pm.rival_id, pm.round_key, pr.user_id
    ),
    paired as (
      select a.rival_id, a.round_key, a.pts as my_pts, b.pts as their_pts
      from pair_round a
      join pair_round b
        on b.rival_id = a.rival_id and b.round_key = a.round_key
       and b.user_id = a.rival_id
      where a.user_id = profile_user_id
    ),
    tally as (
      select rival_id,
        count(*)::int                                   as meetings,
        count(*) filter (where my_pts > their_pts)::int  as wins,
        count(*) filter (where my_pts < their_pts)::int  as losses,
        count(*) filter (where my_pts = their_pts)::int  as draws
      from paired
      group by rival_id
    ),
    story_counts as (
      -- Historier beholdes som FARVE, aldrig som rangering. Joines på
      -- display_name, fordi det er alt, payloaden gemmer: skifter en bruger
      -- navn, mister de gamle historier tilknytningen. Acceptabelt for et
      -- pyntetal — og præcis derfor må rangeringen ikke hvile på det.
      select payload->>'rival' as name, count(*)::int as c
      from public.stories
      where user_id = profile_user_id
        and rule in ('H2H_PASS', 'STREAK')
        and payload->>'rival' is not null
      group by payload->>'rival'
    )
    -- Rangering: mindst forskel mellem sejre og nederlag = mest jævnbyrdig.
    -- Volumen alene ville ikke give rivaler, men blot den ældste medspiller i
    -- den største konkurrence; en rival er nogen, man veksler slag med. Flest
    -- møder bryder lighed, og rival_id sikrer et deterministisk svar ved to
    -- ellers identiske modstandere (samme disciplin som Story Engines laterale
    -- opslag, juli 2026).
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id',  x.rival_id,
             'rival',    x.display_name,
             'meetings', x.meetings,
             'wins',     x.wins,
             'losses',   x.losses,
             'draws',    x.draws,
             'stories',  x.stories
           ) order by x.ord), '[]'::jsonb)
    into v_rivals
    from (
      select t.rival_id, p.display_name, t.meetings, t.wins, t.losses, t.draws,
             coalesce(sc.c, 0) as stories,
             row_number() over (order by abs(t.wins - t.losses) asc,
                                         t.meetings desc,
                                         t.rival_id asc) as ord
      from tally t
      join public.profiles p on p.id = t.rival_id
      left join story_counts sc on sc.name = p.display_name
      where t.meetings >= v_rival_min_meetings
      order by ord
      limit 3
    ) x;
  end if;

  -- ---------- K4: H2H-narrativ (kun ved fremmed profil, delt konkurrence) ----------
  -- Bevidst, afgrænset undtagelse fra "H2H bor i Story Engine, ikke en
  -- sammenligningsside" (karriereprofil-v1.md) — ÉT narrativt punkt, ingen
  -- tabel, ingen historik-liste. pc_points() kaldes direkte (samme kilde som
  -- Story Engine/stillings-views, F2).
  -- Vises uanset om viewer fører eller taber (se K4-begrundelse i specen):
  -- kun viewer selv ser sætningen, tallene er allerede offentlige for delte
  -- konkurrencedeltagere via stillingerne, og Story Engines LEAD_LOST fortæller
  -- allerede den tabende part om nederlag i neutralt sprog.
  --
  -- "Et møde" = én runde (round_key), hvor begge har mindst ét scoret tip på
  -- en kamp fra en konkurrence, de deler (competition_participants — ikke
  -- valgfrit, jf. Story Engines deltager-afgrænsning). DEDUPLIKERET pr. kamp
  -- (30. juli 2026-rettelse): predictions er ét tip pr. bruger pr. KAMP, ikke
  -- pr. konkurrence, så hvis to brugere deler flere konkurrencer, der begge
  -- dækker samme kamp/runde (fx en rundebaseret + en full-season-konkurrence,
  -- der begge følger Superligaen), må rundens møde kun tælle ÉN gang — ellers
  -- viser "I har mødt hinanden 2 gange" efter kun én spillet runde.
  --
  -- OG BEGGE SIDERS NULPUNKT TÆLLER MED (G107, 14. august 2026): runden er kun
  -- et møde, hvis kampen låste, EFTER begge havde meldt sig til den delte
  -- konkurrence. Uden leddet kunne sætningen tælle runder, hvor den ene slet
  -- ikke var med endnu — og svare noget andet end den stilling, begge kan se i
  -- appen. Samme led og samme begrundelse som i `rival`-blokken ovenfor, og de
  -- to SKAL rettes sammen: `rivals`-posten om en person og H2H-linjen på den
  -- persons profil er den samme påstand set fra hver sin side (spec'ens
  -- testcase 41, invariant).
  if not v_own then
    with shared_comp as (
      -- Begge tilmeldingstidspunkter bæres med ud: `cp1` er beskueren,
      -- `cp2` er profilens ejer.
      select cp1.competition_id, cp1.joined_at as my_joined_at, cp2.joined_at as their_joined_at
      from public.competition_participants cp1
      join public.competition_participants cp2
        on cp2.competition_id = cp1.competition_id and cp2.user_id = profile_user_id
      where cp1.user_id = v_uid
    ),
    shared_matches as (
      -- distinct på match_id: samme kamp kan ligge i flere delte konkurrencer.
      -- Nulpunktet måles FØR dedup'en, så en kamp tæller, hvis den kvalificerer
      -- i mindst én af dem.
      select distinct cm.match_id, m.round_key, m.home_score, m.away_score
      from public.competition_matches cm
      join shared_comp sc on sc.competition_id = cm.competition_id
      join public.matches m on m.id = cm.match_id
      where m.home_score is not null and m.away_score is not null
        and coalesce(public.match_lock_at(m.kickoff_at, m.kickoff_tbd)
                       > greatest(sc.my_joined_at, sc.their_joined_at), true)
    ),
    rp as (
      select sm.round_key, pr.user_id,
        sum(public.pc_points(pr.pred_home, pr.pred_away, sm.home_score, sm.away_score))::int as pts
      from shared_matches sm
      join public.predictions pr on pr.match_id = sm.match_id and pr.user_id in (v_uid, profile_user_id)
      where pr.pred_home is not null and pr.pred_away is not null
      group by sm.round_key, pr.user_id
    ),
    paired as (
      select a.round_key, a.pts as my_pts, b.pts as their_pts
      from rp a
      join rp b on b.round_key = a.round_key
        and a.user_id = v_uid and b.user_id = profile_user_id
    )
    select case when count(*) = 0 then null else jsonb_build_object(
      'meetings', count(*)::int,
      'wins',     count(*) filter (where my_pts > their_pts)::int,
      'losses',   count(*) filter (where my_pts < their_pts)::int,
      'draws',    count(*) filter (where my_pts = their_pts)::int
    ) end
    into v_h2h
    from paired;
  end if;

  select jsonb_build_object(

    -- ---------- Hoved ----------
    'head', jsonb_build_object(
      'user_id',      profile_user_id,
      'display_name', (select display_name from public.profiles where id = profile_user_id),
      'created_at',   (select created_at   from public.profiles where id = profile_user_id),
      'rating',       (select round(rating)::int from public.ratings where user_id = profile_user_id and scope = 'ALL'),
      'provisional',  (select provisional  from public.ratings where user_id = profile_user_id and scope = 'ALL'),
      'rounds_played',(select rounds_played from public.ratings where user_id = profile_user_id and scope = 'ALL'),
      'move', (select round(delta)::int from public.rating_history
               where user_id = profile_user_id and scope = 'ALL'
               order by round_key desc limit 1)
    ),

    -- ---------- Titler ----------
    'titles', jsonb_build_object(
      -- Månedstitler: afsluttede måneder (alle kampe spillet) hvor brugeren er nr. 1.
      -- rank() frem for distinct on: en delt titel er en titel for BEGGE — samme
      -- regel som kåringen på Championship-fanen. Rangen bruger hele tiebreaker-
      -- stigen (sql/standings_tiebreakers.sql, src/lib/standings.js).
      'monthly', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'month',      mw.month,
                 'month_name', months[cast(substring(mw.month from 6 for 2) as int)] || ' ' || substring(mw.month from 1 for 4),
                 'points',     mw.total_points
               ) order by mw.month desc), '[]'::jsonb)
        from (
          select ms.month, ms.user_id, ms.total_points,
            rank() over (partition by ms.month
                         order by ms.total_points desc, ms.exact_count desc, ms.outcome_count desc,
                                  ms.round_wins desc, ms.avg_goal_error asc) as rnk
          from public.monthly_standings ms
          -- Komplethedsjoinet er afgrænset til de OFFICIELLE turneringer (G62,
          -- august 2026). Uden joinet grupperede den `public.matches` frit, mens
          -- pointene ved siden af kommer fra `scope = 'ALL'`, som kun tæller
          -- officielle — altså havde udløseren og indholdet forskellig
          -- afgrænsning. Følgen var, at én uspillet skotsk kamp kunne
          -- tilbageholde en global månedstitel, brugeren havde vundet på kampe,
          -- der intet havde med Scotland at gøre. Titlen forsvandt ikke, den
          -- blev bare aldrig vist, og der var intet sted at aflæse symptomet.
          -- Samme fejlklasse som G9/G10; by_tournament nedenfor gjorde det
          -- rigtigt fra dag ét, de tre samlede grene blev bare ikke rettet med.
          join (
            select to_char(date_trunc('month', m.kickoff_at), 'YYYY-MM') as month
            from public.matches m
            join public.seasons s on s.id = m.season_id
            join public.leagues l on l.id = s.league_id and l.is_official
            group by 1
            having bool_and(m.home_score is not null and m.away_score is not null)
          ) mc on mc.month = ms.month
          where ms.scope = 'ALL'
        ) mw
        where mw.user_id = profile_user_id and mw.rnk = 1
      ),
      -- Sæsontitler: Championship har TRE kåringer (runde, måned, sæson), men
      -- karrieren registrerede kun to — den største af dem ville aldrig stå
      -- nogen steder, når sæsonen sluttede. Samme regler som månedstitlen:
      -- kun AFSLUTTEDE sæsoner (alle kampe spillet), rank() frem for distinct on
      -- (delt titel er en titel for begge), fuld tiebreaker-stige inkl.
      -- round_wins — season_standings har alle stigens kolonner.
      -- season_id kan være null på en kamp; join'et til seasons filtrerer dem
      -- ud, og null matcher aldrig i sc-join'et.
      'season', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'season_id',   sw.season_id,
                 'season_name', sw.name,
                 'points',      sw.total_points
               ) order by sw.start_date desc nulls last, sw.name desc), '[]'::jsonb)
        from (
          select ss.season_id, ss.user_id, ss.total_points, s.name, s.start_date,
            rank() over (partition by ss.season_id
                         order by ss.total_points desc, ss.exact_count desc, ss.outcome_count desc,
                                  ss.round_wins desc, ss.avg_goal_error asc) as rnk
          from public.season_standings ss
          join public.seasons s on s.id = ss.season_id
          join (
            select season_id
            from public.matches
            where season_id is not null
            group by season_id
            having bool_and(home_score is not null and away_score is not null)
          ) sc on sc.season_id = ss.season_id
        ) sw
        where sw.user_id = profile_user_id and sw.rnk = 1
      ),
      -- Rundesejre: antal afsluttede runder (alle kampe spillet) hvor brugeren er nr. 1.
      -- Én runde har ingen rundesejre at bryde lighed med, så stigen stopper ved
      -- målafvigelsen. Delt sejr tæller for alle.
      'round_wins', (
        select count(*)::int
        from (
          select rs.round_key, rs.user_id,
            rank() over (partition by rs.round_key
                         order by rs.total_points desc, rs.exact_count desc, rs.outcome_count desc,
                                  rs.avg_goal_error asc) as rnk
          from public.round_standings rs
          -- Kun officielle turneringer afgør, om runden er færdig (G62) — samme
          -- begrundelse som ved månedstitlen ovenfor: udløseren skal have samme
          -- afgrænsning som det, den udløser, og pointene kommer fra scope 'ALL'.
          join (
            select m.round_key
            from public.matches m
            join public.seasons s on s.id = m.season_id
            join public.leagues l on l.id = s.league_id and l.is_official
            group by m.round_key
            having bool_and(m.home_score is not null and m.away_score is not null)
          ) rc on rc.round_key = rs.round_key
          -- Kun den SAMLEDE rundechampionship. round_standings har siden
          -- sql/tournament_scope.sql også en række pr. turnering, og uden dette
          -- filter ville én rundesejr tælle to gange (samlet + i sin turnering).
          -- Per-turnering-titler hører til i titles.by_tournament, ikke her.
          where rs.scope = 'ALL'
        ) rr
        where rr.user_id = profile_user_id and rr.rnk = 1
      ),

      -- ---------- Per-turnering-titler (K2, 31. juli 2026) ----------
      -- Championship kårer på to niveauer (sql/tournament_scope.sql). Grenene
      -- ovenfor er og forbliver KUN de samlede, så "Månedens Champion ×5"
      -- betyder det samme før og efter turnering #3 — et karrieretal, hvis
      -- betydning skifter, når produktet vokser, kan ikke sammenlignes med sig
      -- selv. Per-turnering-sejre tælles derfor med, men i deres egen gren, som
      -- profilskærmen viser som en adskilt gruppe.
      --
      -- Kun turneringer, hvor brugeren FAKTISK har vundet noget, kommer med:
      -- ellers ville hver ny turnering give enhver profil endnu en tom
      -- overskrift. Rækkefølgen er ældste turnering først — samme regel som
      -- vælgeren i ChampionshipTab (pickSeasonLeague), så to skærme ikke
      -- sorterer det samme forskelligt.
      --
      -- Bemærk komplethedsjoinene: en måned/runde er afsluttet PR. TURNERING.
      -- Superligaens månedstitel må ikke afvente en skotsk kamp, der ikke er
      -- spillet — det ville lade en fremmed turnering holde en titel tilbage.
      'by_tournament', (
        select coalesce(jsonb_agg(t.entry order by t.created_at), '[]'::jsonb)
        from (
          select l.created_at, jsonb_build_object(
            'league_id',   l.id,
            'league_name', l.name,
            'monthly', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'month',      mw.month,
                       'month_name', months[cast(substring(mw.month from 6 for 2) as int)] || ' ' || substring(mw.month from 1 for 4),
                       'points',     mw.total_points
                     ) order by mw.month desc), '[]'::jsonb)
              from (
                select ms.month, ms.user_id, ms.total_points,
                  rank() over (partition by ms.month
                               order by ms.total_points desc, ms.exact_count desc, ms.outcome_count desc,
                                        ms.round_wins desc, ms.avg_goal_error asc) as rnk
                from public.monthly_standings ms
                join (
                  select to_char(date_trunc('month', m.kickoff_at), 'YYYY-MM') as month
                  from public.matches m
                  join public.seasons s on s.id = m.season_id
                  where s.league_id = l.id
                  group by 1
                  having bool_and(m.home_score is not null and m.away_score is not null)
                ) mc on mc.month = ms.month
                where ms.scope = l.id::text
              ) mw
              where mw.user_id = profile_user_id and mw.rnk = 1
            ),
            'round_wins', (
              select count(*)::int
              from (
                select rs.round_key, rs.user_id,
                  rank() over (partition by rs.round_key
                               order by rs.total_points desc, rs.exact_count desc, rs.outcome_count desc,
                                        rs.avg_goal_error asc) as rnk
                from public.round_standings rs
                join (
                  select m.round_key
                  from public.matches m
                  join public.seasons s on s.id = m.season_id
                  where s.league_id = l.id
                  group by m.round_key
                  having bool_and(m.home_score is not null and m.away_score is not null)
                ) rc on rc.round_key = rs.round_key
                where rs.scope = l.id::text
              ) rr
              where rr.user_id = profile_user_id and rr.rnk = 1
            )
          ) as entry
          from public.leagues l
          where l.is_official
        ) t
        where jsonb_array_length(t.entry->'monthly') > 0
           or (t.entry->>'round_wins')::int > 0
      )
    ),

    -- ---------- Ratingkurve (én prik pr. runde) ----------
    -- Provisorisk periode (de første <5 runder) markeres frontend-side.
    'curve', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'round_key',    round_key,
               'rating_after', round(rating_after)::int
             ) order by round_key), '[]'::jsonb)
      from public.rating_history
      where user_id = profile_user_id and scope = 'ALL'
    ),

    -- ---------- Basistal (samme 3/1-kilde som stillingerne) ----------
    'base', (
      select jsonb_build_object(
        'total_points', coalesce(sum(case
              when pr.pred_home = m.home_score and pr.pred_away = m.away_score then 3
              when sign((pr.pred_home - pr.pred_away)::double precision) = sign((m.home_score - m.away_score)::double precision) then 1
              else 0 end), 0)::int,
        'exact_count', coalesce(sum(case
              when pr.pred_home = m.home_score and pr.pred_away = m.away_score then 1
              else 0 end), 0)::int,
        'outcome_count', coalesce(sum(case
              when not (pr.pred_home = m.home_score and pr.pred_away = m.away_score)
                   and sign((pr.pred_home - pr.pred_away)::double precision) = sign((m.home_score - m.away_score)::double precision) then 1
              else 0 end), 0)::int,
        'matches', count(*)::int
      )
      from public.predictions pr
      join public.matches m on m.id = pr.match_id
      where m.home_score is not null and m.away_score is not null
        and pr.pred_home is not null and pr.pred_away is not null
        and pr.user_id = profile_user_id
    ),

    -- ---------- H2H (kun fremmed profil, delt konkurrence) ----------
    'h2h', v_h2h,

    -- ---------- Rekorder ("bedste nogensinde") ----------
    -- Offentlig som titler/kurve/basistal — al data er allerede synlig andetsteds
    -- (peak rating er et punkt i den offentlige kurve, rundeplacering er afledt
    -- af samme offentlige round_standings som titles.round_wins). Samme rank()-
    -- stige som round_wins ovenfor — ingen parallel pointberegning (F2).
    'records', (
      with rr as (
        select rs.round_key, rs.user_id, rs.total_points, rs.exact_count,
          rank() over (partition by rs.round_key
                       order by rs.total_points desc, rs.exact_count desc, rs.outcome_count desc,
                                rs.avg_goal_error asc) as rnk,
          -- Feltstørrelsen for runden: hvor mange spillere placeringen blev sat imod.
          -- "8. plads" alene siger intet om, hvor stærk præstationen var — og var
          -- netop den linje, en bruger læste som en placering i én af sine EGNE
          -- konkurrencer (30. juli 2026). Rundechampionshippet er global, så feltet er
          -- alle brugere med mindst ét scoret tip i runden — samme kreds som
          -- Championship-fanens rundechampionship viser.
          count(*) over (partition by rs.round_key) as field
        from public.round_standings rs
        -- Kun officielle turneringer afgør, om runden er færdig (G62) — samme
        -- begrundelse som ved titlerne ovenfor. Her koster skævheden en
        -- REKORD: "din bedste runde nogensinde" ville springe en runde over,
        -- hvor en uofficiel turnering havde en uspillet kamp.
        join (
          select m.round_key
          from public.matches m
          join public.seasons s on s.id = m.season_id
          join public.leagues l on l.id = s.league_id and l.is_official
          group by m.round_key
          having bool_and(m.home_score is not null and m.away_score is not null)
        ) rc on rc.round_key = rs.round_key
        -- Kun den samlede rundechampionship (sql/tournament_scope.sql). Uden filteret
        -- ville feltstørrelsen tælle hver spiller én gang pr. turnering, og
        -- "4. plads af 31" blive til "af 62".
        where rs.scope = 'ALL'
      ),
      mine as (
        select round_key, rnk, field, total_points, exact_count, (rnk = 1) as won
        from rr where user_id = profile_user_id
      ),
      -- "Din bedste runde nogensinde": flest point i én enkelt spillerunde.
      -- Den mest konkrete "bedste nogensinde", og den manglede helt. Kun
      -- AFSLUTTEDE runder indgår (rr's join), så tallet ikke vokser bagefter og
      -- gør en påstået rekord forældet, mens brugeren ser på den.
      -- Sammenligner kun brugeren med brugeren selv — ingen placering, ingen
      -- andre nævnt, så linjen kan vises uanset hvor i tabellen man står.
      best_round as (
        select total_points as pts, exact_count as ex, round_key
        from mine
        order by total_points desc, exact_count desc, round_key asc
        limit 1
      ),
      -- max(field): er samme bedste placering sat i flere runder, tælles den mod
      -- den STØRSTE kreds, spilleren slog den i. Aldrig misvisende — en større
      -- feltstørrelse kan kun gøre rangen mere, ikke mindre, imponerende.
      best_rank as (
        select rnk, count(*)::int as cnt, max(field)::int as field
        from mine group by rnk order by rnk asc limit 1
      ),
      streaks as (
        select count(*)::int as len
        from (
          select round_key, won,
            row_number() over (order by round_key)
            - row_number() over (partition by won order by round_key) as grp
          from mine
        ) g
        where won
        group by grp
      ),
      best_streak as (select coalesce(max(len), 0)::int as longest from streaks),
      peak_rating as (
        select rating_after, round_key
        from public.rating_history
        where user_id = profile_user_id and scope = 'ALL'
        order by rating_after desc, round_key asc
        limit 1
      )
      select jsonb_build_object(
        'best_rating',           (select round(rating_after)::int from peak_rating),
        'best_rating_round',     (select round_key from peak_rating),
        'best_round_points',       (select pts from best_round),
        'best_round_exact',        (select ex from best_round),
        'best_round_points_round', (select round_key from best_round),
        'best_round_rank',       (select rnk from best_rank),
        'best_round_rank_count', (select cnt from best_rank),
        'best_round_rank_field', (select field from best_rank),
        'longest_round_streak',  (select longest from best_streak)
      )
    ),

    -- ---------- Fodaftryk (ligaer/konkurrencer) ----------
    -- Offentligt bart antal, ingen navne. Arkiverede (hidden=true) liga-løse
    -- konkurrencer tælles med — hidden er et personligt ryddeflag, ikke
    -- "forladt konkurrencen".
    'footprint', jsonb_build_object(
      'leagues',      (select count(*)::int from public.group_members where user_id = profile_user_id),
      'competitions', (select count(*)::int from public.competition_participants where user_id = profile_user_id)
    ),

    -- ---------- Rivaler ----------
    'rivals', v_rivals,

    'is_own', v_own

  ) into result;

  return result;
end;
$$;


--
-- Name: create_group(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_group(p_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_navn  text := btrim(coalesce(p_name, ''));
  v_group public.groups%rowtype;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- De to skrivninger, der før var to kald. Rækkefølgen er uændret og stadig
  -- bindende — medlemsrækken har en fremmednøgle til ligaen — men den er nu
  -- ligegyldig for udfaldet: fejler den anden, ruller den første med.
  insert into public.groups (name, created_by)
  values (v_navn, v_uid)
  returning * into v_group;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, v_uid, 'admin');

  -- Hele rækken retur, `invite_code` inklusive. Det er ikke en lækage: modtageren
  -- er den, der lige har oprettet ligaen, og koden er dét, hun skal invitere med.
  -- `to_jsonb` frem for en håndskrevet nøgleliste, så en ny kolonne på `groups`
  -- følger med af sig selv — klienten fik før hele rækken fra PostgREST og skal
  -- have præcis det samme.
  return to_jsonb(v_group);
end;
$$;


--
-- Name: ensure_group_membership_for_participant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_group_membership_for_participant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id
  from public.competitions
  where id = new.competition_id;

  if v_group_id is not null then
    insert into public.group_members (group_id, user_id, role)
    values (v_group_id, new.user_id, 'member')
    on conflict (group_id, user_id) do nothing;
  end if;

  return new;
end;
$$;


--
-- Name: generate_daily_stories(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_daily_stories(p_day date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_round      date := public.round_key_of_date(p_day);
  v_round_text text := v_round::text;
  v_daylabel   text := to_char(p_day, 'DD.MM');
  v_threshold  int  := 45;   -- spec §5. Ukalibreret; se A35.
begin
  -- ---------- Rundens sidste dag: kun rundekortet ----------
  -- Dags-motoren springes over — ikke fordi den ville fejle, men fordi to kort
  -- samme dag er præcis det, v3 afskaffer. Bemærk `not exists ... > p_day`:
  -- afgørelsen bygger på om der er FLERE kampdage i runden, ikke på om runden
  -- er færdigspillet, så en udsat kamp senere i ugen holder dagen åben.
  --
  -- UDGANGEN STÅR FØR SLETNINGEN, og rækkefølgen er ikke fri (august 2026).
  -- Stod sletningen først, ville et gen-kald for en dag, der ER BLEVET rundens
  -- sidste kampdag — fordi en senere kamp blev flyttet eller aflyst — tømme
  -- dagen og returnere uden at skrive noget tilbage. Dagen ville stå tom for
  -- evigt, for dagsmotoren kører kun, når en dag BLIVER færdig. En tidlig
  -- udgang må aldrig efterlade mindre, end den fandt.
  if exists (select 1 from public.matches where round_key = v_round and match_day = p_day)
     and not exists (select 1 from public.matches where round_key = v_round and match_day > p_day)
  then
    return;
  end if;

  -- ---------- En dag, der stadig spilles, får intet kort ----------
  -- REGLEN HAR ALTID VÆRET PRODUKTETS, MEN LÅ IKKE HER (august 2026). Kravet
  -- "dagens sidste kamp er færdigspillet" stod ét eneste sted: matches-triggeren
  -- i sql/rating_trigger_optimization.sql, som spørger `match_day_complete()`
  -- FØR den kalder herind. Motoren selv spurgte aldrig.
  --
  -- Det holdt, så længe triggeren var eneste vej ind. Det er den ikke: motoren
  -- har fem kaldere — triggeren, bagstopperen `generate_stories_catchup()`,
  -- story_engine_v2_backfill.sql, story_engine_v2_measure.sql og manuelle kald.
  -- Fire af dem tjekker selv. Bagstopperen gjorde ikke, og dens dagsløkke
  -- filtrerer kun pr. KAMP (`home_score is not null`), så ÉN færdigspillet kamp
  -- kvalificerede hele dagen. Den kaldes ved hver notifikations-kørsel, altså
  -- hvert 15.-30. minut, og skrev derfor dagens kort midt på kampdagen med tal
  -- beregnet på en halv dag: `_sd_today` tæller de af dagens kampe, der HAR et
  -- resultat, ikke de kampe, dagen har. Aflæst på Hjem 9. august 2026, mens
  -- rundekortet lige under stod med LIVE og 2/4 spillet.
  --
  -- Grace-vinduet var det, der skjulte hullet: indtil 8. august så dagsløkken
  -- kun på dage ældre end `i dag − 2`, og sådan en dag er næsten altid komplet.
  -- Fjernelsen af vinduet var rigtig — den var bare begrundet med, at værnet lå
  -- her, og det gjorde det ikke. Nu gør det, og begrundelsen er blevet sand.
  --
  -- VÆRNET LIGGER I MOTOREN OG IKKE HOS KALDERNE, fordi en regel, hver kalder
  -- skal huske, er en regel, den femte kalder glemmer.
  --
  -- 🔴 SPØRGSMÅLET ER SIDEN A39 IKKE LÆNGERE BOOLSK (august 2026). `G92`s
  -- begrundelse ovenfor står ord for ord ved magt — værnet bor her og kun her —
  -- men `match_day_complete()` var GLOBAL: den krævede, at hver eneste kamp på
  -- dagen havde resultat, uanset turnering og uanset konkurrence. En bruger, hvis
  -- konkurrencer kun rører Superliga, ventede derfor på La Ligas kamp kl. 22:45,
  -- og ved en udsat eller uindberettet kamp ventede hun for evigt.
  --
  -- Det, der ændrer sig, er ikke HVOR reglen bor, men hvad den spørger om: ikke
  -- "er hele dagen færdig?" men "for HVEM er dagen færdig?". Svaret er en MÆNGDE
  -- og ikke et ja/nej — derfor ét opslag for alle brugere frem for ét pr. bruger.
  -- Afgrænsningen selv står i `public.user_day_scope()` (`#68`), og den er ALLE
  -- dagens kampe i mine konkurrencer, ikke kun dem jeg har tippet: kortet bærer
  -- stillingen og mini'en, og de flytter sig, når modstanderne får point.
  --
  -- `match_day_complete()` lever videre uden ændring. Den er stadig produktets
  -- ærlige globale begreb, den er grantet til `authenticated`, og
  -- story_engine_v2_backfill.sql og _measure.sql spørger den. Efter i dag er den
  -- bare ikke længere motorens spørgsmål.
  drop table if exists _sd_ready;
  create temporary table _sd_ready as
  select u.user_id, u.n_matches from public.users_with_complete_day(p_day) u;
  create unique index on _sd_ready (user_id);

  -- ---------- FRYSNINGEN: et udgivet kort skrives ikke om, fordi dagen voksede ----------
  -- Den personlige kampdag åbner et hul, den globale lukkede ved konstruktion:
  -- min dag kan VOKSE, efter mit kort er skrevet. Tre veje derhen, og alle tre
  -- er menneskehandlinger — jeg opretter en konkurrence (lovligt indtil en time
  -- før kickoff), jeg melder mig ind i en, eller en anden melder sig ind i min.
  -- Efterfyldningen `api/_backfill.js` er derimod IKKE en vej ind: den håndhæver
  -- "en runde, der er gået i gang, vokser aldrig".
  --
  -- Kortet fryses, fordi det VAR sandt, da det blev skrevet. Det er samme
  -- semantik, overskriften allerede bærer ("Stillingen efter kampdag 03.08"):
  -- kortet er et snapshot, STILLING-fanen er live, og de to må gerne sige noget
  -- forskelligt, så længe kortet daterer sig selv. Alternativet — at skrive om —
  -- ville lade en afvisning genopstå og nulstille ulæst-prikken, hver gang nogen
  -- oprettede en konkurrence om aftenen.
  --
  -- `<` OG IKKE `<>`, og retningen er ikke en detalje: kun en VOKSENDE dag
  -- fryser. Bliver dagen mindre — jeg melder mig ud, eller en kamp udsættes ud af
  -- dagen — skal kortet skrives om, ellers ville et frosset kort på en dag, der
  -- ikke længere findes, stå for evigt. Frysningen skal være selvhelbredende.
  --
  -- `coalesce(..., r.n_matches)` gør et kort UDEN nøglen (skrevet før A39, eller
  -- af v2) til "ens" og dermed til noget, der skrives om én gang og derefter
  -- bærer nøglen. Alternativet ville fryse hvert eksisterende kort for evigt på
  -- et tal, der ikke findes.
  delete from _sd_ready r
  using public.stories s
  where s.period = 'day' and s.day_key = p_day
    and s.user_id = r.user_id
    and s.news_value is not null
    and coalesce((s.payload ->> 'day_scope_matches')::int, r.n_matches) < r.n_matches;

  -- UDGANGEN STÅR FØR SLETNINGEN, af samme grund som udgangen ovenfor: stod den
  -- efter, ville et kald midt på kampdagen tømme dagen og returnere uden at
  -- skrive noget tilbage.
  --
  -- DEN ER IKKE EN TREDJE KORT-UDGANG. Advarslen i filens hoved — "en TREDJE
  -- udgang herfra ville bryde det" — handler om de to UDGIVENDE grene, som
  -- frontendens `priority < 180` hviler på. En udgang, der intet skriver, rører
  -- ikke den invariant, lige så lidt som sidste-dag-udgangen gør det. Påstand 14
  -- i sql/tests/story_engine_daily.sql er stedet, det ville blive opdaget.
  if not exists (select 1 from _sd_ready) then
    drop table if exists _sd_ready;
    return;
  end if;

  -- 🔴 IDEMPOTENSEN ER FLYTTET TIL BUNDEN OG BLEVET ET FORLIG (A39). v2 og v3
  -- slettede her dagens rækker med `delete … where period = 'day' and day_key =
  -- p_day` — "den farligste linje" — og skrev dem igen. Den linje kan ikke blive
  -- stående efter A39, og der er to grunde, hvor den anden er den alvorlige:
  --
  --   1) Sletningen var GLOBAL over dagen. Kørte motoren kl. 22, fordi bruger B's
  --      dag netop blev færdig, ville den slette det kort, bruger A fik kl. 16.
  --   2) Motoren kører nu ved HVERT resultat, der gør nogens dag færdig — fire-
  --      fem gange på en stor lørdag frem for én. En bruger, hvis tal ikke har
  --      flyttet sig siden kl. 16, ville få nyt `id`, nyt `created_at` og et tabt
  --      `dismissed_at` ved hver af dem. Frysningen fanger det IKKE: hendes dag
  --      voksede jo ikke.
  --
  -- Se forliget nederst i funktionen. Her står kun, at der bevidst ikke slettes
  -- noget på dette sted længere.

  -- ---------- fakta (uændret fra v2) ----------
  drop table if exists _sd_pts;
  create temporary table _sd_pts as
  select * from public.competition_match_points where match_day <= p_day;
  create index on _sd_pts (competition_id, user_id);
  create index on _sd_pts (competition_id, match_id);

  drop table if exists _sd_size;
  create temporary table _sd_size as
  select competition_id, count(*)::int as n
  from public.competition_participants group by competition_id;

  drop table if exists _sd_today;
  create temporary table _sd_today as
  select competition_id, user_id,
         sum(pts)::int                               as pts,
         count(*)::int                               as matches,
         (count(*) filter (where pts = 3))::int      as exact_count,
         (count(*) filter (where pts = 1))::int      as outcome_count,
         (count(*) filter (where goal_err = 1))::int as near_misses
  from _sd_pts where match_day = p_day
  group by competition_id, user_id;
  -- Indekserne på _sd_today/_sd_after/_sd_before findes ikke i v2 og er ikke
  -- pynt: v3 slår op i dem PR. MODTAGER (nærhed, størrelse, den hårde
  -- no-tips-regel), hvor v2 kun scannede dem sekventielt én gang pr. regel.
  -- Uden dem stiger dagsmotorens forhold til referencen recompute_ratings(),
  -- og det er præcis det, acceptkriterie 10 forbyder.
  create index on _sd_today (user_id);
  create index on _sd_today (competition_id, user_id);

  -- Kumulativ stilling EFTER og FØR dagen, med HELE tiebreaker-stigen — identisk
  -- med sql/tournament_scope.sql, src/lib/standings.js og generate_stories.
  drop table if exists _sd_after;
  create temporary table _sd_after as
  select competition_id, user_id, sum(pts)::int as pts,
    rank() over (partition by competition_id
                 order by sum(pts) desc,
                          (count(*) filter (where pts = 3)) desc,
                          (count(*) filter (where pts = 1)) desc,
                          round(sum(goal_err)::numeric / count(*), 4) asc)::int as rnk
  from _sd_pts group by competition_id, user_id;
  create index on _sd_after (competition_id, user_id);
  create index on _sd_after (user_id);

  drop table if exists _sd_before;
  create temporary table _sd_before as
  select competition_id, user_id, sum(pts)::int as pts,
    rank() over (partition by competition_id
                 order by sum(pts) desc,
                          (count(*) filter (where pts = 3)) desc,
                          (count(*) filter (where pts = 1)) desc,
                          round(sum(goal_err)::numeric / count(*), 4) asc)::int as rnk
  from _sd_pts where match_day < p_day group by competition_id, user_id;
  create index on _sd_before (competition_id, user_id);

  -- ---------- STØRRELSE (0–30), spec §4 ----------
  -- Tre bidrag, hver med sit eget loft, summen loftet ved 30. Størrelsen hører
  -- til HÆNDELSEN og dermed til hovedpersonen — ikke til modtageren. Den
  -- beregnes derfor én gang pr. (hovedperson, konkurrence) og slås op, frem for
  -- at blive gentaget i otte kandidat-inserts, hvor et tal kunne drive.
  --
  -- Placeringsændringen er ABSOLUT: et fald er lige så meget drama som en
  -- fremgang. Tonen ligger i teksten, ikke i scoringen.
  drop table if exists _sd_avg;
  create temporary table _sd_avg as
  select competition_id, avg(pts)::numeric as avg_pts
  from _sd_today group by competition_id;

  drop table if exists _sd_mag;
  create temporary table _sd_mag as
  select t.competition_id, t.user_id,
    least(18, 6 * abs(coalesce(b.rnk, a.rnk) - a.rnk))::int                    as move_pts,
    least(12, (3 * floor(greatest(0, t.pts - av.avg_pts)))::int)::int          as over_pts
  from _sd_today t
  join _sd_after a  on a.competition_id  = t.competition_id and a.user_id = t.user_id
  left join _sd_before b on b.competition_id = t.competition_id and b.user_id = t.user_id
  join _sd_avg av   on av.competition_id = t.competition_id;
  create index on _sd_mag (competition_id, user_id);

  -- Stimen beregnes ÉN gang og bruges to steder: som regel 140's indhold og som
  -- størrelsesbidrag for enhver af brugerens kandidater. Katalogets dyre regel
  -- (fuld historik-scanning, to vinduesfunktioner) skal ikke køre to gange.
  drop table if exists _sd_streak;
  create temporary table _sd_streak as
  with hist as (
    select pr.user_id, m.kickoff_at, m.match_day, m.id as match_id,
           (public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) >= 1) as hit
    from public.predictions pr
    join public.matches m on m.id = pr.match_id
    join public.seasons s on s.id = m.season_id
    join public.leagues l on l.id = s.league_id and l.is_official
    where m.home_score is not null and m.away_score is not null
      and pr.pred_home is not null and pr.pred_away is not null
      and m.match_day <= p_day
  ),
  grp as (
    select *,
      row_number() over (partition by user_id order by kickoff_at, match_id)
      - row_number() over (partition by user_id, hit order by kickoff_at, match_id) as g
    from hist
  ),
  runs as (
    select user_id, hit, g, count(*)::int as len,
           max(match_day) as ended_day,
           max(kickoff_at) as run_last,
           max(max(kickoff_at)) over (partition by user_id) as last_kick
    from grp group by user_id, hit, g
  )
  select user_id, len, (run_last = last_kick) as alive
  from runs
  where hit and len >= 5 and ended_day = p_day;
  create index on _sd_streak (user_id);

  -- ---------- kandidater ----------
  -- `base` er grundvægten (spec §4). `priority` er kun visnings-metadata.
  -- headline3/body3 er tredjepersons-varianten og er null for de personlige
  -- regler — er den null, kan kandidaten pr. konstruktion ikke nå en fremmed.
  drop table if exists _sd_cand;
  create temporary table _sd_cand (
    cid            bigserial primary key,
    subject_id     uuid not null,
    competition_id uuid,
    rule           text not null,
    priority       int  not null,
    base           int  not null,
    league_size    int,
    payload        jsonb not null,
    headline       text not null,
    body           text not null,
    headline3      text,
    body3          text
  );

  -- ======== 180 · Dagens facit (grundvægt 8) ========
  -- Ankeret, og efter v3 ALTID dæmpet: 8 + 12 + 20 = 40 kan ikke nå 45. Den
  -- findes for at være dagens fald-tilbage og for at bidrage til news_value.
  -- Ingen emoji — emoji er højdepunktets signal (v1.1), og et facit er ikke et
  -- højdepunkt.
  --
  -- TONEREGLEN ("driller, ydmyger aldrig"): placeringen nævnes KUN i den
  -- øverste halvdel af tabellen. Nederst står afstanden op til toppen.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body)
  select t.user_id, t.competition_id, 'DAY_RESULT', 180, 8, sz.n,
    jsonb_build_object('points', t.pts, 'matches', t.matches, 'exact', t.exact_count,
                       'rank', a.rnk, 'total', sz.n, 'moved', coalesce(b.rnk - a.rnk, 0),
                       'gap', top.pts - a.pts, 'league', c.name),
    'Dagens facit: ' || t.pts || ' point',
    t.matches || case when t.matches = 1 then ' kamp' else ' kampe' end ||
      ' i ' || c.name ||
      case when t.exact_count > 0
           then ' — ' || t.exact_count || case when t.exact_count = 1 then ' præcis.' else ' præcise.' end
           else '.' end ||
      case
        when b.rnk is not null and b.rnk > a.rnk
          then ' Du rykkede fra nr. ' || b.rnk || ' til nr. ' || a.rnk || '.'
        when a.rnk * 2 <= sz.n
          then ' Du sluttede dagen som nr. ' || a.rnk || ' af ' || sz.n || '.'
        when (top.pts - a.pts) > 0
          then ' Toppen var ' || (top.pts - a.pts) || ' point væk.'
        else ''
      end
  from _sd_today t
  join _sd_size sz on sz.competition_id = t.competition_id
  join public.competitions c on c.id = t.competition_id
  join _sd_after a on a.competition_id = t.competition_id and a.user_id = t.user_id
  left join _sd_before b on b.competition_id = t.competition_id and b.user_id = t.user_id
  join lateral (select pts from _sd_after a2
                where a2.competition_id = t.competition_id and a2.rnk = 1
                order by a2.user_id limit 1) top on true
  where t.matches >= 1;

  -- ======== 120 · Kontrarian (grundvægt 32, FAN-OUT) ========
  -- Præcis ÉN deltager ramte udfaldet — blandt mindst fire, der tippede kampen.
  -- Tærsklen er hele reglen: i en 3-mands konkurrence er "den eneste" støj.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body, headline3, body3)
  select w.user_id, w.competition_id, 'CONTRARIAN', 120, 32, sz.n,
    jsonb_build_object('team', w.pick, 'home', w.home, 'away', w.away,
                       'score', w.hs || '-' || w.away_s, 'others', w.n_pred - 1,
                       'points', w.pts, 'draw', w.is_draw, 'league', c.name,
                       'subject', pr.display_name),
    case when w.is_draw
         then '🧠 Du var den eneste, der troede på uafgjort i ' || w.home || '–' || w.away
         else '🧠 Du var den eneste, der troede på ' || w.pick end,
    'I ' || c.name || ' havde ' || (w.n_pred - 1) ||
      case when w.n_pred - 1 = 1 then ' anden' else ' andre' end ||
      ' tippet imod. Det endte ' || w.home || ' ' || w.hs || '-' || w.away_s || ' ' || w.away ||
      ' — ' || w.pts || ' point til dig.',
    case when w.is_draw
         then '🧠 ' || pr.display_name || ' var den eneste, der troede på uafgjort i ' || w.home || '–' || w.away
         else '🧠 ' || pr.display_name || ' var den eneste, der troede på ' || w.pick end,
    'I ' || c.name || ' tippede ' || (w.n_pred - 1) ||
      case when w.n_pred - 1 = 1 then ' anden' else ' andre' end ||
      ' imod. Det endte ' || w.home || ' ' || w.hs || '-' || w.away_s || ' ' || w.away ||
      ' — ' || w.pts || ' point til ' || pr.display_name || '.'
  from (
    select p.competition_id, p.match_id, p.user_id, p.pts,
           m.home_score as hs, m.away_score as away_s,
           th.name as home, ta.name as away,
           (m.home_score = m.away_score) as is_draw,
           case when m.home_score > m.away_score then th.name
                when m.home_score < m.away_score then ta.name
                else 'uafgjort' end as pick,
           -- SKALAR SUBQUERY, ikke `count(*) over (partition by ...)`:
           -- vinduesfunktioner beregnes EFTER where-klausulen, og da den
           -- filtrerer til `pts >= 1`, ville vinduet tælle netop de træffere,
           -- vi allerede ved der kun er én af — n_pred blev 1, tærsklen `>= 4`
           -- kunne aldrig opfyldes, og reglen udløste dermed aldrig.
           (select count(*) from _sd_pts q2
            where q2.competition_id = p.competition_id and q2.match_id = p.match_id) as n_pred
    from _sd_pts p
    join public.matches m on m.id = p.match_id
    join public.teams th on th.id = m.home_team_id
    join public.teams ta on ta.id = m.away_team_id
    where p.match_day = p_day and p.pts >= 1
      and 1 = (select count(*) from _sd_pts q
               where q.competition_id = p.competition_id
                 and q.match_id = p.match_id and q.pts >= 1)
  ) w
  join _sd_size sz on sz.competition_id = w.competition_id
  join public.competitions c on c.id = w.competition_id
  join public.profiles pr on pr.id = w.user_id
  where w.n_pred >= 4;

  -- ======== 125 · Kollektiv fiasko (grundvægt 24) ========
  -- Personlig i fan-out-forstand: modtageren var SELV en af dem, der missede,
  -- så hovedpersonen er modtageren, og nærheden er 20. Med 24 + 20 = 44 lander
  -- den bevidst ét point under tærsklen: en fælles fiasko alene er dagens
  -- facit, men sammen med bevægelse i tabellen bliver den en historie.
  --
  -- `distinct on` er bærende: uden det giver en dårlig dag fire ens kandidater
  -- pr. bruger.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body)
  select distinct on (p.competition_id, p.user_id)
    p.user_id, p.competition_id, 'COLLECTIVE_MISS', 125, 24, sz.n,
    jsonb_build_object('home', th.name, 'away', ta.name,
                       'score', m.home_score || '-' || m.away_score,
                       'n', (select count(*) from _sd_pts q
                             where q.competition_id = p.competition_id and q.match_id = p.match_id),
                       'league', c.name),
    '🙈 Ingen ramte ' || th.name || '–' || ta.name,
    (select count(*) from _sd_pts q
     where q.competition_id = p.competition_id and q.match_id = p.match_id) ||
      ' tippede kampen i ' || c.name || '. Den endte ' ||
      m.home_score || '-' || m.away_score || ' — og ingen havde den.'
  from _sd_pts p
  join public.matches m on m.id = p.match_id
  join public.teams th on th.id = m.home_team_id
  join public.teams ta on ta.id = m.away_team_id
  join _sd_size sz on sz.competition_id = p.competition_id
  join public.competitions c on c.id = p.competition_id
  where p.match_day = p_day
    and 4 <= (select count(*) from _sd_pts q
              where q.competition_id = p.competition_id and q.match_id = p.match_id)
    and 0 = (select count(*) from _sd_pts q
             where q.competition_id = p.competition_id and q.match_id = p.match_id and q.pts >= 1)
  order by p.competition_id, p.user_id, p.match_id;

  -- ======== 130 · Dagens højeste (grundvægt 34, FAN-OUT) ========
  -- Vinder-sættet skal være MINDRE end feltet — ellers kåres alle på en dag,
  -- hvor samtlige deltagere fik det samme.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body, headline3, body3)
  select w.user_id, w.competition_id, 'DAY_TOP', 130, 34, sz.n,
    jsonb_build_object('points', w.pts, 'exact', w.exact_count,
                       'shared', w.n_top > 1, 'others', w.n_top - 1, 'league', c.name,
                       'subject', pr.display_name),
    '🔝 Du fik dagens højeste i ' || c.name,
    w.pts || ' point — flest af alle i ' || c.name || ' den ' || v_daylabel ||
      case when w.n_top > 2 then ' (delt med ' || (w.n_top - 1) || ' andre).'
           when w.n_top = 2 then ' (delt med 1 anden).'
           else '.' end,
    '🔝 ' || pr.display_name || ' fik dagens højeste i ' || c.name,
    w.pts || ' point — flest af alle i ' || c.name || ' den ' || v_daylabel ||
      case when w.n_top > 2 then ' (delt med ' || (w.n_top - 1) || ' andre).'
           when w.n_top = 2 then ' (delt med 1 anden).'
           else '.' end
  from (
    select competition_id, user_id, pts, exact_count,
           count(*) over (partition by competition_id) as n_top,
           n_played
    from (
      select competition_id, user_id, pts, exact_count,
             rank() over (partition by competition_id
                          order by pts desc, exact_count desc, outcome_count desc) as rnk,
             count(*) over (partition by competition_id) as n_played
      from _sd_today where matches >= 2
    ) r where r.rnk = 1
  ) w
  join _sd_size sz on sz.competition_id = w.competition_id and sz.n >= 3
  join public.competitions c on c.id = w.competition_id
  join public.profiles pr on pr.id = w.user_id
  where w.pts > 0 and w.n_top < w.n_played;

  -- ======== 140 · Stime-status (global, grundvægt 28, FAN-OUT) ========
  -- Fyrer KUN, når stimen blev forlænget i dag eller brudt i dag. Uden den
  -- betingelse ville den udløses hver eneste dag, stimen lever.
  -- competition_id er null: stimen er global, og fan-out sker via enhver delt
  -- konkurrence (se _sd_reach).
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body, headline3, body3)
  select s.user_id, null, 'STREAK_STATUS', 140, 28, null,
    jsonb_build_object('n', s.len, 'alive', s.alive, 'subject', pr.display_name),
    case when s.alive then '🔥 ' || s.len || ' kampe i træk med point'
         else '💤 Din stime stoppede ved ' || s.len end,
    case when s.alive
         then 'Du har fået point i ' || s.len || ' kampe i træk. Stimen lever efter den ' || v_daylabel || '.'
         else 'Efter ' || s.len || ' kampe i træk med point brød stimen den ' || v_daylabel || '. En ny begynder i morgen.'
    end,
    case when s.alive then '🔥 ' || pr.display_name || ' har ' || s.len || ' kampe i træk med point'
         else '💤 ' || pr.display_name || 's stime stoppede ved ' || s.len end,
    case when s.alive
         then pr.display_name || ' har fået point i ' || s.len || ' kampe i træk. Stimen lever efter den ' || v_daylabel || '.'
         else 'Efter ' || s.len || ' kampe i træk med point brød ' || pr.display_name ||
              's stime den ' || v_daylabel || '.'
    end
  from _sd_streak s
  join public.profiles pr on pr.id = s.user_id;

  -- ======== 150 · Duel (grundvægt 30) ========
  -- `is distinct from` på afstanden er HELE reglen. Uden den fyrer duellen hver
  -- eneste dag med identisk tekst for alle i den øverste halvdel.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body)
  with lad as (
    select a.competition_id, a.user_id, a.pts,
           lag(a.user_id)  over w as above_id, lag(a.pts)  over w as above_pts,
           lead(a.user_id) over w as below_id, lead(a.pts) over w as below_pts
    from _sd_after a
    window w as (partition by a.competition_id order by a.rnk, a.user_id)
  ),
  pick as (
    select competition_id, user_id, pts,
           coalesce(above_id, below_id) as rival_id,
           (above_id is not null)       as is_above,
           case when above_id is not null then above_pts - pts
                else pts - below_pts end as gap
    from lad
    where coalesce(above_id, below_id) is not null
  ),
  duel as (
    -- Afstanden FØR dagen mellem de samme to personer. Er den uændret, er der
    -- ikke sket noget i dag, og så er der ingen historie. prev_gap = null (en af
    -- de to havde ingen point før i dag) tæller som "ændret".
    select p.*,
           case when p.is_above then br.pts - bu.pts else bu.pts - br.pts end as prev_gap
    from pick p
    left join _sd_before bu on bu.competition_id = p.competition_id and bu.user_id = p.user_id
    left join _sd_before br on br.competition_id = p.competition_id and br.user_id = p.rival_id
  )
  -- TEKSTEN ER I DATID (G89, 8. august 2026). Den stod i nutid — "Kun N point op
  -- til X", "X er N point efter dig", "Efter den 03.08 ER DER N point op til X" —
  -- og det er en påstand om NUET på et kort, der lever i 48 timer. Duellen kan
  -- være vendt dagen efter, mens kortet stadig ligger på Hjem og siger, hvordan
  -- det står. Præcis samme rettelse som A38 lavede for tre af runde-reglerne, og
  -- overskriften er skrevet efter regel 45's form: "Du sluttede runden N point
  -- fra toppen" → "Du sluttede dagen N point fra X".
  select d.user_id, d.competition_id, 'DUEL', 150, 30, sz.n,
    jsonb_build_object('rival', pr.display_name, 'gap', d.gap,
                       'above', d.is_above, 'league', c.name),
    case when d.is_above
         then '⚔️ Du sluttede dagen ' || d.gap || ' point fra ' || pr.display_name
         else '⚔️ ' || pr.display_name || ' endte ' || d.gap || ' point efter dig' end,
    case when d.is_above
         then 'Efter den ' || v_daylabel || ' var der ' || d.gap || ' point op til ' ||
              pr.display_name || ' i ' || c.name || '.'
         else 'Du førte ' || c.name || ' med ' || d.gap || ' point ned til ' ||
              pr.display_name || ' efter den ' || v_daylabel || '.' end
  from duel d
  join _sd_size sz on sz.competition_id = d.competition_id and sz.n >= 3
  join public.competitions c on c.id = d.competition_id
  join public.profiles pr on pr.id = d.rival_id
  where d.gap between 1 and 3
    and d.gap is distinct from d.prev_gap;

  -- ======== 160 · Så tæt på (grundvægt 18) ========
  -- goal_err = 1 er ~⅓ af alle tips, så ét nærmiss er ikke en historie. To er.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body)
  select t.user_id, t.competition_id, 'SO_CLOSE', 160, 18, sz.n,
    jsonb_build_object('n', t.near_misses, 'league', c.name),
    '😤 Ét mål fra ' || t.near_misses || ' eksakte',
    t.near_misses || ' af dine tips i ' || c.name || ' den ' || v_daylabel ||
      ' ramte målscoren på ét mål nær.'
  from _sd_today t
  join _sd_size sz on sz.competition_id = t.competition_id
  join public.competitions c on c.id = t.competition_id
  where t.near_misses >= 2;

  -- ======== 110 · Milepæl (grundvægt 100 — kaprer dagens slot) ========
  -- Milepæle får ALDRIG deres eget kort i køen (spec §6). De deltager i
  -- scoringen som enhver anden kandidat og vinder derfor altid.
  --
  -- TILKNYTNINGSDAGEN er `max(match_day) <= match_day(achieved_at)`: er
  -- milepælen uddelt på en kampdag, er det den dag; ellers den seneste kampdag
  -- før. Formlen er ORDRET DEN SAMME i apply_milestone_stories() nedenfor, og
  -- det er ikke en tilfældighed — det er dét, der gør, at en gen-kørsel af
  -- denne funktion GENSKABER en kapring, den lige har slettet. Ændres den ene,
  -- skal den anden ændres samtidig, ellers går sene milepæle tabt ved næste
  -- resultatrettelse.
  --
  -- Er der flere samme dag, vises den med højeste familie-rang og tier; resten
  -- ligger på karriereprofilen uden nogensinde at have været på Hjem. Ét slot
  -- ⇒ mængden kan ikke eksplodere, uanset hvor mange der udløses samtidigt.
  -- Rangordenen er MILESTONE_FAMILIES' egen (src/lib/milestones.js), spejlet.
  --
  -- headline/body er kun et FALDBACK. Klienten renderer altid milepælskort fra
  -- payload.milestone_key via renderMilestone() — teksten bor kun i JS, jf.
  -- milepaele-v1.md §8, og der er derfor ingen skabelon at holde i sync.
  insert into _sd_cand (subject_id, competition_id, rule, priority, base, league_size, payload, headline, body)
  select distinct on (m.user_id)
    m.user_id, m.competition_id, 'MILESTONE', 110, 100, sz.n,
    jsonb_build_object('milestone_key', m.key, 'milestone_payload', m.payload,
                       'family', m.family, 'tier', m.tier),
    'Ny milepæl', m.key
  from public.milestones m
  left join _sd_size sz on sz.competition_id = m.competition_id
  where (select max(mm.match_day) from public.matches mm
         where mm.match_day <= public.match_day(m.achieved_at)) = p_day
  order by m.user_id,
           case m.family when 'competition' then 0 when 'rating' then 1
                         when 'precision'  then 2 when 'community' then 3 else 4 end,
           m.tier desc, m.key asc;

  -- ---------- MODTAGERKREDSEN (fan-out) ----------
  -- Personlige regler når kun hovedpersonen. De tre fan-out-regler når alle,
  -- der DELER KONKURRENCE med hovedpersonen — designreglen håndhævet af joinet
  -- og ikke af en betingelse. En global kandidat (STREAK_STATUS) når via
  -- enhver delt konkurrence, og duplikaterne kollapses nedenfor med max().
  --
  -- 🔴 A39-FILTERET HØRER HER OG IKKE I `_sd_scored`. `_sd_reach` er stedet,
  -- hvor en kandidat bliver til en MODTAGER, og reglen "kun brugere, hvis egen
  -- dag er færdig" er en regel om modtagere. Lagt her ligger den i JOINET —
  -- samme form som konkurrence-afgrænsningen lige nedenfor — og nærhed, scoring
  -- og udvælgelse arbejder med et mindre sæt på enhver delvis dag, hvilket er
  -- dét, acceptkriterie 10 skal bruge.
  --
  -- ⚠️ FILTRENE ER INDBYRDES REDUNDANTE, OG DET SKAL STÅ HER FREM FOR AT BLIVE
  -- OPDAGET. `_sd_ready` joines fem steder: her (to gange), i hver af de tre
  -- udgivende grene. Mutationsforsøg viser, at ingen af dem er individuelt
  -- påviselig — fjernes ét, når resultatet stadig frem via de øvrige; fjernes
  -- alle fem, får hver eneste bruger et kort, og påstand 18c fanger det.
  --
  -- Redundansen er ikke sløseri, for hvert join har et ærinde mere: dette
  -- sparer arbejdet, de tre i grenene henter samtidig `n_matches` til
  -- frysningen, og no_tips-grenens er den eneste vej, fordi den slet ikke
  -- passerer `_sd_reach`. Men følgen er, at en test IKKE kan opdage, at ét af
  -- dem forsvinder. Fjerner du et join her, så fjern også det, der læser
  -- `rd.n_matches` — ellers står reglen halvt håndhævet, og intet siger fra.
  --
  -- Bemærk, at fakta-tabellerne ovenfor (`_sd_pts`, `_sd_after`, `_sd_before`,
  -- `_sd_size`, …) med vilje IKKE er afgrænset. De bærer stillingen, og
  -- stillingen i MIN konkurrence afhænger af modstandernes point, ikke af hvis
  -- dag der er færdig. Afgrænsningen sker på modtagerkredsen, ikke på
  -- datagrundlaget — og fordi den gør det, er den sammenhængende: er jeg i
  -- `_sd_ready`, har alle kampe i alle MINE konkurrencer resultat, så `_sd_after`
  -- for netop dem er regnet på en færdig dag. Mini-stillingen og `_sd_rival`
  -- læser kun gennem `via_competition`, som pr. konstruktion er en konkurrence,
  -- jeg deler med hovedpersonen, altså en af mine, altså en færdig. Intet kort
  -- kan komme til at bære et halvt regnet tal.
  drop table if exists _sd_reach;
  create temporary table _sd_reach (cid bigint, user_id uuid, via_competition uuid);

  insert into _sd_reach (cid, user_id, via_competition)
  select c.cid, c.subject_id, c.competition_id
  from _sd_cand c
  join _sd_ready rd on rd.user_id = c.subject_id
  where c.headline3 is null;

  insert into _sd_reach (cid, user_id, via_competition)
  select c.cid, cp.user_id, cs.competition_id
  from _sd_cand c
  join public.competition_participants cs on cs.user_id = c.subject_id
  join public.competition_participants cp on cp.competition_id = cs.competition_id
  join _sd_ready rd on rd.user_id = cp.user_id
  where c.headline3 is not null
    and (c.competition_id is null or cs.competition_id = c.competition_id);

  -- ---------- NÆRHED (0–20), spec §4 ----------
  -- Beregnes PR. MODTAGER, ikke pr. hændelse: samme kamp giver forskellige kort
  -- til forskellige brugere, og det er meningen. Det er også grunden til, at
  -- slottet er (user_id, day_key)-unikt og ikke (competition_id, day_key).
  --
  -- Modtagerens største liga (flest deltagere) — deterministisk tiebreak.
  drop table if exists _sd_big;
  create temporary table _sd_big as
  select distinct on (cp.user_id) cp.user_id, cp.competition_id
  from public.competition_participants cp
  join _sd_size sz on sz.competition_id = cp.competition_id
  order by cp.user_id, sz.n desc, cp.competition_id asc;
  create index on _sd_big (user_id);

  -- Naboerne i stillingen. Samme lag/lead-stige som DUEL — nærmeste rival er
  -- den, man deler grænse med, og ikke enhver inden for tre point.
  drop table if exists _sd_rival;
  create temporary table _sd_rival as
  select competition_id, user_id, rival_id from (
    select a.competition_id, a.user_id,
           lag(a.user_id)  over w as up_id,   lag(a.pts)  over w as up_pts,
           lead(a.user_id) over w as down_id, lead(a.pts) over w as down_pts,
           a.pts
    from _sd_after a
    window w as (partition by a.competition_id order by a.rnk, a.user_id)
  ) l
  cross join lateral (values (l.up_id, l.up_pts - l.pts), (l.down_id, l.pts - l.down_pts))
    as v(rival_id, gap)
  where v.rival_id is not null and v.gap between 0 and 3;
  create index on _sd_rival (user_id, rival_id);

  drop table if exists _sd_prox;
  create temporary table _sd_prox as
  select r.cid, r.user_id, max(
    case
      when r.user_id = c.subject_id then 20
      when exists (select 1 from _sd_rival rv
                   where rv.competition_id = r.via_competition
                     and rv.user_id = r.user_id and rv.rival_id = c.subject_id) then 14
      when r.via_competition = bg.competition_id then 8
      else 4
    end)::int as prox
  from _sd_reach r
  join _sd_cand c on c.cid = r.cid
  left join _sd_big bg on bg.user_id = r.user_id
  group by r.cid, r.user_id;

  -- ---------- SCORING ----------
  -- nyhedsværdi = grundvægt + størrelse + nærhed (spec §4).
  --
  -- TALLENE STÅR KUN HER (G78, 7. august 2026). Frem til da lå en kopi i
  -- src/lib/stories.js, som ingen del af appen kaldte — dens eneste aftagere
  -- var dens egne enhedstests. Kopien er slettet, og påstandene om de præcise
  -- news_value-tal står i sql/tests/story_engine_daily.sql, altså mod en
  -- rigtig PostgreSQL og ikke mod en genskrivning af beregningen.
  -- NEWS_VALUE BEREGNES I EN YDRE SELECT OG IKKE MED add column + update, og det
  -- er ikke en stilistisk omskrivning (8. august 2026). Den oprindelige form var
  --
  --     alter table _sd_scored add column news_value int;
  --     update _sd_scored set news_value = base + size_pts + prox;
  --
  -- og den sidste linje har ingen `where`. Supabase indlæser **pg_safeupdate**
  -- via `session_preload_libraries` på rollen `authenticator`, altså i enhver
  -- session, PostgREST åbner — og den afviser `UPDATE` uden `where` med
  -- `UPDATE requires a WHERE clause`. SQL-editoren forbinder som `postgres` og
  -- indlæser den ikke.
  --
  -- Følgen var, at dagsmotoren virkede, hver gang et menneske kaldte den i
  -- hånden, og fejlede HVER gang matches-triggeren kaldte den fra `sync-live` —
  -- tavst, fordi triggerens exception-guard slugte fejlen. v3's dagslag skrev
  -- derfor aldrig én eneste række i produktion mellem 7. og 8. august 2026.
  --
  -- `where true` ville ikke være en pålidelig rettelse: en konstant-sand qual
  -- kan planlæggeren folde væk, og så står sætningen igen uden qual. Kolonnen
  -- beregnes i stedet, hvor de tre led allerede findes, og så er der ingen
  -- `update` at afvise.
  drop table if exists _sd_scored;
  create temporary table _sd_scored as
  select sc.*, (sc.base + sc.size_pts + sc.prox)::int as news_value
  from (
  select px.user_id, c.cid, c.subject_id, c.competition_id, c.rule, c.priority,
         c.base, c.league_size, c.payload, c.headline, c.body, c.headline3, c.body3,
         -- MILESTONE får INTET størrelsesbidrag, og det er ikke en forglemmelse.
         -- En milepæl er en engangsbedrift; dens vægt er, at den er sket — ikke
         -- hvor mange pladser man tilfældigvis rykkede samme dag. Uden dette
         -- ville et milepælskort score forskelligt alt efter, om det blev
         -- skrevet af motoren (som kender dagens tal) eller af cron-kapringen
         -- (som ikke gør), og de to skal give SAMME række. news_value for en
         -- milepæl er derfor altid 100 + 20 = 120.
         case
           when c.rule = 'MILESTONE' then 0
           -- DAY_RESULT får KUN afstanden til dagens gennemsnit. Spec §5's
           -- regnestykke er et krav: 8 + 12 + 20 = 40 < 45, så dagens facit
           -- "kommer aldrig over tærsklen ved egen kraft ... det er en
           -- oplysning, ikke en historie". Med hele størrelsesloftet kunne den
           -- nå 58 og udgive sig selv som dagens historie — og så ville der
           -- aldrig findes en dag under tærsklen at falde tilbage til.
           when c.rule = 'DAY_RESULT' then coalesce(mg.over_pts, 0)
           else least(30, coalesce(mg.move_pts, 0) + coalesce(mg.over_pts, 0)
                        + least(12, 2 * greatest(0, coalesce(st.len, 0) - 5)))
         end::int as size_pts,
         px.prox
  from _sd_prox px
  join _sd_cand c on c.cid = px.cid
  left join _sd_mag mg on mg.competition_id = c.competition_id and mg.user_id = c.subject_id
  left join _sd_streak st on st.user_id = c.subject_id
  ) sc;

  create index on _sd_scored (user_id);

  -- HÅRD REGEL (acceptkriterie 8): en bruger uden ét eneste scoret tip på en
  -- kampdag får ALDRIG et drama-kort om andre. Uden denne linje kunne et
  -- fan-out-kort (34 + 20 = 54) lande hos en, der slet ikke var med.
  delete from _sd_scored s
  where not exists (select 1 from _sd_today t where t.user_id = s.user_id);

  -- ---------- UDVÆLGELSEN: én vinder pr. modtager ----------
  -- Afgørelse ved lige score (spec §4): højeste grundvægt → største konkurrence
  -- → laveste rule alfabetisk. De sidste tre led (competition_id, subject_id,
  -- headline) er ikke i spec'en, men er nødvendige for at to gen-kørsler giver
  -- SAMME kort — acceptkriterie 7. Uden dem ville to CONTRARIAN-kandidater fra
  -- samme dag i samme konkurrence være uadskillelige, og databasen valgte frit.
  drop table if exists _sd_rank;
  create temporary table _sd_rank as
  select *, row_number() over (
    partition by user_id
    order by news_value desc, base desc, league_size desc nulls last, rule asc,
             competition_id asc nulls last, subject_id asc, headline asc
  ) as rn
  from _sd_scored;

  -- ---------- MINI-STILLINGEN (G88) ----------
  -- Tre rækker af stillingen med modtagerens egen fremhævet, pakket på kortet.
  -- Spec §8 har lovet den siden v3, og `DayCard.jsx` har renderet den lige så
  -- længe — men ingen skrev nøglen, så `MiniStanding` fik altid en tom liste og
  -- returnerede `null`. Halvdelen af hverdagskortet manglede TAVST: intet tomt
  -- felt, ingen fejl, ingenting at opdage (backloggens `G88`, 8. august 2026).
  --
  -- DEN STRUKTURELLE REGEL LIGGER I JOINET og ikke i en betingelse: rækkerne
  -- hentes fra `_sd_after` for kortets EGEN konkurrence, og modtageren er altid
  -- deltager i den (`_sd_reach` når kun folk gennem en delt konkurrence). Derfor
  -- kan et navn her aldrig være en, modtageren ikke deler konkurrence med — samme
  -- designregel som resten af motoren, håndhævet samme sted. En komponent, der
  -- selv hentede stillingen, ville skulle genopfinde den, og det er præcis dét,
  -- der gik galt i juli 2026, da `_se_rp` manglede sit join.
  --
  -- VINDUET ER TRE RÆKKER OMKRING MODTAGEREN, klemt mod enderne: nr. 1 ser
  -- 1-2-3, den sidste ser de tre nederste, og en konkurrence med to deltagere
  -- giver to rækker. Alternativet — over/dig/under, som forsvinder i toppen og
  -- bunden — ville give nr. 1 et kort med to rækker, altså mindst indhold til
  -- den, der har præsteret mest.
  --
  -- `pos` er en TOTAL orden og ikke `rnk`, som deler tal ved pointlighed;
  -- `order by a.rnk, a.user_id` er samme stige som `_sd_rival`, så to
  -- gen-kørsler giver samme tre navne (acceptkriterie 7). `rnk` vises til
  -- gengæld, fordi det er det rigtige tal at læse — to delte andenpladser skal
  -- begge stå som 2.
  --
  -- KUN BRUGERE MED SCOREDE TIP FINDES HER. `_sd_after` bygger på
  -- competition_match_points, så en deltager, der aldrig har tippet, har ingen
  -- række — og får derfor ingen mini frem for en, hun ikke står i. Det gælder
  -- også no-tips-kortet: har hun tippet på en tidligere dag, står hun der.
  drop table if exists _sd_mini;
  create temporary table _sd_mini as
  with ordered as (
    select a.competition_id, a.user_id, a.pts, a.rnk,
           row_number() over (partition by a.competition_id order by a.rnk, a.user_id) as pos,
           count(*)     over (partition by a.competition_id)                           as n
    from _sd_after a
  ),
  anchored as (
    select o.competition_id, o.user_id, o.pos,
           least(greatest(o.pos - 1, 1), greatest(o.n - 2, 1)) as win_start
    from ordered o
  )
  select me.competition_id, me.user_id,
         jsonb_agg(jsonb_build_object(
           'rnk',  nb.rnk,
           'name', pr.display_name,
           'pts',  nb.pts,
           'me',   nb.user_id = me.user_id
         ) order by nb.pos) as mini
  from anchored me
  join ordered nb on nb.competition_id = me.competition_id
                 and nb.pos between me.win_start and me.win_start + 2
  join public.profiles pr on pr.id = nb.user_id
  group by me.competition_id, me.user_id;
  create index on _sd_mini (competition_id, user_id);

  -- ---------- UDGIVELSEN ----------
  -- news_value på rækken er dagens HØJESTE kandidatscore for brugeren — også
  -- når kortet er dæmpet. Det er tallet, tærsklen blev målt imod, og dermed
  -- A35's måledata. runner_up_value er nr. 2.
  --
  -- MILEPÆLE FÅR INGEN MINI, og det er en determinismes-betingelse og ikke en
  -- smagssag: `apply_milestone_stories()` kaprer et FÆRDIGT kort og sætter dets
  -- `competition_id` til milepælens, som kan være en anden end den, kortet blev
  -- skrevet for. Beholdt kapringen sin mini, ville stillingen være fra én
  -- konkurrence og kolonnen sige en anden. De to veje til et MILESTONE-kort
  -- skal give SAMME række (acceptkriterie 7), så motoren udelader mini, og
  -- kapringen fjerner den. Det er også dét, `DayCard.jsx` har beskrevet hele
  -- tiden: en milepæl er global og har ingen stilling at stå i.
  -- 🔴 DE TRE GRENE SKRIVER I `_sd_out` OG IKKE DIREKTE I `public.stories` (A39).
  -- Rækkerne bygges færdige her og forliges med det, der allerede står, nederst
  -- i funktionen. Grenenes indhold, betingelser og antal er ordret uændrede —
  -- `priority < 180 ⟺ news_value >= v_threshold` er stadig sandt, og påstand 14
  -- måler det.
  --
  -- `day_scope_matches` er frysningens tal: hvor mange af dagens kampe kortet
  -- blev regnet på. Det kommer fra `_sd_ready`, altså fra samme udtryk som
  -- modtagerkredsen — kom de to fra hver sit sted, kunne de drive fra hinanden,
  -- uden at nogen så det. Joinet mod `_sd_ready` er samtidig en påstand: fandtes
  -- modtageren ikke i modtagerkredsen, ville rækken ikke blive skrevet.
  --
  -- ⚠️ NØGLEN MÅ IKKE HEDDE `matches`. Den er optaget af no_tips-kortet nedenfor
  -- med en anden betydning (antal kampe i ÉN konkurrence), og et sammenfald ville
  -- gøre frysningen tavst forkert for netop de brugere, der intet tippede.
  drop table if exists _sd_out;
  create temporary table _sd_out (
    user_id uuid, competition_id uuid, rule text, priority int,
    league_size int, news_value int, payload jsonb, headline text, body text
  );

  insert into _sd_out
    (user_id, competition_id, rule, priority, league_size, news_value, payload, headline, body)
  select w.user_id, w.competition_id, w.rule, w.priority,
         w.league_size, w.news_value,
         w.payload || jsonb_build_object(
           'day', v_daylabel, 'day_key', p_day,
           'third', w.user_id <> w.subject_id,
           'winner_rule', w.rule,
           'day_scope_matches', rd.n_matches,
           'runner_up_value', coalesce(up.news_value, 0))
           || case when w.rule <> 'MILESTONE' and mn.mini is not null
                   then jsonb_build_object('mini', mn.mini) else '{}'::jsonb end,
         case when w.user_id <> w.subject_id then w.headline3 else w.headline end,
         case when w.user_id <> w.subject_id then w.body3     else w.body     end
  from _sd_rank w
  join _sd_ready rd on rd.user_id = w.user_id
  left join _sd_rank up on up.user_id = w.user_id and up.rn = 2
  left join _sd_mini mn on mn.competition_id = w.competition_id and mn.user_id = w.user_id
  where w.rn = 1 and w.news_value >= v_threshold;

  -- ---------- DET DÆMPEDE FALD-TILBAGE ----------
  -- Vinder < 45 ⇒ dagens facit uden ulæst-markering: en oplysning, ingen påstand
  -- om at der skete noget. Pointen er, at ULÆST-SIGNALET BLIVER SJÆLDENT NOK TIL
  -- AT BETYDE NOGET. Et badge, der lyser hver dag, er ikke et signal, det er en
  -- baggrundsfarve.
  --
  -- news_value bærer stadig den højeste kandidatscore, så en dag, der lå ét
  -- point under, kan kendes fra en dag, hvor intet skete.
  insert into _sd_out
    (user_id, competition_id, rule, priority, league_size, news_value, payload, headline, body)
  select d.user_id, d.competition_id, 'DAY_RESULT', 180,
         d.league_size, coalesce(best.news_value, 0),
         d.payload || jsonb_build_object(
           'day', v_daylabel, 'day_key', p_day, 'third', false,
           'winner_rule', coalesce(best.rule, 'DAY_RESULT'),
           'day_scope_matches', rd.n_matches,
           'runner_up_value', 0)
           || case when mn.mini is not null
                   then jsonb_build_object('mini', mn.mini) else '{}'::jsonb end,
         d.headline, d.body
  from (
    select distinct on (s.user_id) s.*
    from _sd_scored s
    where s.rule = 'DAY_RESULT'
    order by s.user_id, s.league_size desc nulls last, s.competition_id asc
  ) d
  join _sd_ready rd on rd.user_id = d.user_id
  left join lateral (
    select r.news_value, r.rule from _sd_rank r where r.user_id = d.user_id and r.rn = 1
  ) best on true
  left join _sd_mini mn on mn.competition_id = d.competition_id and mn.user_id = d.user_id
  where coalesce(best.news_value, 0) < v_threshold;

  -- ---------- TIPS-PÅMINDELSEN (acceptkriterie 8) ----------
  -- Deltagere i en konkurrence med kampe i dag, som ikke havde ét eneste scoret
  -- tip. De har ingen DAY_RESULT-kandidat og ville ellers stå helt uden kort —
  -- og et drama-kort om andre er udtrykkeligt det forkerte svar. De får dagens
  -- omfang og en fremadrettet slutning. Ingen emoji: dette er dæmpet tier.
  -- 🔴 A39-FILTERET SKAL GENTAGES HER, og det er den ene undtagelse fra "reglen
  -- ligger i `_sd_reach`". Denne gren går slet ikke gennem `_sd_reach` eller
  -- `_sd_scored` — den læser `competition_matches` direkte, fordi dens
  -- modtagere pr. definition er dem, ingen kandidat nåede. Uden joinet ville den
  -- udgive kort til brugere, hvis egen dag stadig spilles, og A39 ville være
  -- lækket netop dér, hvor ingen kiggede.
  insert into _sd_out
    (user_id, competition_id, rule, priority, league_size, news_value, payload, headline, body)
  select q.user_id, q.competition_id, 'DAY_RESULT', 180,
         q.league_size, 0,
         jsonb_build_object('variant', 'no_tips', 'matches', q.matches,
                            'league', q.league, 'day', v_daylabel, 'day_key', p_day,
                            'third', false, 'winner_rule', 'DAY_RESULT',
                            'day_scope_matches', q.n_matches,
                            'runner_up_value', 0)
           || case when mn.mini is not null
                   then jsonb_build_object('mini', mn.mini) else '{}'::jsonb end,
         'Ingen tips i dag',
         'Der blev spillet ' || q.matches ||
           case when q.matches = 1 then ' kamp' else ' kampe' end ||
           ' i ' || q.league || ', men du havde ingen tips med. Husk at tippe, inden næste kamp låser.'
  from (
    select distinct on (cp.user_id)
      cp.user_id, cm.competition_id, c.name as league, sz.n as league_size,
      rd.n_matches,
      count(*) over (partition by cp.user_id, cm.competition_id)::int as matches
    from public.competition_matches cm
    join public.matches m on m.id = cm.match_id
    join public.competition_participants cp on cp.competition_id = cm.competition_id
    join public.competitions c on c.id = cm.competition_id
    join _sd_size sz on sz.competition_id = cm.competition_id
    join _sd_ready rd on rd.user_id = cp.user_id
    where m.match_day = p_day and m.home_score is not null and m.away_score is not null
      and not exists (select 1 from _sd_today t where t.user_id = cp.user_id)
    order by cp.user_id, sz.n desc, cm.competition_id asc
  ) q
  left join _sd_mini mn on mn.competition_id = q.competition_id and mn.user_id = q.user_id;

  -- ---------- SKRIVNINGEN ER ET FORLIG OG IKKE EN GEN-SKRIVNING (A39) ----------
  -- ÉT SLOT, påstået allerede her. Det unikke indeks `stories_day_slot_uniq` er
  -- nettet; dette er påstanden om, at nettet aldrig skal bruges — og den fejler
  -- i en temporær tabel frem for halvvejs inde i en skrivning til produktionen.
  create unique index on _sd_out (user_id);

  -- v2 og v3 slettede dagens rækker og skrev dem igen. Det var rigtigt, da
  -- motoren kørte ÉN gang pr. dag. Efter A39 kører den, hver gang EN BRUGERS dag
  -- bliver færdig — fire-fem gange på en stor lørdag — og en bruger, hvis tal
  -- ikke har flyttet sig siden kl. 16, ville få nyt `id`, nyt `created_at` og et
  -- tabt `dismissed_at` ved hver af dem. Det er `G129` gjort til hverdag, og det
  -- er ulæst-prikken nulstillet tre gange på en aften — præcis det signal, spec
  -- §5 findes for at gøre sjældent. Frysningen ovenfor fanger det ikke: dagen
  -- voksede jo ikke.
  --
  -- 🔴 SLETNINGEN DRIVES AF `_sd_out` OG IKKE AF DAGEN, og det er dét, der gør
  -- invarianten "en tidlig udgang må aldrig efterlade mindre, end den fandt"
  -- STRUKTUREL frem for argumenteret: en række kan kun slettes, hvis der findes
  -- en erstatning for netop den bruger. En bruger, hvis dag ikke er færdig, og en
  -- bruger, hvis kort er frosset, står slet ikke i `_sd_out` og kan dermed ikke
  -- røres. Den farligste linje i v2 er ikke længere farlig.
  --
  -- DÆKNINGSPÅSTANDEN, DER GØR DET SIKKERT: `_sd_ready ⊆ {brugere, der får en
  -- række i _sd_out}`. Led for led — er jeg i `_sd_ready`, deltager jeg i mindst
  -- én konkurrence med mindst én kamp i dag, og alle dens kampe har resultat.
  -- Har jeg et scoret tip, har jeg en `_sd_today`-række og dermed en
  -- DAY_RESULT-kandidat (grenens joins er alle garanterede: `_sd_size` har en
  -- række for enhver konkurrence med deltagere, `_sd_after ⊇ _sd_today`, og
  -- `competitions` er FK-garanteret) → jeg lander i gren 1 eller gren 2. Har jeg
  -- intet scoret tip, falder jeg ud på den hårde regel og fanges af gren 3.
  -- Bagstopperens klasse 2 hviler på netop denne påstand for at være endelig.
  --
  -- ⚠️ SLETNINGEN MÅ IKKE FILTRERE PÅ `news_value is not null`. Gjorde den det,
  -- kunne en v2-række og en v3-række stå på samme `(user_id, day_key)` — det
  -- unikke indeks tillader det, fordi dets `where` udelader v2 — og
  -- `loadDayCard`s `order=day_key.desc&limit=1` ville vælge frit mellem dem.
  delete from public.stories s
  using _sd_out o
  where s.period = 'day' and s.day_key = p_day
    and s.user_id = o.user_id
    and (s.rule, s.competition_id, s.priority, s.league_size, s.news_value,
         s.headline, s.body, s.payload)
        is distinct from
        (o.rule, o.competition_id, o.priority, o.league_size, o.news_value,
         o.headline, o.body, o.payload);

  insert into public.stories
    (round_key, day_key, period, user_id, competition_id, rule, priority,
     league_size, news_value, payload, headline, body)
  select v_round_text, p_day, 'day', o.user_id, o.competition_id, o.rule, o.priority,
         o.league_size, o.news_value, o.payload, o.headline, o.body
  from _sd_out o
  where not exists (
    select 1 from public.stories s
    where s.period = 'day' and s.day_key = p_day and s.user_id = o.user_id
  );

  drop table if exists _sd_pts;
  drop table if exists _sd_size;
  drop table if exists _sd_today;
  drop table if exists _sd_after;
  drop table if exists _sd_before;
  drop table if exists _sd_avg;
  drop table if exists _sd_mag;
  drop table if exists _sd_streak;
  drop table if exists _sd_cand;
  drop table if exists _sd_reach;
  drop table if exists _sd_big;
  drop table if exists _sd_rival;
  drop table if exists _sd_prox;
  drop table if exists _sd_scored;
  drop table if exists _sd_rank;
  drop table if exists _sd_mini;
  drop table if exists _sd_ready;
  drop table if exists _sd_out;
end;
$$;


--
-- Name: generate_stories(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_stories(p_round_key text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_label text;
  v_month text;
  v_month_name text;
  v_month_last boolean;
  v_prev_month text;
  v_prev_month_name text;
  v_rating_total int;
  -- VIGTIGT — round_key har TO typer i skemaet, og de må ikke blandes:
  --   date: matches.round_key (genereret kolonne) og alt afledt af den
  --         (round_standings, _se_rp, _se_pair).
  --   text: stories.round_key og rating_history.round_key.
  -- Postgres har ingen `date <= text`-operator, så en usammenlignet blanding
  -- fejler HELE funktionen — og da matches-triggeren er exception-guarded, sker
  -- det tavst (et tomt historie-kort kan ikke skelnes fra en stille uge).
  -- Derfor: brug v_round mod date-kolonnerne, p_round_key mod text-kolonnerne.
  v_round date := p_round_key::date;
  months text[] := array['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
begin
  -- Idempotent: fjern rundens historier og genberegn (stories.round_key er text).
  -- `period = 'round'` ER IKKE VALGFRI (v2). Dagskortene bærer samme round_key,
  -- fordi karusellen grupperer på runden — uden filteret ville hver
  -- resultatændring i en færdig runde tørre ugens dagskort væk.
  delete from public.stories where round_key = p_round_key and period = 'round';

  v_label := to_char(v_round, 'DD.MM') || ' – ' || to_char(v_round + 6, 'DD.MM');

  -- ---- point pr. konkurrence/bruger/runde (kun spillede kampe, t.o.m. denne runde) ----
  -- Ud over point og præcise hits opgøres alt, tiebreaker-stigen har brug for:
  -- korrekte udfald, målafvigelse og om runden blev vundet. Stigen er den samme
  -- som i stillingerne (sql/standings_tiebreakers.sql, src/lib/standings.js), så
  -- en historie aldrig kan påstå en placering, tabellen modsiger.
  -- `round_won` = nr. 1 i runden efter stigen uden rundesejr-trinnet; delt sejr
  -- tæller for alle, hvilket regel 70 nedenfor bruger direkte.
  --
  -- Grundlaget er viewet competition_match_points (sql/story_engine_v2_day.sql),
  -- som dagsmotoren læser fra det samme sted. Viewet BÆRER deltager-
  -- afgrænsningen, og den er ikke valgfri: `predictions` er global pr. (bruger,
  -- kamp) og ved intet om konkurrencer, så uden joinet til
  -- competition_participants tælles enhver, der har tippet samme kamp i en anden
  -- konkurrence, med her (§11 — "nr. 9 af 8" og historier om fremmede).
  -- Udtrykket stod tidligere inline netop her; det bor nu ét sted, så de to
  -- motorer ikke kan drive fra hinanden.
  drop table if exists _se_rp;
  create temporary table _se_rp as
  with scored as (
    select competition_id, user_id, round_key, pts, goal_err
    from public.competition_match_points
    where round_key <= v_round
  ),
  agg as (
    select competition_id, user_id, round_key,
      sum(pts)::int                          as rpts,
      (count(*) filter (where pts = 3))::int as rexact,
      (count(*) filter (where pts = 1))::int as routcome,
      sum(goal_err)::int                     as rgoalerr,
      count(*)::int                          as rmatches
    from scored
    group by competition_id, user_id, round_key
  )
  select agg.*,
    (rank() over (partition by competition_id, round_key
                  order by rpts desc, rexact desc, routcome desc,
                           round(rgoalerr::numeric / rmatches, 4) asc) = 1)::int as round_won
  from agg;

  -- deltagerantal pr. konkurrence (league_size-snapshot)
  drop table if exists _se_size;
  create temporary table _se_size as
  select competition_id, count(*)::int as n
  from public.competition_participants group by competition_id;

  -- kumulativ stilling EFTER runden (t.o.m. p_round_key) + rang efter hele stigen
  drop table if exists _se_after;
  create temporary table _se_after as
  select competition_id, user_id, sum(rpts)::int as pts, sum(rexact)::int as ex,
    rank() over (partition by competition_id
                 order by sum(rpts) desc, sum(rexact) desc, sum(routcome) desc, sum(round_won) desc,
                          round(sum(rgoalerr)::numeric / sum(rmatches), 4) asc)::int as rnk
  from _se_rp group by competition_id, user_id;

  -- kumulativ stilling FØR runden (< p_round_key) + rang efter hele stigen
  drop table if exists _se_before;
  create temporary table _se_before as
  select competition_id, user_id, sum(rpts)::int as pts, sum(rexact)::int as ex,
    rank() over (partition by competition_id
                 order by sum(rpts) desc, sum(rexact) desc, sum(routcome) desc, sum(round_won) desc,
                          round(sum(rgoalerr)::numeric / sum(rmatches), 4) asc)::int as rnk
  from _se_rp where round_key < v_round group by competition_id, user_id;

  -- denne rundes point pr. konkurrence/bruger
  drop table if exists _se_this;
  create temporary table _se_this as
  select competition_id, user_id, rpts, rexact, round_won from _se_rp where round_key = v_round;

  -- ======== Regel 70 · Rundens vinder (pr. konkurrence) ========
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, t.user_id, t.competition_id, 'ROUND_WON', 70, sz.n,
    jsonb_build_object('points', t.rpts, 'shared', cnt.n_winners > 1, 'others', cnt.n_winners - 1),
    '🥇 Du vandt runden ' || v_label || ' i ' || c.name,
    t.rpts || ' point — flest af alle i ' || c.name ||
      case when cnt.n_winners > 2 then ' (delt med ' || (cnt.n_winners - 1) || ' andre).'
           when cnt.n_winners = 2 then ' (delt med 1 anden).'
           else '.' end
  from _se_this t
  join (select competition_id, sum(round_won)::int as n_winners
        from _se_this group by competition_id) cnt
    on cnt.competition_id = t.competition_id
  join _se_size sz on sz.competition_id = t.competition_id and sz.n >= 2
  join public.competitions c on c.id = t.competition_id
  where t.round_won = 1 and t.rpts > 0
    -- Har konkurrencen tilvalgt lokale kåringer, og er runden kåret, fortæller
    -- regel 65 nedenfor det samme øjeblik med det navn, konkurrencen selv
    -- bruger ("Ugens bedste"). To kort om én sejr ville betyde, at brugerens
    -- ENE kort pr. runde kunne blive den svageste af de to formuleringer — og
    -- at milepæls-arkivet fik dubletter. Kåringen vinder, fordi den er den
    -- persisterede sandhed, boardet allerede viser.
    and not exists (
      select 1 from public.competition_awards aw
      where aw.competition_id = t.competition_id
        and aw.period_type = 'round' and aw.period_key = p_round_key
        and aw.user_id = t.user_id
    );

  -- ======== Regel 65 · Ugens bedste (lokal kåring, pr. konkurrence) ========
  -- Læser den PERSISTEREDE kåring (competition_awards, A22) frem for at regne
  -- den om. Det er ikke en genvej: kåringen er frossen ved sit eget kriterie
  -- (alle konkurrencens kampe i runden har resultat) og vises allerede på
  -- boardet, så en historie, der regnede sit eget svar, ville kunne modsige den
  -- tabel, brugeren kan slå op i. Samme regel som stigen: én kilde pr. påstand.
  --
  -- HVEM SKRIVER RÆKKEN? Klienten ved board-åbning — og siden august 2026 også
  -- notifikations-jobbet som `service_role` ved hver kørsel (B11). Det sidste er
  -- det, der gør denne regel pålidelig: uden det ville kortet afhænge af, at et
  -- menneske havde åbnet boardet, FØR runden blev genereret. Rækkefølgen er
  -- alligevel ikke garanteret, men historier gendannes ved hvert resultat i
  -- runden (delete + insert øverst), så kortet indhentes af sig selv.
  --
  -- Navnereglen (turnering-2 §3.6): lokalt hedder det "Ugens bedste" — aldrig
  -- "rundevinder", som er den globale titel.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, aw.user_id, aw.competition_id, 'AWARD_WEEK', 65, sz.n,
    jsonb_build_object('league', c.name, 'points', aw.points, 'shared', aw.shared,
                       'others', (count(*) over (partition by aw.competition_id))::int - 1,
                       'exact', coalesce((aw.stats ->> 'exact')::int, 0)),
    '🏅 Du er ' || case when aw.shared then 'delt ' else '' end || 'Ugens bedste i ' || c.name,
    aw.points || ' point — flest af alle i ' || c.name || ' i runden ' || v_label ||
      case when not aw.shared then '.'
           when (count(*) over (partition by aw.competition_id)) > 2
             then ' (delt med ' || ((count(*) over (partition by aw.competition_id))::int - 1) || ' andre).'
           else ' (delt med 1 anden).' end
  from public.competition_awards aw
  join public.competitions c on c.id = aw.competition_id
  join _se_size sz on sz.competition_id = aw.competition_id and sz.n >= 2
  where aw.period_type = 'round' and aw.period_key = p_round_key;

  -- ======== Regel 20 · Førsteplads overtaget (pr. konkurrence) ========
  -- Kræver, at konkurrencen HAR en runde før denne. Uden den betingelse udløste
  -- reglen i en konkurrences første runde (b.rnk er null → coalesce(...,999) > 1)
  -- og påstod, at nr. 1 havde "overtaget" en førsteplads, ingen havde haft.
  -- Premiereugen dækkes i stedet af det dæmpede SEASON_OPENER nederst.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, a.user_id, a.competition_id, 'LEAD_TAKEN', 20, sz.n,
    jsonb_build_object('gap', a.pts - coalesce(second.pts, 0)),
    '🏆 Du overtog førstepladsen i ' || c.name,
    'Efter runden ' || v_label || ' fører du ' || c.name ||
      '. Forspring til nr. 2: ' || (a.pts - coalesce(second.pts, 0)) || ' point.'
  from _se_after a
  left join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
  join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 2
  join public.competitions c on c.id = a.competition_id
  left join lateral (
    select pts from _se_after a2 where a2.competition_id = a.competition_id and a2.rnk = 2
    order by pts desc limit 1
  ) second on true
  where a.rnk = 1 and coalesce(b.rnk, 999) > 1
    and exists (select 1 from _se_before b2 where b2.competition_id = a.competition_id);

  -- ======== Regel 21 · Førsteplads mistet (pr. konkurrence) ========
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, b.user_id, b.competition_id, 'LEAD_LOST', 21, sz.n,
    jsonb_build_object('rival', pr.display_name, 'gap', lead.pts - a.pts),
    '⚡ ' || pr.display_name || ' vippede dig af førstepladsen i ' || c.name,
    'Du førte ' || c.name || ', men ' || pr.display_name || ' gik forbi i runden ' || v_label ||
      '. Afstand op: ' || (lead.pts - a.pts) || ' point.'
  from _se_before b
  join _se_after a on a.competition_id = b.competition_id and a.user_id = b.user_id
  join _se_size sz on sz.competition_id = b.competition_id and sz.n >= 2
  join public.competitions c on c.id = b.competition_id
  join lateral (
    -- delt førsteplads: vælg deterministisk, så teksten ikke skifter rival mellem
    -- to gen-kørsler af samme runde (idempotens gælder også de nævnte navne)
    select user_id, pts from _se_after a2 where a2.competition_id = b.competition_id and a2.rnk = 1
    order by a2.user_id limit 1
  ) lead on true
  join public.profiles pr on pr.id = lead.user_id
  where b.rnk = 1 and a.rnk > 1;

  -- ======== Regel 50/75 · Comeback (≥2 pladser op, konkurrencer med ≥4 deltagere) ========
  -- A4-kalibrering (v1.1): tærsklen sænket fra 3 til 2 pladser og fra 5 til 4
  -- deltagere, men et 2-pladers spring får prioritet 75 — altså UNDER rundens
  -- vinder (70). Et rigtigt comeback (≥3 pladser) beholder 50 og vinder som før.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, a.user_id, a.competition_id, 'COMEBACK',
    case when (b.rnk - a.rnk) >= 3 then 50 else 75 end, sz.n,
    jsonb_build_object('from', b.rnk, 'to', a.rnk, 'gap', top.pts - a.pts),
    '🚀 Fra nr. ' || b.rnk || ' til nr. ' || a.rnk || ' i ' || c.name,
    'Du rykkede ' || (b.rnk - a.rnk) || ' pladser frem i runden ' || v_label ||
      '. Toppen var ' || (top.pts - a.pts) || ' point væk, da den sluttede.'
  from _se_after a
  join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
  join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 4
  join public.competitions c on c.id = a.competition_id
  join lateral (select pts from _se_after a2 where a2.competition_id = a.competition_id and a2.rnk = 1
                order by a2.user_id limit 1) top on true
  where (b.rnk - a.rnk) >= 2;

  -- ======== Regel 22 · Ind i top 3 (v1.1, konkurrencer med ≥6 deltagere) ========
  -- Comeback måler BEVÆGELSE og misser derfor det skift, der føles størst i en
  -- tabel: 4. → 3. plads. Top-3 er en tærskel, ikke en distance. Kun i ligaer med
  -- ≥6 deltagere, hvor en top-3 rent faktisk betyder noget.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, a.user_id, a.competition_id, 'PODIUM_ENTER', 22, sz.n,
    jsonb_build_object('rank', a.rnk, 'from', b.rnk, 'total', sz.n, 'gap', top.pts - a.pts),
    '🏅 Du gik ind i top 3 i ' || c.name,
    'Efter runden ' || v_label || ' ligger du nr. ' || a.rnk || ' af ' || sz.n || ' i ' || c.name ||
      '. Toppen var ' || (top.pts - a.pts) || ' point væk.'
  from _se_after a
  join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
  join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 6
  join public.competitions c on c.id = a.competition_id
  join lateral (select pts from _se_after a2 where a2.competition_id = a.competition_id and a2.rnk = 1
                order by a2.user_id limit 1) top on true
  where a.rnk <= 3 and b.rnk >= 4;

  -- ======== Regel 45 · Tæt på toppen (v1.1) ========
  -- Virker UDEN historik og er derfor en af de få rigtige historier, en første
  -- runde kan producere. Betingelsen er fremadrettet af design: højst 3 point op,
  -- og afstanden må ikke være vokset i runden (ingen historik ⇒ betingelsen
  -- springes over). gap = 0 er udeladt — dér er man reelt lige med føringen, og
  -- teksten "0 point op" ville være forkert.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, a.user_id, a.competition_id, 'CLOSING_IN', 45, sz.n,
    jsonb_build_object('rival', pr.display_name, 'gap', top.pts - a.pts, 'rank', a.rnk),
    '👀 Du sluttede runden ' || (top.pts - a.pts) || ' point fra toppen i ' || c.name,
    'Efter runden ' || v_label || ' var der ' || (top.pts - a.pts) || ' point op til ' ||
      pr.display_name || ' i ' || c.name || '.'
  from _se_after a
  join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 3
  join public.competitions c on c.id = a.competition_id
  join lateral (select a2.user_id, a2.pts from _se_after a2
                where a2.competition_id = a.competition_id and a2.rnk = 1
                order by a2.user_id limit 1) top on true
  join public.profiles pr on pr.id = top.user_id
  left join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
  left join lateral (select b2.pts from _se_before b2
                     where b2.competition_id = a.competition_id and b2.rnk = 1
                     order by b2.user_id limit 1) btop on true
  where a.rnk > 1
    and (top.pts - a.pts) between 1 and 3
    and (b.pts is null or btop.pts is null or (top.pts - a.pts) <= (btop.pts - b.pts));

  -- ======== Regel 55 · Personlig runderekord (v1.1) ========
  -- Kræver kun brugerens EGNE tidligere runder — den kan derfor udløses af en
  -- spiller, der ligger sidst, uden at historien nogensinde nævner placeringen.
  -- Ingen deltagergrænse: rekorden er personlig og gælder også en solo-konkurrence.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, t.user_id, t.competition_id, 'PERSONAL_BEST', 55, sz.n,
    jsonb_build_object('points', t.rpts, 'old', prev.old, 'league', c.name),
    '📊 Din bedste runde hidtil: ' || t.rpts || ' point',
    'Runden ' || v_label || ' er din stærkeste i ' || c.name ||
      ' — din forrige rekord var ' || prev.old || ' point.'
  from _se_this t
  join _se_size sz on sz.competition_id = t.competition_id
  join public.competitions c on c.id = t.competition_id
  join lateral (
    select max(r.rpts)::int as old, count(*)::int as prev_rounds
    from _se_rp r
    where r.competition_id = t.competition_id and r.user_id = t.user_id and r.round_key < v_round
  ) prev on true
  where prev.prev_rounds >= 1 and t.rpts > prev.old;

  -- ======== Regel 40 · Head-to-head-overhaling (pr. konkurrence, én rival) ========
  -- Forenkling v1: "overhalede denne runde" (var bagud/lige før, foran efter).
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select distinct on (competition_id, user_id)
    p_round_key, user_id, competition_id, 'H2H_PASS', 40, league_size, payload, headline, body
  from (
    select a.competition_id, a.user_id, sz.n as league_size,
      jsonb_build_object('rival', pr.display_name, 'gap', a.pts - ao.pts) as payload,
      -- DATID, ikke nutid. "Du er nu foran X" er et udsagn om en STILLING, og
      -- en stilling flytter sig ved næste kamp — overskriften blev meldt som
      -- usand, mens den stod på Hjem (august 2026). "Du gik forbi X" er en
      -- BEGIVENHED i en afsluttet runde og kan aldrig blive forkert.
      '🔄 Du gik forbi ' || pr.display_name || ' i ' || c.name as headline,
      'Du overhalede ' || pr.display_name || ' i runden ' || v_label ||
        ' og sluttede ' || (a.pts - ao.pts) || ' point foran i ' || c.name || '.' as body,
      (a.pts - ao.pts) as gap
    from _se_after a
    join _se_after ao on ao.competition_id = a.competition_id and ao.user_id <> a.user_id
    join _se_before b on b.competition_id = a.competition_id and b.user_id = a.user_id
    join _se_before bo on bo.competition_id = a.competition_id and bo.user_id = ao.user_id
    join _se_size sz on sz.competition_id = a.competition_id and sz.n >= 2
    join public.competitions c on c.id = a.competition_id
    join public.profiles pr on pr.id = ao.user_id
    where a.pts > ao.pts and b.pts <= bo.pts
  ) q
  order by competition_id, user_id, gap asc;  -- tættest overhaling = mest dramatisk

  -- ======== Regel 60/75 · Stime mod rival (≥2 sejre i træk, aktuel) ========
  -- A4-kalibrering (v1.1): stimen tæller fra 2 sejre i træk, men en 2-stime får
  -- prioritet 75 (under rundens vinder, 70) — "2. sejr i træk mod Jimmy" er en
  -- sand og sjov detalje, men den må aldrig fortrænge "du vandt runden".
  -- Fra 3 sejre er den spec'ens oprindelige historie og beholder prioritet 60.
  drop table if exists _se_pair;
  create temporary table _se_pair as
  select a.competition_id, a.user_id, b.user_id as rival_id, a.round_key,
    (a.rpts > b.rpts) as won, a.rpts as mine, b.rpts as deres
  from _se_rp a
  join _se_rp b on b.competition_id = a.competition_id and b.round_key = a.round_key and b.user_id <> a.user_id;

  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select distinct on (s.competition_id, s.user_id)
    p_round_key, s.user_id, s.competition_id, 'STREAK',
    case when s.streak >= 3 then 60 else 75 end, sz.n,
    jsonb_build_object('rival', pr.display_name, 'n', s.streak, 'mine', s.mine, 'deres', s.deres),
    '🔥 ' || s.streak || '. sejr i træk mod ' || pr.display_name || ' i ' || c.name,
    'Du slog ' || pr.display_name || ' igen i runden ' || v_label || ' — ' ||
      s.mine || ' mod ' || s.deres || ' point.'
  from (
    select p.competition_id, p.user_id, p.rival_id,
      coalesce(min(p.rn) filter (where not p.won) - 1, count(*))::int as streak,
      max(p.mine) filter (where p.rn = 1) as mine,
      max(p.deres) filter (where p.rn = 1) as deres,
      bool_or(p.rn = 1 and p.round_key = v_round) as current
    from (
      select competition_id, user_id, rival_id, round_key, won, mine, deres,
        row_number() over (partition by competition_id, user_id, rival_id order by round_key desc) as rn
      from _se_pair
    ) p
    group by p.competition_id, p.user_id, p.rival_id
  ) s
  join _se_size sz on sz.competition_id = s.competition_id
  join public.competitions c on c.id = s.competition_id
  join public.profiles pr on pr.id = s.rival_id
  where s.current and s.streak >= 2
  order by s.competition_id, s.user_id, s.streak desc;

  -- ======== Regel 30 · Ny ratingrekord (global, efter provisorisk periode) ========
  select count(*)::int into v_rating_total from public.ratings where scope = 'ALL';
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, rh.user_id, null, 'RATING_HIGH', 30, null,
    jsonb_build_object('rating', round(rh.rating_after)::int, 'old', round(prev.old)::int, 'rank', rk.rnk, 'total', v_rating_total),
    '📈 Ny personlig ratingrekord: ' || round(rh.rating_after)::int,
    'Din runde ' || v_label || ' sendte dig forbi din hidtidige rekord på ' || round(prev.old)::int ||
      '. Efter runden var du nr. ' || rk.rnk || ' af ' || v_rating_total || ' på ranglisten.'
  from public.rating_history rh
  join public.ratings r on r.user_id = rh.user_id and r.scope = 'ALL' and coalesce(r.provisional, false) = false
  join lateral (
    select max(rh2.rating_after) as old from public.rating_history rh2
    where rh2.user_id = rh.user_id and rh2.scope = 'ALL' and rh2.round_key < p_round_key
  ) prev on true
  join lateral (
    select rank() over (order by rating desc)::int as rnk, user_id
    from public.ratings where scope = 'ALL'
  ) rk on rk.user_id = rh.user_id
  where rh.scope = 'ALL' and rh.round_key = p_round_key
    and prev.old is not null and rh.rating_after > prev.old;

  -- ======== Regel 10 · Månedens Champion (global, når runden lukker måneden) ========
  v_month := to_char(v_round, 'YYYY-MM');
  v_month_name := months[cast(to_char(v_round, 'MM') as int)];
  select not exists (
    select 1 from public.matches m
    where m.round_key > v_round and to_char(m.round_key, 'YYYY-MM') = v_month
      and m.home_score is not null
  ) into v_month_last;

  -- Månedstitlen afgøres af hele tiebreaker-stigen, og den kan DELES: er to
  -- spillere ægte lige hele vejen ned, får de begge historien — samme regel som
  -- kåringen på Championship-fanen og titlerne i karriereprofilen.
  if v_month_last then
    insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
    select p_round_key, w.user_id, null, 'MONTH_CHAMP', 10, null,
      jsonb_build_object('month', v_month_name, 'points', w.total_points,
                         'gap', w.total_points - coalesce(sec.total_points, w.total_points),
                         'shared', w.n_top > 1),
      '👑 Du er ' || case when w.n_top > 1 then 'delt ' else '' end
        || 'Månedens Champion — ' || v_month_name,
      w.total_points || ' point — flest af alle i ' || v_month_name ||
        case when w.n_top > 1 then ' (delt).' else '.' end ||
        case when sec.total_points is not null and sec.total_points < w.total_points
             then ' Nr. 2 var ' || (w.total_points - sec.total_points) || ' point efter.' else '' end
    from (
      select user_id, total_points, count(*) over () as n_top
      from (
        select user_id, total_points,
          rank() over (order by total_points desc, exact_count desc, outcome_count desc,
                                round_wins desc, avg_goal_error asc) as rnk
        from public.monthly_standings where month = v_month and scope = 'ALL'
      ) r
      where r.rnk = 1
    ) w
    left join lateral (
      select total_points from public.monthly_standings
      where month = v_month and scope = 'ALL' and user_id <> w.user_id
      order by total_points desc, exact_count desc, outcome_count desc,
               round_wins desc, avg_goal_error asc limit 1
    ) sec on true;
  end if;

  -- ======== Regel 15 · Månedens bedste (lokal kåring, pr. konkurrence) ========
  -- Kortet hører til den FØRSTE runde i en ny måned, og det er en anden regel
  -- end regel 10 ovenfor, som fyrer i den sidste runde MED kampe i måneden.
  -- Forskellen er ikke kosmetisk: `award_competition_periods()` kårer først en
  -- måned, når kalendermåneden er forbi (ellers kunne efterfyldningen lægge en
  -- udsat kamp ind i en allerede kåret måned), så rækken FINDES ikke endnu, når
  -- regel 10 fyrer. Den første runde i den nye måned er det tidligste
  -- tidspunkt, hvor kåringen både er sand og skrevet.
  --
  -- Prioritet 15 ligger mellem den globale månedstitel (10) og en overtaget
  -- førsteplads (20): en lokal månedstitel er større end alt, hvad en enkelt
  -- runde kan producere, men mindre end at være Månedens Champion.
  v_prev_month := to_char(v_round - 7, 'YYYY-MM');
  if v_prev_month <> to_char(v_round, 'YYYY-MM') then
    v_prev_month_name := months[cast(substring(v_prev_month from 6 for 2) as int)];
    insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
    select p_round_key, aw.user_id, aw.competition_id, 'AWARD_MONTH', 15, sz.n,
      jsonb_build_object('league', c.name, 'month', v_prev_month_name, 'points', aw.points,
                         'shared', aw.shared,
                         'others', (count(*) over (partition by aw.competition_id))::int - 1),
      '👑 Du er ' || case when aw.shared then 'delt ' else '' end
        || 'Månedens bedste i ' || c.name || ' — ' || v_prev_month_name,
      aw.points || ' point — flest af alle i ' || c.name || ' i ' || v_prev_month_name ||
        case when not aw.shared then '.'
             when (count(*) over (partition by aw.competition_id)) > 2
               then ' (delt med ' || ((count(*) over (partition by aw.competition_id))::int - 1) || ' andre).'
             else ' (delt med 1 anden).' end
    from public.competition_awards aw
    join public.competitions c on c.id = aw.competition_id
    join _se_size sz on sz.competition_id = aw.competition_id and sz.n >= 2
    where aw.period_type = 'month' and aw.period_key = v_prev_month;
  end if;

  -- ======== Regel 80/85 · Perfekt træfsikkerhed (global, ≥2 præcise i runden) ========
  -- A4-kalibrering (v1.1): tælles fra 2 præcise, men 2 giver prioritet 85 — den
  -- lander dermed under alt andet på højdepunkt-stigen og fungerer som den
  -- sidste rigtige historie, før det dæmpede tier tager over.
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, rs.user_id, null, 'SHARP',
    case when rs.exact_count >= 3 then 80 else 85 end, null,
    jsonb_build_object('n', rs.exact_count, 'points', rs.total_points),
    '🎯 ' || rs.exact_count || ' præcise resultater i runden',
    'Du ramte ' || rs.exact_count || ' kampe præcist i runden ' || v_label ||
      ' — ' || rs.total_points || ' point i alt.'
  from public.round_standings rs
  -- Kun den samlede rundechampionship (sql/tournament_scope.sql). Uden scope-filteret
  -- ville hver bruger få ét SHARP-kort pr. turnering med hver sit tal.
  where rs.round_key = v_round and rs.scope = 'ALL' and rs.exact_count >= 2;

  -- ======== Dæmpet tier (v1.1) · kun når INTET andet er i spil ========
  -- Kandidaterne er de brugere, der tippede i runden og efter alle reglerne
  -- ovenfor står helt uden en række. De får ét stille kort, knyttet til deres
  -- største liga (deterministisk tiebreak på competition_id), med prioritet ≥ 90,
  -- så det aldrig kan vinde over en rigtig historie — og aldrig behøver det,
  -- eftersom det kun findes, når der ikke er nogen.
  --
  -- Tonen er bundet af designreglen "historier driller — de ydmyger aldrig":
  -- placeringen nævnes KUN i den øverste halvdel af tabellen. Ligger man i den
  -- nederste, står der afstanden op til toppen og en fremadrettet slutning —
  -- aldrig "du er nr. 9 af 10".
  drop table if exists _se_quiet;
  create temporary table _se_quiet as
  select distinct on (t.user_id)
    t.user_id, t.competition_id, c.name as league, sz.n as league_size,
    t.rpts as points, a.rnk, (top.pts - a.pts) as gap,
    not exists (
      select 1 from _se_rp r
      where r.competition_id = t.competition_id and r.round_key < v_round
    ) as first_round
  from _se_this t
  join _se_size sz on sz.competition_id = t.competition_id and sz.n >= 2
  join public.competitions c on c.id = t.competition_id
  join _se_after a on a.competition_id = t.competition_id and a.user_id = t.user_id
  join lateral (select pts from _se_after a2 where a2.competition_id = t.competition_id and a2.rnk = 1
                order by a2.user_id limit 1) top on true
  where not exists (
    -- Kun RUNDE-kort tæller (v2). Et dagskort er ikke rundens historie, så det
    -- må ikke gøre en ellers stille runde tavs — det ville tage det dæmpede
    -- kort fra netop de brugere, v1.1 indførte tieret for.
    select 1 from public.stories s
    where s.round_key = p_round_key and s.user_id = t.user_id and s.period = 'round'
  )
  order by t.user_id, sz.n desc, t.competition_id asc;

  -- ---- Prioritet 90 · Premiereugen (konkurrencens første afsluttede runde) ----
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, q.user_id, q.competition_id, 'SEASON_OPENER', 90, q.league_size,
    jsonb_build_object('points', q.points, 'rank', q.rnk, 'total', q.league_size, 'gap', q.gap, 'league', q.league),
    'Første runde i ' || q.league || ' er i hus',
    case when q.rnk * 2 <= q.league_size
      then q.points || ' point — du starter som nr. ' || q.rnk || ' af ' || q.league_size || '.' ||
           case when q.gap > 0 then ' Toppen er ' || q.gap || ' point væk.' else '' end
      else q.points || ' point i den første runde. Toppen er ' || q.gap ||
           ' point væk — der er lang vej endnu.'
    end
  from _se_quiet q
  where q.first_round;

  -- ---- Prioritet 100 · Stille runde ----
  insert into public.stories (round_key, user_id, competition_id, rule, priority, league_size, payload, headline, body)
  select p_round_key, q.user_id, q.competition_id, 'QUIET_ROUND', 100, q.league_size,
    jsonb_build_object('points', q.points, 'rank', q.rnk, 'total', q.league_size, 'gap', q.gap, 'league', q.league),
    'Din runde: ' || q.points || ' point',
    case
      when q.rnk = 1 then 'Du fører fortsat ' || q.league || ' efter runden ' || v_label || '.'
      when q.rnk * 2 <= q.league_size
        then 'Du holder nr. ' || q.rnk || ' af ' || q.league_size || ' i ' || q.league ||
             ' — ' || q.gap || ' point op til toppen.'
      else q.gap || ' point op til toppen i ' || q.league || '. Næste runde er en ny chance.'
    end
  from _se_quiet q
  where not q.first_round;

  drop table if exists _se_rp;
  drop table if exists _se_size;
  drop table if exists _se_after;
  drop table if exists _se_before;
  drop table if exists _se_this;
  drop table if exists _se_pair;
  drop table if exists _se_quiet;

  -- ======== v3 · frames til rundestoryen ========
  -- Rundekortet er efter v3 en tap-through-story med 4–5 frames (point og
  -- percentil, bedste/værste tip, rating, rundens Champion, evt. milepæl).
  -- Frames er PER BRUGER og kan derfor ikke bygges i inserts ovenfor, som alle
  -- er per konkurrence. Hele bygningen bor i sql/story_engine_v3.sql, fordi den
  -- kaldes fra to steder: her, og fra apply_milestone_stories() når en milepæl
  -- lander efter at rundekortet er skrevet.
  --
  -- GUARDEN ER IKKE PYNT. Denne fil gen-køres rutinemæssigt, og
  -- migreringsrækkefølgen (v3-filen først) kan ikke håndhæves af en SQL-editor.
  -- Uden guarden ville en gen-kørsel på en database uden v3 fejle midt i
  -- funktionen — og bag matches-triggerens exception-guard ville det ske tavst,
  -- så runden slet ingen historier fik. Det er præcis fejl A9's form.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'build_round_frames'
  ) then
    perform public.build_round_frames(p_round_key);
  end if;
end;
$$;


--
-- Name: generate_stories_catchup(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_stories_catchup(p_grace integer DEFAULT 2) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_today date := public.match_day(now());
  v_n int := 0;
  d date;
  r date;
begin
  for d in
    -- DE BILLIGE FORBETINGELSER FØRST, og `as materialized` er ikke stil: uden
    -- den kan planlæggeren skubbe klasse 2's prædikat ned under aggregeringen og
    -- køre `users_with_complete_day()` pr. KAMP i stedet for pr. DAG.
    with kandidater as materialized (
      select m.match_day as dag
      from public.matches m
      where m.home_score is not null and m.away_score is not null
        -- Rundens SIDSTE kampdag udgiver kun rundekortet
        -- (generate_daily_stories returnerer straks). Ordret negationen af den
        -- udgang, så de dage aldrig tilbydes. UÆNDRET af A39: rundens sidste dag
        -- er et RUNDE-begreb, og rundekortet er pr. runde og ikke pr. bruger.
        and exists (select 1 from public.matches m2
                    where m2.round_key = public.round_key_of_date(m.match_day)
                      and m2.match_day > m.match_day)
        -- En dag, hvor ingen af kampene indgår i en konkurrence, har intet at
        -- lave et kort ud af — appen synkroniserer syv turneringer, men
        -- konkurrencerne dækker ikke dem alle.
        --
        -- Betingelsen er efter A39 INDEHOLDT i klasse 2 nedenfor (ingen bruger
        -- kan være klar på en dag uden konkurrence-kampe), men den bliver
        -- stående som et BILLIGT FORFILTER, fordi den udelukker historiens golde
        -- dage, før den dyre klasse overhovedet spørges.
        and exists (select 1 from public.competition_matches cm
                    join public.matches m3 on m3.id = cm.match_id
                    where m3.match_day = m.match_day)
      group by m.match_day
    )
    select k.dag from kandidater k
    -- KLASSE 1 (uændret): dagen har slet intet kort. Den almindelige form for
    -- hul, billig at spørge om — og den, der IKKE dræner for en dag, ingen kan
    -- få et kort på. Se (ii) ovenfor.
    where not exists (select 1 from public.stories s
                      where s.period = 'day' and s.day_key = k.dag)
    -- KLASSE 2 (ny, A39): dagen HAR v3-kort, men en bruger, hvis EGEN dag er
    -- færdig, mangler sit. Det er præcis det hul, den personlige kampdag
    -- producerer: bruger A fik sit kort kl. 16, bruger B's dag blev færdig kl.
    -- 22, og ingen sætning på `matches` udløste et kald derimellem.
    --
    -- `exists (v3-kort på dagen)` afgrænser til v3-æraen — samme skel som
    -- `stories_day_slot_uniq` og som `day_card_coverage`. Uden det ville hver
    -- eneste v2-dag i historikken kvalificere sig ved den første kørsel efter
    -- udrulningen og æde loftet i dagevis.
    --
    -- `>= current_date - 30` binder arbejdet for altid: v3-æraen vokser, og
    -- "alle v3-dage" ville ellers blive et voksende pas ved hver kørsel — 32
    -- gange i døgnet. Prisen er, at et hul ældre end tredive dage aldrig lukkes,
    -- hvilket er nøjagtig samme grænse, `day_card_coverage` og `prune_job_runs`
    -- allerede har sat.
       or (k.dag >= current_date - 30
           and exists (select 1 from public.stories s3
                       where s3.period = 'day' and s3.day_key = k.dag
                         and s3.news_value is not null)
           and exists (
             select 1 from public.users_with_complete_day(k.dag) u
             where not exists (select 1 from public.stories s2
                               where s2.period = 'day' and s2.day_key = k.dag
                                 and s2.user_id = u.user_id
                                 and s2.news_value is not null)))
    order by 1
    limit 20
  loop
    perform public.generate_daily_stories(d);
    v_n := v_n + 1;
  end loop;

  -- Runder, hvis vindue er lukket (tirsdag + 7 dage) og som mangler
  -- afslutningskortet. round_key er date her og text i stories — derfor ::text.
  --
  -- LØKKEN HAR ET LOFT OG EN BETINGELSE (G90, 8. august 2026). Uden dem havde den
  -- præcis det problem, `A38` lukkede for dagsløkken: en runde, der ALDRIG kan
  -- producere en historie, mangler sit kort for evigt, kvalificerer sig derfor ved
  -- hver eneste kørsel og bliver forsøgt 48-96 gange i døgnet. Prisen var spildt
  -- arbejde og ikke forkerte data, men den var **ubegrænset**.
  --
  -- **LØKKEN ER IKKE SELVAFSLUTTENDE, og det skal stå her frem for at blive
  -- antaget.** Betingelsen nedenfor er nødvendig og ikke tilstrækkelig: en runde
  -- kan have et scoret tip og ALLIGEVEL ikke kunne give et kort — fx hvis
  -- tipperen ikke deltager i en konkurrence, der dækker kampen, og ingen global
  -- regel udløser. Den slags runde bliver stadig forsøgt ved hver kørsel.
  -- Det blev opdaget af testens påstand 17e, som først antog, at efterslæbet
  -- drænes, og det gør det ikke.
  --
  -- **Det, loftet gør, er at gøre prisen ENDELIG frem for ubegrænset**: højst 20
  -- forsøg pr. kørsel uanset hvor mange golde runder der findes, og de ældste
  -- først, så et rigtigt hul aldrig kan sulte bag dem. En ægte terminering ville
  -- kræve, at et FORSØG blev husket — altså en tabel eller en kolonne — og det er
  -- en større pris end den, der betales her.
  --
  -- **BETINGELSEN ER IKKE DEN SAMME SOM DAGSLØKKENS, og det er en fejl værd at
  -- undgå.** Dagsløkken kræver, at dagen har kampe i en KONKURRENCE. Den regel
  -- ville være forkert her: `SHARP` (80/85) og `MONTH_CHAMP` (10) læser
  -- `round_standings`/`monthly_standings`, som bygger på `predictions` og
  -- `leagues.is_official` — ikke på `competition_matches`. En runde uden
  -- konkurrence-kampe kan altså stadig give et globalt kort, og en
  -- konkurrence-betingelse ville have undertrykt det tavst.
  --
  -- Fællesnævneren for ALLE rundens regler — de globale, de konkurrence-nære og
  -- det dæmpede tier — er, at de handler om nogens POINT. Findes der ikke ét
  -- scoret tip i runden, kan ingen regel fyre, og runden kan aldrig få et kort.
  -- Det er den betingelse, der står her, og den kan ikke undertrykke noget.
  for r in
    select distinct m.round_key
    from public.matches m
    where m.round_key < v_today - 7 - p_grace
      and m.home_score is not null and m.away_score is not null
      and not exists (select 1 from public.stories s
                      where s.period = 'round' and s.round_key = m.round_key::text)
      and exists (select 1 from public.predictions pr
                  join public.matches m2 on m2.id = pr.match_id
                  where m2.round_key = m.round_key
                    and m2.home_score is not null and m2.away_score is not null
                    and pr.pred_home is not null and pr.pred_away is not null)
    order by 1
    limit 20
  loop
    perform public.generate_stories(r::text);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;


--
-- Name: invite_lookup(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invite_lookup(p_code text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_code  text := btrim(coalesce(p_code, ''));
  v_group public.groups%rowtype;
  v_comp  public.competitions%rowtype;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_code = '' then
    return jsonb_build_object('kind', 'none');
  end if;

  -- Ligaen først. Rækkefølgen er den samme som klientens gamle, og den er
  -- vilkårlig men skal være fast: koderne er fra to forskellige rum, og en kode,
  -- der tilfældigvis fandtes begge steder, skal give det samme svar hver gang.
  select * into v_group from public.groups where invite_code = v_code;
  if found then
    return jsonb_build_object(
      'kind', 'group',
      'group', jsonb_build_object(
        'id', v_group.id,
        'name', v_group.name,
        'created_by', v_group.created_by,
        'created_at', v_group.created_at),
      'already', exists (select 1 from public.group_members
                          where group_id = v_group.id and user_id = v_uid));
  end if;

  select * into v_comp from public.competitions where invite_code = v_code;
  if not found then
    return jsonb_build_object('kind', 'none');
  end if;

  return jsonb_build_object(
    'kind', 'competition',
    'competition', jsonb_build_object(
      'id', v_comp.id,
      'name', v_comp.name,
      'mode', v_comp.mode,
      'group_id', v_comp.group_id,
      'created_by', v_comp.created_by,
      'created_at', v_comp.created_at),
    -- De to navne er PYNT på bekræftelsen — samme rolle som i den klient, de
    -- afløser — men de hentes HER frem for i to ekstra rundture. Ligaens navn
    -- kunne den gamle klient kun få, fordi hver liga var læsbar for enhver.
    'group_name', (select name from public.groups where id = v_comp.group_id),
    'inviter_name', (select display_name from public.profiles where id = v_comp.created_by),
    'already', exists (select 1 from public.competition_participants
                        where competition_id = v_comp.id and user_id = v_uid));
end;
$$;


--
-- Name: invite_preview(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invite_preview(p_code text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_code  text := btrim(coalesce(p_code, ''));
  v_group public.groups%rowtype;
  v_comp  public.competitions%rowtype;
begin
  -- Længdegrænsen er ikke en validering af formatet, men et loft: funktionen er
  -- åben for enhver, og en megabyte-lang parameter skal afvises før opslaget.
  if v_code = '' or length(v_code) > 64 then
    return jsonb_build_object('kind', 'none');
  end if;

  select * into v_group from public.groups where invite_code = v_code;
  if found then
    return jsonb_build_object(
      'kind', 'group',
      'name', v_group.name,
      'member_count', (select count(*) from public.group_members
                        where group_id = v_group.id));
  end if;

  select * into v_comp from public.competitions where invite_code = v_code;
  if not found then
    return jsonb_build_object('kind', 'none');
  end if;

  -- Ligaens navn er med, fordi en konkurrence-invitation også melder ind i
  -- ligaen (`A8`) — modtageren skal kunne se begge dele, de siger ja til.
  -- Er konkurrencen ligaløs, er feltet `null`, og skærmen udelader linjen.
  return jsonb_build_object(
    'kind', 'competition',
    'name', v_comp.name,
    'group_name', (select name from public.groups where id = v_comp.group_id),
    'member_count', (select count(*) from public.competition_participants
                      where competition_id = v_comp.id));
end;
$$;


--
-- Name: is_competition_visible(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_competition_visible(cid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
      from public.competitions c
     where c.id = cid
       and (
         c.created_by = auth.uid()
         or (c.group_id is not null and public.is_group_member(c.group_id))
         or exists (select 1 from public.competition_participants cp
                     where cp.competition_id = c.id and cp.user_id = auth.uid())
       )
  );
$$;


--
-- Name: is_group_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_group_admin(gid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and role = 'admin'
  );
$$;


--
-- Name: is_group_creator(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_group_creator(gid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.groups where id = gid and created_by = auth.uid());
$$;


--
-- Name: is_group_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_group_member(gid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;


--
-- Name: is_platform_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_platform_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  );
$$;


--
-- Name: match_day(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_day(ts timestamp with time zone) RETURNS date
    LANGUAGE sql IMMUTABLE
    AS $$
  -- G11-reglen: `timezone(text, timestamptz)` er IMMUTABLE; det er casten
  -- timestamptz::date, der er STABLE. Derfor `at time zone` FØR castet.
  select (ts at time zone 'Europe/Copenhagen')::date;
$$;


--
-- Name: match_day_complete(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_day_complete(p_day date) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (select 1 from public.matches where match_day = p_day)
     and not exists (
       select 1 from public.matches
       where match_day = p_day and (home_score is null or away_score is null)
     );
$$;


--
-- Name: match_lock_at(timestamp with time zone, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_lock_at(kickoff_at timestamp with time zone, kickoff_tbd boolean) RETURNS timestamp with time zone
    LANGUAGE sql STABLE
    AS $$
  select case
    when kickoff_at is null then null
    -- Tid ikke fastlagt: midnat på spilledagen, dansk tid. Dagen aflæses i
    -- Europe/Copenhagen og ikke i UTC, fordi det er den dag, spilleren ser.
    when kickoff_tbd then
      date_trunc('day', kickoff_at at time zone 'Europe/Copenhagen')
        at time zone 'Europe/Copenhagen'
    -- Tid fastlagt: 1 time før kampens eget kickoff (A21).
    else kickoff_at - interval '1 hour'
  end;
$$;


--
-- Name: match_locked(timestamp with time zone, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_locked(kickoff_at timestamp with time zone, kickoff_tbd boolean) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select coalesce(public.match_lock_at(kickoff_at, kickoff_tbd) <= now(), false);
$$;


--
-- Name: move_competition_to_group(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_competition_to_group(p_comp_id uuid, p_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.competitions c
    where c.id = p_comp_id and c.created_by = auth.uid()
  ) then
    raise exception 'Kun konkurrencens opretter kan flytte den';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = auth.uid()
  ) then
    raise exception 'Du er ikke medlem af den valgte liga';
  end if;

  update public.competitions set group_id = p_group_id where id = p_comp_id;

  insert into public.group_members (group_id, user_id, role)
  select p_group_id, cp.user_id, 'member'
  from public.competition_participants cp
  where cp.competition_id = p_comp_id
  on conflict (group_id, user_id) do nothing;
end;
$$;


--
-- Name: my_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_profile() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select to_jsonb(p) from public.profiles p where p.id = auth.uid();
$$;


--
-- Name: pc_points(integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pc_points(ph integer, pa integer, hs integer, as_ integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when ph is null or pa is null or hs is null or as_ is null then null
    when ph = hs and pa = as_ then 3
    when sign(ph - pa) = sign(hs - as_) then 1
    else 0 end;
$$;


--
-- Name: profiles_name_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profiles_name_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.display_name := btrim(new.display_name);

  if tg_op = 'UPDATE' and new.display_name is distinct from old.display_name then
    if old.anonymized_at is not null then
      raise exception 'En lukket konto kan ikke skifte brugernavn.'
        using errcode = '42501';
    end if;
    if new.anonymized_at is null then
      new.display_name_changed_at := now();
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: prune_analytics_events(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_analytics_events(keep_months integer DEFAULT 18) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  n integer;
begin
  -- `greatest(1, …)` som i de to søskende: et kald med 0 eller et negativt tal
  -- ville ellers tømme hele tabellen, og en rydning må ikke kunne blive til en
  -- sletning ved en tastefejl i en workflow.
  delete from public.analytics_events
   where created_at < now() - make_interval(months => greatest(1, keep_months));
  get diagnostics n = row_count;
  return n;
end;
$$;


--
-- Name: prune_client_errors(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_client_errors(keep_days integer DEFAULT 90) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  n integer;
begin
  delete from public.client_errors
   where created_at < now() - make_interval(days => greatest(1, keep_days));
  get diagnostics n = row_count;
  return n;
end;
$$;


--
-- Name: prune_job_runs(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_job_runs(keep_days integer DEFAULT 30) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare removed integer;
begin
  delete from public.job_runs where started_at < now() - (keep_days || ' days')::interval;
  get diagnostics removed = row_count;
  return removed;
end;
$$;


--
-- Name: recompute_derived(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_derived() RETURNS TABLE(trin text, resultat text, varighed interval)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: recompute_ratings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_ratings() RETURNS void
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


--
-- Name: recompute_ratings_if_scores_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_ratings_if_scores_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  -- date, ikke text: matches.round_key og matches.match_day er genererede
  -- date-kolonner, og Postgres har ingen `date = text`-operator. Med text her
  -- fejlede opslaget nedenfor (m.round_key = v_round) inde i exception-guarden
  -- — altså tavst, hvorved generate_stories aldrig blev kaldt.
  -- generate_stories tager text og får derfor et eksplicit ::text;
  -- generate_daily_stories tager date og får ingen cast.
  v_round date;
  v_day   date;
  -- Instrumentering (august 2026). Se kommentaren ved logskrivningen nedenfor.
  v_t0      timestamptz;
  v_ok      boolean := true;
  v_err     text;
  v_n       int;
  v_ready   int;   -- A39: antal brugere, hvis EGEN kampdag er færdig
  v_days    jsonb := '[]'::jsonb;
  v_rounds  jsonb := '[]'::jsonb;
begin
  -- ============ 1. Rating-porten: KUN ægte resultatændringer ============
  drop table if exists _se_changed_rounds;
  create temporary table _se_changed_rounds (round_key date);

  if tg_op = 'INSERT' then
    insert into _se_changed_rounds
      select distinct round_key from new_rows
      where (home_score is not null or away_score is not null) and round_key is not null;
  elsif tg_op = 'UPDATE' then
    insert into _se_changed_rounds
      select distinct n.round_key from new_rows n
      join old_rows o on o.id = n.id
      where (n.home_score is distinct from o.home_score or n.away_score is distinct from o.away_score)
        and n.round_key is not null;
  elsif tg_op = 'DELETE' then
    insert into _se_changed_rounds
      select distinct round_key from old_rows
      where (home_score is not null or away_score is not null) and round_key is not null;
  end if;

  -- ============ 2. Historie-porten: resultater ELLER flytninger ============
  -- Bredere end rating-porten, og det er med vilje. En udsat kamp, der flytter
  -- UD af en dag eller en runde, kan GØRE den dag/runde færdig, uden at ét
  -- eneste resultat er ændret — v1 så aldrig det øjeblik. Rating er derimod
  -- uberørt af flytningen (kampen havde ingen score), så den må ikke trække en
  -- fuld Elo-genberegning med sig. Derfor to porte.
  drop table if exists _se_story_days;
  drop table if exists _se_story_rounds;
  create temporary table _se_story_days (day_key date);
  create temporary table _se_story_rounds (round_key date);

  if tg_op = 'INSERT' then
    insert into _se_story_days   select distinct match_day from new_rows where match_day is not null;
    insert into _se_story_rounds select distinct round_key from new_rows where round_key is not null;
  elsif tg_op = 'UPDATE' then
    -- Både den NYE og den GAMLE dag/runde skal med ved en flytning: den gamle
    -- kan nu være komplet, fordi kampen forlod den.
    insert into _se_story_days
      select distinct d from (
        select n.match_day as d from new_rows n join old_rows o on o.id = n.id
         where n.home_score is distinct from o.home_score
            or n.away_score is distinct from o.away_score
            or n.match_day  is distinct from o.match_day
        union all
        select o.match_day from new_rows n join old_rows o on o.id = n.id
         where n.match_day is distinct from o.match_day
      ) x where d is not null;
    insert into _se_story_rounds
      select distinct r from (
        select n.round_key as r from new_rows n join old_rows o on o.id = n.id
         where n.home_score is distinct from o.home_score
            or n.away_score is distinct from o.away_score
            or n.round_key  is distinct from o.round_key
        union all
        select o.round_key from new_rows n join old_rows o on o.id = n.id
         where n.round_key is distinct from o.round_key
      ) x where r is not null;
  elsif tg_op = 'DELETE' then
    insert into _se_story_days   select distinct match_day from old_rows where match_day is not null;
    insert into _se_story_rounds select distinct round_key from old_rows where round_key is not null;
  end if;

  -- ============ 3. Rating ============
  if exists (select 1 from _se_changed_rounds) then
    perform public.recompute_ratings();
  end if;

  -- ============ 4. Historier og milepæle — best-effort ============
  -- Må ALDRIG kunne blokere resultat-lagring eller rating (derfor guarden).
  if exists (select 1 from _se_story_days) or exists (select 1 from _se_story_rounds) then
    v_t0 := clock_timestamp();
    begin
      -- DAGE FØRST og i kronologisk orden: en dags kort må ikke lande efter
      -- rundens afsluttende kort, og karusellen læses i samme retning.
      for v_day in (select distinct day_key from _se_story_days order by 1) loop
        -- 🔴 INTET FORTJEK (A39, august 2026). Her stod
        -- `if public.match_day_complete(v_day) then …`, og det kunne ikke blive
        -- stående: prædikatet er GLOBALT, så det ville spærre triggerens vej ind
        -- for enhver bruger, hvis egne konkurrencer var færdigspillet, og A39
        -- ville ikke være leveret uanset hvad motoren gjorde.
        --
        -- Det kunne heller ikke bare gøres personligt HER. Så ville reglen ligge
        -- to steder — ordret den tilstand, `G92` blev til for at afskaffe: en
        -- regel, hver kalder skal huske, er den regel, den femte kalder glemmer.
        -- Motoren spørger selv, og efter A39 er spørgsmålet ikke længere boolsk,
        -- men "for HVEM er dagen færdig?". Det er ikke triggerens at stille.
        perform public.generate_daily_stories(v_day);

        -- SPORET OVERLEVER, MEN SKIFTER FORM. `complete` var et ja/nej om DAGEN
        -- og har ingen sand værdi længere. `ready` er antallet af brugere, hvis
        -- egen dag er færdig: nul betyder præcis dét, `complete: false` betød —
        -- ingen kan få et kort endnu — mens en forskel mellem `ready` og `cards`
        -- er frosne kort, altså en oplysning, det gamle boolske ikke kunne bære.
        -- Grenen "dagen var ikke komplet" og grenen "dagen fejlede" kan stadig
        -- skelnes, og det var hele grunden til at logge dem hver for sig.
        select count(*) into v_ready from public.users_with_complete_day(v_day);
        select count(*) into v_n
          from public.stories where period = 'day' and day_key = v_day;
        v_days := v_days || jsonb_build_object('day', v_day, 'ready', v_ready, 'cards', v_n);
      end loop;

      -- DEREFTER rundens afsluttende kort. Betingelsen er uændret fra v1 og ER
      -- allerede "rundens sidste dag": en runde kan først stå uden manglende
      -- resultater på den sidste dag, der havde kampe. Spilles alt søndag,
      -- lander konklusionen søndag, selvom runden formelt løber til mandag.
      for v_round in (select distinct round_key from _se_story_rounds order by 1) loop
        if exists (select 1 from public.matches m where m.round_key = v_round)
           and not exists (
             select 1 from public.matches m
             where m.round_key = v_round and (m.home_score is null or m.away_score is null)
           )
        then
          perform public.generate_stories(v_round::text);
          select count(*) into v_n
            from public.stories where period = 'round' and round_key = v_round::text;
          v_rounds := v_rounds || jsonb_build_object('round', v_round, 'complete', true, 'cards', v_n);
          -- MILEPÆLE KALDES IKKE HERFRA (v2.1, august 2026).
          --
          -- De gjorde det i første udgave, med den begrundelse at alt kampdrevet
          -- bliver sandt netop her, hvor ratings lige er genberegnet — og at
          -- brugeren kigger på sit kort i samme øjeblik. Et skaleringsforsøg på
          -- en syntetisk fuld sæson (sql/tests/story_engine_scale.sql) målte
          -- prisen: `award_milestones()` kostede ~505 ms og bragte hele
          -- trigger-sætningen op på ~1,07 s — inde i den sætning,
          -- api/sync-live.js bruger til at afslutte en kamp. Uden den er
          -- sætningen ~565 ms.
          --
          -- Prisen for at flytte den er, at en milepæl vises op til én
          -- cron-kørsel senere (15–30 min) i stedet for med det samme. Den pris
          -- er lille: kortet ligger i karusellen resten af runden. Prisen for at
          -- blive var et halvt sekund oven på hver eneste rundeafslutning, for
          -- et kald der næsten altid ikke uddeler noget.
          --
          -- api/send-notifications.js er nu ENESTE kalder — den var i forvejen
          -- den pålidelige skriver for de tre ikke-kampdrevne familier.
        else
          v_rounds := v_rounds || jsonb_build_object('round', v_round, 'complete', false, 'cards', 0);
        end if;
      end loop;
    exception when others then
      -- warning, ikke notice: guarden skal blive ved med at beskytte resultat-
      -- lagringen, men en fejl må ikke være usynlig igen (jf. A9, juli 2026).
      -- warning når Postgres-loggen som standard; notice gjorde ikke.
      v_ok  := false;
      v_err := sqlerrm;
      raise warning 'story-generering fejlede (ignoreret, resultater/rating er uberørte): %', sqlerrm;
    end;

    -- ============ 5. Sporet — UDEN FOR GUARDEN ============
    -- Guarden beskytter resultat-lagringen, men den efterlod intet spor, og en
    -- `raise warning` i Postgres-loggen er i praksis usynlig. Følgen blev meldt
    -- 7. august 2026: v3's dagsmotor havde aldrig skrevet en eneste række i
    -- produktion, og det kunne ikke ses nogen steder — en STILHED kan ikke
    -- skelnes fra en rolig uge. Det er samme fejltype som `A9` (juli 2026),
    -- hvor motoren aldrig havde genereret noget overhovedet.
    --
    -- SKRIVNINGEN SKAL LIGGE HER OG IKKE INDE I BLOKKEN, og det er hele pointen:
    -- `begin … exception … end` er en SUBTRANSAKTION. Stod insert'en indenfor,
    -- ville den blive rullet tilbage sammen med alt andet, netop når der var
    -- noget at fortælle. Variablerne overlever derimod rulningen — de er
    -- hukommelse, ikke databasetilstand.
    --
    -- Egen guard, fordi et fejlende spor aldrig må vælte det, det sporer.
    begin
      insert into public.job_runs (job, started_at, finished_at, ok, detail, error)
      values ('story-engine', v_t0, clock_timestamp(), v_ok,
              jsonb_build_object('op', tg_op, 'days', v_days, 'rounds', v_rounds),
              v_err);
    exception when others then null;
    end;
  end if;

  drop table if exists _se_changed_rounds;
  drop table if exists _se_story_days;
  drop table if exists _se_story_rounds;
  return null;
end;
$$;


--
-- Name: refresh_kickoff_uncertain(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_kickoff_uncertain(p_season_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  v_n integer;
begin
  -- `drop` først: funktionen kan kaldes to gange i samme transaktion (to sæsoner
  -- i samme turnering), og `on commit drop` rydder først ved commit. Samme
  -- mønster som `_se_changed_rounds` i rating_trigger_optimization.sql.
  drop table if exists _ku_maal;
  create temporary table _ku_maal on commit drop as
  with laert as (
    -- Trin 2. `having count(*) >= 3` er gulvet, og `group by` på klokkeslættet
    -- er det, der gør, at tre flytninger fra TRE FORSKELLIGE klokkeslæt ikke
    -- lærer noget: en omberammelse her og der ser ikke ud som et regime.
    select (m.kickoff_prev_at at time zone 'UTC')::time as tid
      from public.matches m
     where m.season_id = p_season_id
       and m.kickoff_prev_at is not null
     group by 1
    having count(*) >= 3
  ),
  beregnet as (
    -- Trin 3. Bemærk at udtrykket også siger `false` — en kamp, hvis tid er
    -- blevet rettet, eller som er blevet spillet, mister sin markør her.
    -- `home_score is null` ALENE, uden `away_score`. Hele appen læser netop den
    -- ene kolonne som "kampen er spillet" (api/sync-matches.js, `_rs` i
    -- rating_core.sql, G84's kontrol), og en ekstra betingelse, der aldrig kan
    -- være uenig med den, er en gren, ingen test kan nå — `G84`s egen lære.
    select m.id,
           m.home_score is null
             and exists (
               select 1 from laert l
                where l.tid = (m.kickoff_at at time zone 'UTC')::time
             ) as vaerdi
      from public.matches m
     where m.season_id = p_season_id
  )
  select b.id, b.vaerdi
    from beregnet b
    join public.matches m on m.id = b.id
   where m.kickoff_uncertain is distinct from b.vaerdi;

  select count(*)::int into v_n from _ku_maal;
  if v_n = 0 then
    return 0;
  end if;

  update public.matches m
     set kickoff_uncertain = t.vaerdi
    from _ku_maal t
   where m.id = t.id;

  return v_n;
end;
$$;


--
-- Name: remember_participant_baseline(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remember_participant_baseline() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.competitions where id = old.competition_id)
     or not exists (select 1 from public.profiles where id = old.user_id) then
    return old;
  end if;

  insert into public.competition_participant_history (competition_id, user_id, first_joined_at)
  values (old.competition_id, old.user_id, old.joined_at)
  on conflict (competition_id, user_id) do nothing;

  -- `do nothing` + en betinget `update` frem for `do update set least(…)`, og
  -- det er ikke en omskrivning for smagens skyld: vagt 2 i
  -- `sql/migration_syntax.test.js` afviser enhver `update … set` uden `where`,
  -- og en `on conflict do update set` ligner præcis dét for en grep. Vagten er
  -- bevidst grov (`G86`), og filens eget svar på en falsk positiv er at
  -- omskrive sætningen frem for at svække vagten. Formen her er desuden den
  -- ærligste: `where first_joined_at > old.joined_at` SIGER, at nulpunktet kun
  -- flytter sig bagud, hvor `least()` skulle læses for at afsløre det.
  update public.competition_participant_history
     set first_joined_at = old.joined_at
   where competition_id = old.competition_id
     and user_id = old.user_id
     and first_joined_at > old.joined_at;

  return old;
end;
$$;


--
-- Name: remember_previous_kickoff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remember_previous_kickoff() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.kickoff_prev_at := old.kickoff_at;
  return new;
end;
$$;


--
-- Name: restore_participant_baseline(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_participant_baseline() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_first timestamptz;
begin
  select h.first_joined_at into v_first
    from public.competition_participant_history h
   where h.competition_id = new.competition_id
     and h.user_id = new.user_id;

  if v_first is not null then
    new.joined_at := least(new.joined_at, v_first);
  end if;

  return new;
end;
$$;


--
-- Name: round_key(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.round_key(ts timestamp with time zone) RETURNS date
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


--
-- Name: round_key_of_date(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.round_key_of_date(d date) RETURNS date
    LANGUAGE sql IMMUTABLE
    AS $$
  select d - ((extract(dow from d)::int - 2 + 7) % 7);
$$;


--
-- Name: touch_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_activity() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then
    return;
  end if;

  update public.profiles
    set last_seen_at = now()
    where id = auth.uid();

  insert into public.user_activity_days (user_id, day)
  values (auth.uid(), (now() at time zone 'utc')::date)
  on conflict (user_id, day) do nothing;
end;
$$;


--
-- Name: touch_prediction_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_prediction_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  -- Kun ved en RIGTIG ændring. Et upsert, der skriver den samme score igen
  -- (klienten gemmer ved hvert tastetryk-ophold), er ikke en rettelse, og et
  -- felt, der flytter sig uden at noget skete, ville gøre "aktiv" til "åbnede
  -- skærmen" — præcis den udvanding, målene skal undgå.
  if new.pred_home is distinct from old.pred_home
     or new.pred_away is distinct from old.pred_away then
    new.updated_at := now();
  end if;
  return new;
end;
$$;


--
-- Name: user_day_scope(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_day_scope(p_day date) RETURNS TABLE(user_id uuid, n_matches integer, n_open integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with scope as (
    select distinct
           cp.user_id                                                as u_id,
           m.id                                                      as match_id,
           (m.home_score is null or m.away_score is null)            as is_open
    from public.matches m
    join public.competition_matches cm on cm.match_id = m.id
    join public.competition_participants cp on cp.competition_id = cm.competition_id
    where m.match_day = p_day
  )
  select s.u_id,
         count(*)::int,
         count(*) filter (where s.is_open)::int
  from scope s
  group by s.u_id;
$$;


--
-- Name: FUNCTION user_day_scope(p_day date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.user_day_scope(p_day date) IS 'A39: brugerens personlige kampdag. Antal af dagens kampe, som hendes konkurrencer dækker, og hvor mange af dem der mangler resultat. Afgrænsningen står KUN her.';


--
-- Name: username_available(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.username_available(name text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select not exists (
    select 1 from public.profiles where lower(display_name) = lower(trim(name))
  );
$$;


--
-- Name: users_with_complete_day(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.users_with_complete_day(p_day date) RETURNS TABLE(user_id uuid, n_matches integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select s.user_id, s.n_matches
  from public.user_day_scope(p_day) s
  where s.n_open = 0;
$$;


--
-- Name: FUNCTION users_with_complete_day(p_day date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.users_with_complete_day(p_day date) IS 'A39: alle brugere, hvis egne konkurrencer er færdigspillet på p_day. Modtagerkredsen for dagskortet.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    home_team_id uuid NOT NULL,
    away_team_id uuid NOT NULL,
    kickoff_at timestamp with time zone NOT NULL,
    round_key date GENERATED ALWAYS AS (public.round_key(kickoff_at)) STORED,
    home_score integer,
    away_score integer,
    status text DEFAULT 'scheduled'::text NOT NULL,
    api_fixture_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stage_name text,
    live_home_score integer,
    live_away_score integer,
    live_state text,
    live_minute integer,
    live_updated_at timestamp with time zone,
    kickoff_tbd boolean DEFAULT false NOT NULL,
    match_day date GENERATED ALWAYS AS (public.match_day(kickoff_at)) STORED,
    kickoff_prev_at timestamp with time zone,
    kickoff_uncertain boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN matches.live_home_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.live_home_score IS 'Nuværende mål (hjemme) mens kampen spilles. Null når kampen ikke er i gang. Tæller ALDRIG point.';


--
-- Name: COLUMN matches.live_away_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.live_away_score IS 'Nuværende mål (ude) mens kampen spilles. Null når kampen ikke er i gang. Tæller ALDRIG point.';


--
-- Name: COLUMN matches.live_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.live_state IS 'Sportmonks-state (developer_name), fx INPLAY_1ST_HALF, HT, INPLAY_2ND_HALF. Null = ikke i gang.';


--
-- Name: COLUMN matches.live_minute; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.live_minute IS 'Spilleminut fra den tickende periode. Null i pauser og når minuttet er ukendt.';


--
-- Name: COLUMN matches.live_updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.live_updated_at IS 'Hvornår live-felterne sidst blev opdateret af api/sync-live.js.';


--
-- Name: COLUMN matches.kickoff_tbd; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.kickoff_tbd IS 'Klokkeslættet i kickoff_at er en pladsholder — kun datoen er kendt. Sættes af api/sync-matches ud fra leverandørens egen markør.';


--
-- Name: COLUMN matches.kickoff_prev_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.kickoff_prev_at IS 'Den forrige kickoff_at, gemt af matches_remember_previous_kickoff når tiden flytter sig. Grundlaget for de indlærte pladsholder-klokkeslæt (G85).';


--
-- Name: COLUMN matches.kickoff_uncertain; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matches.kickoff_uncertain IS 'Klokkeslættet i kickoff_at er sandsynligvis leverandørens gæt — datoen er kendt. DISPLAY-ONLY: låsen og påmindelserne er upåvirkede, modsat kickoff_tbd. Sættes af refresh_kickoff_uncertain() (G85).';


--
-- Name: analytics_match_locks; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.analytics_match_locks AS
 SELECT id AS match_id,
    season_id,
    round_key,
    kickoff_at,
    public.match_lock_at(kickoff_at, kickoff_tbd) AS lock_at,
    public.match_locked(kickoff_at, kickoff_tbd) AS is_locked,
    kickoff_tbd
   FROM public.matches m
  WHERE (kickoff_at IS NOT NULL);


--
-- Name: competition_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_matches (
    competition_id uuid NOT NULL,
    match_id uuid NOT NULL
);


--
-- Name: competition_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_participants (
    competition_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    hidden boolean DEFAULT false NOT NULL
);


--
-- Name: competitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    league_id uuid,
    season_id uuid,
    mode text NOT NULL,
    mode_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    rules jsonb DEFAULT '{"exact": 3, "outcome": 1}'::jsonb NOT NULL,
    invite_code text DEFAULT substr(md5((random())::text), 1, 8) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    group_id uuid,
    CONSTRAINT competitions_mode_check CHECK ((mode = ANY (ARRAY['full_season'::text, 'team'::text, 'time_range'::text, 'custom'::text, 'random'::text])))
);


--
-- Name: predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.predictions (
    user_id uuid NOT NULL,
    match_id uuid NOT NULL,
    pred_home integer NOT NULL,
    pred_away integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_completion_facts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.analytics_completion_facts AS
 SELECT cp.user_id,
    cm.competition_id,
    c.group_id,
    m.id AS match_id,
    m.season_id,
    m.round_key,
    rl.lock_at,
    (date_trunc('week'::text, rl.lock_at))::date AS week,
    to_char(rl.lock_at, 'YYYY-MM'::text) AS month,
    (p.user_id IS NOT NULL) AS predicted
   FROM (((((public.competition_participants cp
     JOIN public.competitions c ON ((c.id = cp.competition_id)))
     JOIN public.competition_matches cm ON ((cm.competition_id = c.id)))
     JOIN public.matches m ON ((m.id = cm.match_id)))
     JOIN public.analytics_match_locks rl ON ((rl.match_id = m.id)))
     LEFT JOIN public.predictions p ON (((p.user_id = cp.user_id) AND (p.match_id = m.id))))
  WHERE ((rl.lock_at <= now()) AND (rl.lock_at >= cp.joined_at));


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_name text NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    group_id uuid,
    competition_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analytics_events_name_check CHECK ((event_name = ANY (ARRAY['account_created'::text, 'login'::text, 'logout'::text, 'league_created'::text, 'league_joined'::text, 'league_invite_sent'::text, 'league_invite_accepted'::text, 'invite_landed'::text, 'competition_created'::text, 'competition_joined'::text, 'competition_opened'::text, 'prediction_started'::text, 'prediction_saved'::text, 'prediction_updated'::text, 'prediction_submitted'::text, 'opened_home'::text, 'opened_tip'::text, 'opened_league'::text, 'opened_standings'::text, 'opened_rating'::text, 'opened_career'::text, 'opened_story'::text, 'opened_championship'::text, 'story_viewed'::text, 'story_shared'::text, 'story_score_distribution'::text, 'story_frame_viewed'::text, 'milestone_cta_clicked'::text, 'standings_shared'::text, 'push_opened'::text])))
);


--
-- Name: analytics_round_locks; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.analytics_round_locks AS
 SELECT season_id,
    round_key,
    min(kickoff_at) AS first_kickoff,
    (min(kickoff_at) - '01:00:00'::interval) AS round_start_at,
    ((min(kickoff_at) - '01:00:00'::interval) <= now()) AS has_started,
    count(*) AS match_count,
    count(*) FILTER (WHERE ((home_score IS NOT NULL) AND (away_score IS NOT NULL))) AS finished_count
   FROM public.matches m
  WHERE (kickoff_at IS NOT NULL)
  GROUP BY season_id, round_key;


--
-- Name: client_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid(),
    kind text NOT NULL,
    message text NOT NULL,
    stack text,
    component_stack text,
    screen text,
    app_version text,
    url text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_errors_component_stack_len CHECK (((component_stack IS NULL) OR (char_length(component_stack) <= 8000))),
    CONSTRAINT client_errors_kind_check CHECK ((kind = ANY (ARRAY['render'::text, 'error'::text, 'rejection'::text]))),
    CONSTRAINT client_errors_message_len CHECK (((char_length(message) >= 1) AND (char_length(message) <= 2000))),
    CONSTRAINT client_errors_stack_len CHECK (((stack IS NULL) OR (char_length(stack) <= 8000)))
);


--
-- Name: competition_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_awards (
    competition_id uuid NOT NULL,
    period_type text NOT NULL,
    period_key text NOT NULL,
    user_id uuid NOT NULL,
    points integer NOT NULL,
    shared boolean DEFAULT false NOT NULL,
    stats jsonb DEFAULT '{}'::jsonb NOT NULL,
    awarded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT competition_awards_period_type_check CHECK ((period_type = ANY (ARRAY['round'::text, 'month'::text])))
);


--
-- Name: competition_match_points; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.competition_match_points WITH (security_invoker='on') AS
 SELECT cm.competition_id,
    pr.user_id,
    m.id AS match_id,
    m.round_key,
    m.match_day,
    public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) AS pts,
    (abs((pr.pred_home - m.home_score)) + abs((pr.pred_away - m.away_score))) AS goal_err
   FROM (((public.competition_matches cm
     JOIN public.matches m ON ((m.id = cm.match_id)))
     JOIN public.predictions pr ON ((pr.match_id = m.id)))
     JOIN public.competition_participants cp ON (((cp.competition_id = cm.competition_id) AND (cp.user_id = pr.user_id))))
  WHERE ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL) AND (pr.pred_home IS NOT NULL) AND (pr.pred_away IS NOT NULL) AND COALESCE((public.match_lock_at(m.kickoff_at, m.kickoff_tbd) > cp.joined_at), true));


--
-- Name: competition_participant_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_participant_history (
    competition_id uuid NOT NULL,
    user_id uuid NOT NULL,
    first_joined_at timestamp with time zone NOT NULL
);


--
-- Name: seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    name text NOT NULL,
    api_season_id text,
    start_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at date,
    is_finished boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN seasons.ends_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.seasons.ends_at IS 'Sæsonens sidste spilledag ifølge datakilden. Sat af api/sync-matches.js. Null = ukendt.';


--
-- Name: COLUMN seasons.is_finished; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.seasons.is_finished IS 'Sæsonen er slut og kan ikke få flere kampe. Sættes kun TIL true af sync; at rulle den tilbage er en bevidst handling i Admin → Drift.';


--
-- Name: competition_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.competition_status WITH (security_invoker='on') AS
 WITH cm AS (
         SELECT cm.competition_id,
            m.id AS match_id,
            m.season_id,
            ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL)) AS scored
           FROM (public.competition_matches cm
             JOIN public.matches m ON ((m.id = cm.match_id)))
        ), agg AS (
         SELECT cm.competition_id,
            (count(*))::integer AS matches,
            (count(*) FILTER (WHERE cm.scored))::integer AS scored_matches
           FROM cm
          GROUP BY cm.competition_id
        ), growable AS (
         SELECT c.id AS competition_id,
            ((c.mode = ANY (ARRAY['full_season'::text, 'team'::text, 'time_range'::text])) AND (NOT (c.mode_params ? 'stages'::text))) AS can_grow
           FROM public.competitions c
        ), seasons_done AS (
         SELECT x.competition_id,
            bool_and(COALESCE(sd_1.done, false)) AS seasons_complete
           FROM (( SELECT DISTINCT cm.competition_id,
                    cm.season_id
                   FROM cm) x
             JOIN LATERAL ( SELECT (bool_and(((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL))) AND COALESCE((s.is_finished OR ((s.ends_at IS NOT NULL) AND (s.ends_at < CURRENT_DATE)) OR ((s.ends_at IS NULL) AND (max(m.kickoff_at) < (now() - '30 days'::interval)))), false)) AS done
                   FROM (public.matches m
                     JOIN public.seasons s ON ((s.id = x.season_id)))
                  WHERE (m.season_id = x.season_id)
                  GROUP BY s.is_finished, s.ends_at) sd_1 ON (true))
          GROUP BY x.competition_id
        )
 SELECT a.competition_id,
    a.matches,
    a.scored_matches,
    g.can_grow,
    COALESCE(sd.seasons_complete, true) AS seasons_complete,
    ((a.matches > 0) AND (a.scored_matches = a.matches) AND ((NOT g.can_grow) OR COALESCE(sd.seasons_complete, true))) AS concluded
   FROM ((agg a
     JOIN growable g ON ((g.competition_id = a.competition_id)))
     LEFT JOIN seasons_done sd ON ((sd.competition_id = a.competition_id)));


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid(),
    kind text NOT NULL,
    message text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    handled_at timestamp with time zone,
    handled_by uuid,
    CONSTRAINT feedback_kind_check CHECK ((kind = ANY (ARRAY['problem'::text, 'idea'::text, 'other'::text]))),
    CONSTRAINT feedback_message_len CHECK (((char_length(message) >= 4) AND (char_length(message) <= 2000)))
);


--
-- Name: group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_members (
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT group_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    invite_code text DEFAULT substr(md5(((random())::text || (clock_timestamp())::text)), 1, 8) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT groups_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 40)))
);


--
-- Name: group_counts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.group_counts WITH (security_invoker='on') AS
 SELECT id AS group_id,
    (( SELECT count(*) AS count
           FROM public.group_members m
          WHERE (m.group_id = g.id)))::integer AS member_count,
    (( SELECT count(*) AS count
           FROM public.competitions c
          WHERE (c.group_id = g.id)))::integer AS competition_count
   FROM public.groups g;


--
-- Name: job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_runs (
    id bigint NOT NULL,
    job text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    ok boolean,
    detail jsonb,
    error text
);


--
-- Name: job_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.job_runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.job_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: stories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    round_key text NOT NULL,
    user_id uuid NOT NULL,
    competition_id uuid,
    rule text NOT NULL,
    priority integer NOT NULL,
    league_size integer,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    headline text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    dismissed_at timestamp with time zone,
    period text DEFAULT 'round'::text NOT NULL,
    day_key date,
    news_value integer,
    CONSTRAINT stories_day_key_shape CHECK (((period = 'day'::text) = (day_key IS NOT NULL))),
    CONSTRAINT stories_period_check CHECK ((period = ANY (ARRAY['round'::text, 'day'::text])))
);


--
-- Name: latest_story; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.latest_story WITH (security_invoker='on') AS
 SELECT DISTINCT ON (user_id, round_key) id,
    round_key,
    user_id,
    competition_id,
    rule,
    priority,
    league_size,
    payload,
    headline,
    body,
    created_at,
    dismissed_at,
    day_key,
    period
   FROM public.stories
  WHERE (period = 'round'::text)
  ORDER BY user_id, round_key, priority, league_size DESC NULLS LAST, competition_id;


--
-- Name: leagues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leagues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    api_league_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_visible boolean DEFAULT true NOT NULL,
    is_official boolean DEFAULT true NOT NULL,
    provider text DEFAULT 'sportmonks'::text NOT NULL,
    live_enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT leagues_official_implies_visible CHECK (((NOT is_official) OR is_visible)),
    CONSTRAINT leagues_provider_check CHECK ((provider = ANY (ARRAY['sportmonks'::text, 'footballdata'::text])))
);


--
-- Name: milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.milestones (
    user_id uuid NOT NULL,
    key text NOT NULL,
    family text NOT NULL,
    tier integer DEFAULT 0 NOT NULL,
    competition_id uuid,
    round_key text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    achieved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: monthly_standings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.monthly_standings WITH (security_invoker='on') AS
 WITH scored AS (
         SELECT to_char(date_trunc('month'::text, m.kickoff_at), 'YYYY-MM'::text) AS month,
            m.round_key,
            l.id AS league_id,
            p.user_id,
            public.pc_points(p.pred_home, p.pred_away, m.home_score, m.away_score) AS pts,
            (abs((p.pred_home - m.home_score)) + abs((p.pred_away - m.away_score))) AS goal_err
           FROM (((public.predictions p
             JOIN public.matches m ON ((m.id = p.match_id)))
             JOIN public.seasons s_1 ON ((s_1.id = m.season_id)))
             JOIN public.leagues l ON (((l.id = s_1.league_id) AND l.is_official)))
          WHERE ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL) AND (p.pred_home IS NOT NULL) AND (p.pred_away IS NOT NULL))
        ), scoped AS (
         SELECT sc.month,
            sc.round_key,
            sc.user_id,
            sc.pts,
            sc.goal_err,
            x.scope
           FROM (scored sc
             CROSS JOIN LATERAL ( VALUES ('ALL'::text), ((sc.league_id)::text)) x(scope))
        ), per_round AS (
         SELECT scoped.scope,
            scoped.month,
            scoped.user_id,
            rank() OVER (PARTITION BY scoped.scope, scoped.month, scoped.round_key ORDER BY (sum(scoped.pts)) DESC, (count(*) FILTER (WHERE (scoped.pts = 3))) DESC, (count(*) FILTER (WHERE (scoped.pts = 1))) DESC, (round(((sum(scoped.goal_err))::numeric / (count(*))::numeric), 4))) AS rnk
           FROM scoped
          GROUP BY scoped.scope, scoped.month, scoped.round_key, scoped.user_id
        ), wins AS (
         SELECT per_round.scope,
            per_round.month,
            per_round.user_id,
            (count(*))::integer AS round_wins
           FROM per_round
          WHERE (per_round.rnk = 1)
          GROUP BY per_round.scope, per_round.month, per_round.user_id
        )
 SELECT s.month,
    s.scope,
    s.user_id,
    (sum(s.pts))::integer AS total_points,
    (count(*))::integer AS matches,
    (count(*) FILTER (WHERE (s.pts = 3)))::integer AS exact_count,
    (count(*) FILTER (WHERE (s.pts = 1)))::integer AS outcome_count,
    round(((sum(s.goal_err))::numeric / (count(*))::numeric), 4) AS avg_goal_error,
    COALESCE(w.round_wins, 0) AS round_wins
   FROM (scoped s
     LEFT JOIN wins w ON (((w.scope = s.scope) AND (NOT (w.month IS DISTINCT FROM s.month)) AND (w.user_id = s.user_id))))
  GROUP BY s.month, s.scope, s.user_id, w.round_wins;


--
-- Name: notification_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_log (
    user_id uuid NOT NULL,
    key text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    last_seen_at timestamp with time zone,
    anonymized_at timestamp with time zone,
    display_name_changed_at timestamp with time zone
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rating_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rating_history (
    user_id uuid NOT NULL,
    scope text DEFAULT 'ALL'::text NOT NULL,
    round_key text NOT NULL,
    rating_after numeric NOT NULL,
    delta numeric NOT NULL,
    round_score numeric NOT NULL,
    matches_predicted integer NOT NULL,
    rnk integer NOT NULL
);


--
-- Name: ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ratings (
    user_id uuid NOT NULL,
    scope text DEFAULT 'ALL'::text NOT NULL,
    rating numeric NOT NULL,
    rounds_played integer NOT NULL,
    provisional boolean NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: round_standings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.round_standings WITH (security_invoker='on') AS
 WITH scored AS (
         SELECT m.round_key,
            l.id AS league_id,
            pr.user_id,
            public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) AS pts,
            (abs((pr.pred_home - m.home_score)) + abs((pr.pred_away - m.away_score))) AS goal_err
           FROM (((public.predictions pr
             JOIN public.matches m ON ((m.id = pr.match_id)))
             JOIN public.seasons s ON ((s.id = m.season_id)))
             JOIN public.leagues l ON (((l.id = s.league_id) AND l.is_official)))
          WHERE ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL) AND (pr.pred_home IS NOT NULL) AND (pr.pred_away IS NOT NULL))
        ), scoped AS (
         SELECT sc.round_key,
            sc.user_id,
            sc.pts,
            sc.goal_err,
            x.scope
           FROM (scored sc
             CROSS JOIN LATERAL ( VALUES ('ALL'::text), ((sc.league_id)::text)) x(scope))
        )
 SELECT round_key,
    scope,
    user_id,
    (count(*))::integer AS matches,
    (sum(pts))::integer AS total_points,
    (count(*) FILTER (WHERE (pts = 3)))::integer AS exact_count,
    (count(*) FILTER (WHERE (pts = 1)))::integer AS outcome_count,
    round(((sum(goal_err))::numeric / (count(*))::numeric), 4) AS avg_goal_error
   FROM scoped
  GROUP BY round_key, scope, user_id;


--
-- Name: season_standings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.season_standings WITH (security_invoker='on') AS
 WITH scored AS (
         SELECT m.season_id,
            m.round_key,
            pr.user_id,
            public.pc_points(pr.pred_home, pr.pred_away, m.home_score, m.away_score) AS pts,
            (abs((pr.pred_home - m.home_score)) + abs((pr.pred_away - m.away_score))) AS goal_err
           FROM (public.predictions pr
             JOIN public.matches m ON ((m.id = pr.match_id)))
          WHERE ((m.home_score IS NOT NULL) AND (m.away_score IS NOT NULL) AND (pr.pred_home IS NOT NULL) AND (pr.pred_away IS NOT NULL))
        ), per_round AS (
         SELECT scored.season_id,
            scored.user_id,
            rank() OVER (PARTITION BY scored.season_id, scored.round_key ORDER BY (sum(scored.pts)) DESC, (count(*) FILTER (WHERE (scored.pts = 3))) DESC, (count(*) FILTER (WHERE (scored.pts = 1))) DESC, (round(((sum(scored.goal_err))::numeric / (count(*))::numeric), 4))) AS rnk
           FROM scored
          GROUP BY scored.season_id, scored.round_key, scored.user_id
        ), wins AS (
         SELECT per_round.season_id,
            per_round.user_id,
            (count(*))::integer AS round_wins
           FROM per_round
          WHERE (per_round.rnk = 1)
          GROUP BY per_round.season_id, per_round.user_id
        )
 SELECT s.season_id,
    s.user_id,
    (count(*))::integer AS matches,
    (sum(s.pts))::integer AS total_points,
    (count(*) FILTER (WHERE (s.pts = 3)))::integer AS exact_count,
    (count(*) FILTER (WHERE (s.pts = 1)))::integer AS outcome_count,
    round(((sum(s.goal_err))::numeric / (count(*))::numeric), 4) AS avg_goal_error,
    COALESCE(w.round_wins, 0) AS round_wins
   FROM (scored s
     LEFT JOIN wins w ON (((NOT (w.season_id IS DISTINCT FROM s.season_id)) AND (w.user_id = s.user_id))))
  GROUP BY s.season_id, s.user_id, w.round_wins;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    name text NOT NULL,
    api_team_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_activity_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_activity_days (
    user_id uuid NOT NULL,
    day date DEFAULT ((now() AT TIME ZONE 'utc'::text))::date NOT NULL
);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: client_errors client_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_errors
    ADD CONSTRAINT client_errors_pkey PRIMARY KEY (id);


--
-- Name: competition_awards competition_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_awards
    ADD CONSTRAINT competition_awards_pkey PRIMARY KEY (competition_id, period_type, period_key, user_id);


--
-- Name: competition_matches competition_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_matches
    ADD CONSTRAINT competition_matches_pkey PRIMARY KEY (competition_id, match_id);


--
-- Name: competition_participant_history competition_participant_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participant_history
    ADD CONSTRAINT competition_participant_history_pkey PRIMARY KEY (competition_id, user_id);


--
-- Name: competition_participants competition_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_pkey PRIMARY KEY (competition_id, user_id);


--
-- Name: competitions competitions_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_invite_code_key UNIQUE (invite_code);


--
-- Name: competitions competitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (group_id, user_id);


--
-- Name: groups groups_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_invite_code_key UNIQUE (invite_code);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: job_runs job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);


--
-- Name: leagues leagues_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_name_unique UNIQUE (name);


--
-- Name: leagues leagues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);


--
-- Name: leagues leagues_provider_api_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_provider_api_id_unique UNIQUE (provider, api_league_id);


--
-- Name: matches matches_api_fixture_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_api_fixture_id_unique UNIQUE (api_fixture_id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: milestones milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT milestones_pkey PRIMARY KEY (user_id, key);


--
-- Name: notification_log notification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_pkey PRIMARY KEY (user_id, key);


--
-- Name: predictions predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_pkey PRIMARY KEY (user_id, match_id);


--
-- Name: profiles profiles_display_name_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_display_name_len CHECK (((char_length(btrim(display_name)) >= 2) AND (char_length(btrim(display_name)) <= 20))) NOT VALID;


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: rating_history rating_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_history
    ADD CONSTRAINT rating_history_pkey PRIMARY KEY (user_id, scope, round_key);


--
-- Name: ratings ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_pkey PRIMARY KEY (user_id, scope);


--
-- Name: seasons seasons_league_api_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_league_api_id_unique UNIQUE (league_id, api_season_id);


--
-- Name: seasons seasons_league_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_league_name_unique UNIQUE (league_id, name);


--
-- Name: seasons seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);


--
-- Name: stories stories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_pkey PRIMARY KEY (id);


--
-- Name: teams teams_league_api_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_league_api_id_unique UNIQUE (league_id, api_team_id);


--
-- Name: teams teams_league_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_league_name_unique UNIQUE (league_id, name);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: user_activity_days user_activity_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_days
    ADD CONSTRAINT user_activity_days_pkey PRIMARY KEY (user_id, day);


--
-- Name: analytics_events_group_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_group_time_idx ON public.analytics_events USING btree (group_id, created_at DESC) WHERE (group_id IS NOT NULL);


--
-- Name: analytics_events_name_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_name_time_idx ON public.analytics_events USING btree (event_name, created_at DESC);


--
-- Name: analytics_events_user_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_user_time_idx ON public.analytics_events USING btree (user_id, created_at);


--
-- Name: client_errors_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_errors_created_idx ON public.client_errors USING btree (created_at DESC);


--
-- Name: competition_matches_match_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX competition_matches_match_idx ON public.competition_matches USING btree (match_id);


--
-- Name: competitions_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX competitions_group_idx ON public.competitions USING btree (group_id);


--
-- Name: feedback_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_created_idx ON public.feedback USING btree (created_at DESC);


--
-- Name: feedback_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_open_idx ON public.feedback USING btree (created_at DESC) WHERE (handled_at IS NULL);


--
-- Name: group_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX group_members_user_idx ON public.group_members USING btree (user_id);


--
-- Name: job_runs_job_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_runs_job_started_idx ON public.job_runs USING btree (job, started_at DESC);


--
-- Name: job_runs_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_runs_started_idx ON public.job_runs USING btree (started_at DESC);


--
-- Name: matches_away_team_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_away_team_id_idx ON public.matches USING btree (away_team_id);


--
-- Name: matches_home_team_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_home_team_id_idx ON public.matches USING btree (home_team_id);


--
-- Name: matches_live_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_live_state_idx ON public.matches USING btree (live_state) WHERE (live_state IS NOT NULL);


--
-- Name: matches_live_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_live_window_idx ON public.matches USING btree (kickoff_at) WHERE (home_score IS NULL);


--
-- Name: matches_match_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_match_day_idx ON public.matches USING btree (match_day);


--
-- Name: matches_match_day_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_match_day_open_idx ON public.matches USING btree (match_day) WHERE ((home_score IS NULL) OR (away_score IS NULL));


--
-- Name: matches_season_id_round_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_season_id_round_key_idx ON public.matches USING btree (season_id, round_key);


--
-- Name: milestones_user_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX milestones_user_time_idx ON public.milestones USING btree (user_id, achieved_at DESC);


--
-- Name: profiles_display_name_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_display_name_lower_idx ON public.profiles USING btree (lower(display_name));


--
-- Name: push_subscriptions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id);


--
-- Name: stories_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stories_day_idx ON public.stories USING btree (day_key) WHERE (period = 'day'::text);


--
-- Name: stories_day_slot_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stories_day_slot_uniq ON public.stories USING btree (user_id, day_key) WHERE ((period = 'day'::text) AND (news_value IS NOT NULL));


--
-- Name: stories_round_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stories_round_uniq ON public.stories USING btree (round_key, user_id, rule, competition_id) NULLS NOT DISTINCT WHERE (period = 'round'::text);


--
-- Name: stories_user_round_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stories_user_round_day_idx ON public.stories USING btree (user_id, round_key, day_key DESC, priority);


--
-- Name: competition_participants competition_participants_ensure_group; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER competition_participants_ensure_group BEFORE INSERT ON public.competition_participants FOR EACH ROW EXECUTE FUNCTION public.ensure_group_membership_for_participant();


--
-- Name: competition_participants competition_participants_remember_baseline; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER competition_participants_remember_baseline AFTER DELETE ON public.competition_participants FOR EACH ROW EXECUTE FUNCTION public.remember_participant_baseline();


--
-- Name: competition_participants competition_participants_restore_baseline; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER competition_participants_restore_baseline BEFORE INSERT ON public.competition_participants FOR EACH ROW EXECUTE FUNCTION public.restore_participant_baseline();


--
-- Name: matches matches_recompute_ratings_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER matches_recompute_ratings_del AFTER DELETE ON public.matches REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_ratings_if_scores_changed();


--
-- Name: matches matches_recompute_ratings_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER matches_recompute_ratings_ins AFTER INSERT ON public.matches REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_ratings_if_scores_changed();


--
-- Name: matches matches_recompute_ratings_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER matches_recompute_ratings_upd AFTER UPDATE ON public.matches REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_ratings_if_scores_changed();


--
-- Name: matches matches_remember_previous_kickoff; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER matches_remember_previous_kickoff BEFORE UPDATE ON public.matches FOR EACH ROW WHEN ((new.kickoff_at IS DISTINCT FROM old.kickoff_at)) EXECUTE FUNCTION public.remember_previous_kickoff();


--
-- Name: predictions predictions_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER predictions_touch_updated_at BEFORE UPDATE ON public.predictions FOR EACH ROW EXECUTE FUNCTION public.touch_prediction_updated_at();


--
-- Name: profiles profiles_name_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_name_guard BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_name_guard();


--
-- Name: analytics_events analytics_events_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: client_errors client_errors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_errors
    ADD CONSTRAINT client_errors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: competition_awards competition_awards_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_awards
    ADD CONSTRAINT competition_awards_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE CASCADE;


--
-- Name: competition_awards competition_awards_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_awards
    ADD CONSTRAINT competition_awards_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: competition_matches competition_matches_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_matches
    ADD CONSTRAINT competition_matches_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE CASCADE;


--
-- Name: competition_matches competition_matches_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_matches
    ADD CONSTRAINT competition_matches_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;


--
-- Name: competition_participant_history competition_participant_history_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participant_history
    ADD CONSTRAINT competition_participant_history_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE CASCADE;


--
-- Name: competition_participant_history competition_participant_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participant_history
    ADD CONSTRAINT competition_participant_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: competition_participants competition_participants_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE CASCADE;


--
-- Name: competition_participants competition_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: competitions competitions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: competitions competitions_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;


--
-- Name: competitions competitions_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);


--
-- Name: competitions competitions_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitions
    ADD CONSTRAINT competitions_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: feedback feedback_handled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: group_members group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: group_members group_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: groups groups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: matches matches_away_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_away_team_id_fkey FOREIGN KEY (away_team_id) REFERENCES public.teams(id);


--
-- Name: matches matches_home_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_home_team_id_fkey FOREIGN KEY (home_team_id) REFERENCES public.teams(id);


--
-- Name: matches matches_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;


--
-- Name: milestones milestones_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT milestones_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE SET NULL;


--
-- Name: milestones milestones_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT milestones_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: notification_log notification_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: predictions predictions_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;


--
-- Name: predictions predictions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: rating_history rating_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rating_history
    ADD CONSTRAINT rating_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: ratings ratings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: seasons seasons_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;


--
-- Name: stories stories_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE CASCADE;


--
-- Name: stories stories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: teams teams_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;


--
-- Name: user_activity_days user_activity_days_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_days
    ADD CONSTRAINT user_activity_days_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_events analytics_events_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY analytics_events_insert_own ON public.analytics_events FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: competition_awards awards_select_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY awards_select_participants ON public.competition_awards FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.competition_participants cp
  WHERE ((cp.competition_id = competition_awards.competition_id) AND (cp.user_id = auth.uid())))));


--
-- Name: client_errors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

--
-- Name: client_errors client_errors_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_errors_insert_own ON public.client_errors FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: competitions comp_delete_group_admin_untipped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comp_delete_group_admin_untipped ON public.competitions FOR DELETE TO authenticated USING (((group_id IS NOT NULL) AND public.is_group_admin(group_id) AND (NOT (EXISTS ( SELECT 1
   FROM ((public.competition_participants cp
     JOIN public.competition_matches cm ON ((cm.competition_id = competitions.id)))
     JOIN public.predictions p ON (((p.match_id = cm.match_id) AND (p.user_id = cp.user_id))))
  WHERE (cp.competition_id = competitions.id))))));


--
-- Name: competition_participants comp_participants_delete_admin_untipped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comp_participants_delete_admin_untipped ON public.competition_participants FOR DELETE TO authenticated USING (((user_id <> auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.competitions c
  WHERE ((c.id = competition_participants.competition_id) AND (c.group_id IS NOT NULL) AND public.is_group_admin(c.group_id)))) AND (NOT (EXISTS ( SELECT 1
   FROM (public.competition_matches cm
     JOIN public.predictions p ON (((p.match_id = cm.match_id) AND (p.user_id = competition_participants.user_id))))
  WHERE (cm.competition_id = competition_participants.competition_id))))));


--
-- Name: competition_participants comp_participants_delete_own_unlocked; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comp_participants_delete_own_unlocked ON public.competition_participants FOR DELETE TO authenticated USING (((user_id = auth.uid()) AND ((NOT (EXISTS ( SELECT 1
   FROM (public.competition_matches cm
     JOIN public.matches m ON ((m.id = cm.match_id)))
  WHERE ((cm.competition_id = competition_participants.competition_id) AND ((m.home_score IS NULL) OR (m.away_score IS NULL)))))) OR (NOT (EXISTS ( SELECT 1
   FROM ((public.competition_matches cm
     JOIN public.matches m ON ((m.id = cm.match_id)))
     JOIN public.predictions p ON (((p.match_id = m.id) AND (p.user_id = auth.uid()))))
  WHERE ((cm.competition_id = competition_participants.competition_id) AND ((m.home_score IS NOT NULL) OR public.match_locked(m.kickoff_at, m.kickoff_tbd)))))))));


--
-- Name: competition_awards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competition_awards ENABLE ROW LEVEL SECURITY;

--
-- Name: competition_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competition_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: competition_participant_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competition_participant_history ENABLE ROW LEVEL SECURITY;

--
-- Name: competition_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competition_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: competition_participants competition_participants_insert_involved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY competition_participants_insert_involved ON public.competition_participants FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.competitions c
  WHERE ((c.id = competition_participants.competition_id) AND ((c.created_by = auth.uid()) OR ((c.group_id IS NOT NULL) AND public.is_group_member(c.group_id))))))));


--
-- Name: competition_participants competition_participants_select_visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY competition_participants_select_visible ON public.competition_participants FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_competition_visible(competition_id)));


--
-- Name: competitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;

--
-- Name: competitions competitions_select_involved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY competitions_select_involved ON public.competitions FOR SELECT TO authenticated USING (((created_by = auth.uid()) OR public.is_competition_visible(id)));


--
-- Name: competitions create competitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "create competitions" ON public.competitions FOR INSERT WITH CHECK ((created_by = auth.uid()));


--
-- Name: competitions creator deletes competitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "creator deletes competitions" ON public.competitions FOR DELETE USING ((created_by = auth.uid()));


--
-- Name: competition_matches creator inserts competition_matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "creator inserts competition_matches" ON public.competition_matches FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.competitions c
  WHERE ((c.id = competition_matches.competition_id) AND (c.created_by = auth.uid())))));


--
-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback feedback_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feedback_insert_own ON public.feedback FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: group_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

--
-- Name: group_members group_members_delete_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY group_members_delete_self ON public.group_members FOR DELETE TO authenticated USING (((user_id = auth.uid()) AND (NOT (EXISTS ( SELECT 1
   FROM (public.competition_participants cp
     JOIN public.competitions c ON ((c.id = cp.competition_id)))
  WHERE ((cp.user_id = auth.uid()) AND (c.group_id = group_members.group_id)))))));


--
-- Name: group_members group_members_insert_creator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY group_members_insert_creator ON public.group_members FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (role = 'admin'::text) AND public.is_group_creator(group_id)));


--
-- Name: group_members group_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY group_members_select ON public.group_members FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_group_member(group_id)));


--
-- Name: groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

--
-- Name: groups groups_delete_admin_inactive; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_delete_admin_inactive ON public.groups FOR DELETE TO authenticated USING ((public.is_group_admin(id) AND (NOT (EXISTS ( SELECT 1
   FROM (public.competitions c
     LEFT JOIN public.competition_status cs ON ((cs.competition_id = c.id)))
  WHERE ((c.group_id = groups.id) AND (COALESCE(cs.concluded, false) = false)))))));


--
-- Name: groups groups_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_insert_own ON public.groups FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: groups groups_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_select_member ON public.groups FOR SELECT TO authenticated USING (public.is_group_member(id));


--
-- Name: groups groups_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY groups_update_admin ON public.groups FOR UPDATE TO authenticated USING (public.is_group_admin(id)) WITH CHECK (public.is_group_admin(id));


--
-- Name: profiles insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "insert own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: job_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: job_runs job_runs_read_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY job_runs_read_admin ON public.job_runs FOR SELECT TO authenticated USING (public.is_platform_admin());


--
-- Name: leagues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

--
-- Name: matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

--
-- Name: matches matches_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY matches_insert_admin ON public.matches FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());


--
-- Name: matches matches_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY matches_update_admin ON public.matches FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());


--
-- Name: milestones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;

--
-- Name: milestones milestones_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY milestones_select_own ON public.milestones FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: notification_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

--
-- Name: predictions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

--
-- Name: predictions predictions_delete_own_unlocked; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_delete_own_unlocked ON public.predictions FOR DELETE TO authenticated USING (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.matches m
  WHERE ((m.id = predictions.match_id) AND (m.home_score IS NULL) AND (NOT public.match_locked(m.kickoff_at, m.kickoff_tbd)))))));


--
-- Name: predictions predictions_insert_own_unlocked; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_insert_own_unlocked ON public.predictions FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.matches m
  WHERE ((m.id = predictions.match_id) AND (m.home_score IS NULL) AND (NOT public.match_locked(m.kickoff_at, m.kickoff_tbd)))))));


--
-- Name: predictions predictions_select_visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_select_visible ON public.predictions FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.matches m
  WHERE ((m.id = predictions.match_id) AND ((m.home_score IS NOT NULL) OR public.match_locked(m.kickoff_at, m.kickoff_tbd)))))));


--
-- Name: predictions predictions_update_own_unlocked; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_update_own_unlocked ON public.predictions FOR UPDATE TO authenticated USING (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.matches m
  WHERE ((m.id = predictions.match_id) AND (m.home_score IS NULL) AND (NOT public.match_locked(m.kickoff_at, m.kickoff_tbd))))))) WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.matches m
  WHERE ((m.id = predictions.match_id) AND (m.home_score IS NULL) AND (NOT public.match_locked(m.kickoff_at, m.kickoff_tbd)))))));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_own ON public.push_subscriptions TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: rating_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rating_history ENABLE ROW LEVEL SECURITY;

--
-- Name: rating_history rating_history_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rating_history_read ON public.rating_history FOR SELECT TO authenticated USING (true);


--
-- Name: ratings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

--
-- Name: ratings ratings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ratings_read ON public.ratings FOR SELECT TO authenticated USING (true);


--
-- Name: competition_matches read competition matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read competition matches" ON public.competition_matches FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: leagues read leagues; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read leagues" ON public.leagues FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: matches read matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read matches" ON public.matches FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: profiles read profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read profiles" ON public.profiles FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: seasons read seasons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read seasons" ON public.seasons FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: teams read teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read teams" ON public.teams FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: seasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: stories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;

--
-- Name: stories stories_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stories_select_own ON public.stories FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: stories stories_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stories_update_own ON public.stories FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: competition_participants update own participation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "update own participation" ON public.competition_participants FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: profiles update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: user_activity_days; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_activity_days ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _anonymize_account(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._anonymize_account(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._anonymize_account(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION accept_invite(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.accept_invite(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accept_invite(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.accept_invite(p_code text) TO service_role;


--
-- Name: FUNCTION admin_analytics_engagement(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_analytics_engagement(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_analytics_engagement(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_engagement(p_days integer) TO service_role;


--
-- Name: FUNCTION admin_analytics_funnel(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_analytics_funnel(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_analytics_funnel(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_funnel(p_days integer) TO service_role;


--
-- Name: FUNCTION admin_analytics_health(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_analytics_health(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_analytics_health(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_health(p_days integer) TO service_role;


--
-- Name: FUNCTION admin_analytics_league_health(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_analytics_league_health(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_analytics_league_health(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_league_health(p_days integer) TO service_role;


--
-- Name: FUNCTION admin_analytics_retention(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_analytics_retention() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_analytics_retention() TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_retention() TO service_role;


--
-- Name: FUNCTION admin_analytics_rounds(p_rounds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_analytics_rounds(p_rounds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_analytics_rounds(p_rounds integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_rounds(p_rounds integer) TO service_role;


--
-- Name: FUNCTION admin_analytics_stories(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_analytics_stories(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_analytics_stories(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics_stories(p_days integer) TO service_role;


--
-- Name: FUNCTION admin_anonymize_account(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_anonymize_account(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_anonymize_account(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_anonymize_account(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION admin_client_errors(max_rows integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_client_errors(max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_client_errors(max_rows integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_client_errors(max_rows integer) TO service_role;


--
-- Name: FUNCTION admin_feedback(only_open boolean, max_rows integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_feedback(only_open boolean, max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_feedback(only_open boolean, max_rows integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_feedback(only_open boolean, max_rows integer) TO service_role;


--
-- Name: FUNCTION admin_feedback_set_handled(feedback_id uuid, handled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_feedback_set_handled(feedback_id uuid, handled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_feedback_set_handled(feedback_id uuid, handled boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_feedback_set_handled(feedback_id uuid, handled boolean) TO service_role;


--
-- Name: FUNCTION admin_job_health(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_job_health() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_job_health() TO authenticated;
GRANT ALL ON FUNCTION public.admin_job_health() TO service_role;


--
-- Name: FUNCTION admin_profiles(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_profiles() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_profiles() TO authenticated;
GRANT ALL ON FUNCTION public.admin_profiles() TO service_role;


--
-- Name: FUNCTION admin_recompute_derived(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_recompute_derived() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_recompute_derived() TO authenticated;
GRANT ALL ON FUNCTION public.admin_recompute_derived() TO service_role;


--
-- Name: FUNCTION admin_recompute_ratings(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_recompute_ratings() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_recompute_ratings() TO authenticated;
GRANT ALL ON FUNCTION public.admin_recompute_ratings() TO service_role;


--
-- Name: FUNCTION admin_seasons(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_seasons() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_seasons() TO authenticated;
GRANT ALL ON FUNCTION public.admin_seasons() TO service_role;


--
-- Name: FUNCTION admin_set_season_finished(p_season_id uuid, p_finished boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_season_finished(p_season_id uuid, p_finished boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_season_finished(p_season_id uuid, p_finished boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_season_finished(p_season_id uuid, p_finished boolean) TO service_role;


--
-- Name: FUNCTION admin_user_stats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_user_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_user_stats() TO authenticated;
GRANT ALL ON FUNCTION public.admin_user_stats() TO service_role;


--
-- Name: FUNCTION analytics_require_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_require_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_require_admin() TO authenticated;
GRANT ALL ON FUNCTION public.analytics_require_admin() TO service_role;


--
-- Name: FUNCTION anonymize_my_account(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.anonymize_my_account() FROM PUBLIC;
GRANT ALL ON FUNCTION public.anonymize_my_account() TO authenticated;
GRANT ALL ON FUNCTION public.anonymize_my_account() TO service_role;


--
-- Name: FUNCTION apply_milestone_stories(p_max_age_hours integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.apply_milestone_stories(p_max_age_hours integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_milestone_stories(p_max_age_hours integer) TO service_role;


--
-- Name: FUNCTION award_competition_periods(p_comp_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.award_competition_periods(p_comp_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.award_competition_periods(p_comp_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.award_competition_periods(p_comp_id uuid) TO service_role;


--
-- Name: FUNCTION award_milestones(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.award_milestones(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.award_milestones(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION build_round_frames(p_round_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.build_round_frames(p_round_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.build_round_frames(p_round_key text) TO service_role;


--
-- Name: FUNCTION career_profile(profile_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.career_profile(profile_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.career_profile(profile_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.career_profile(profile_user_id uuid) TO service_role;


--
-- Name: FUNCTION create_group(p_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_group(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_group(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.create_group(p_name text) TO service_role;


--
-- Name: FUNCTION ensure_group_membership_for_participant(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ensure_group_membership_for_participant() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_group_membership_for_participant() TO authenticated;
GRANT ALL ON FUNCTION public.ensure_group_membership_for_participant() TO service_role;


--
-- Name: FUNCTION generate_daily_stories(p_day date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_daily_stories(p_day date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_daily_stories(p_day date) TO service_role;


--
-- Name: FUNCTION generate_stories(p_round_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_stories(p_round_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_stories(p_round_key text) TO authenticated;
GRANT ALL ON FUNCTION public.generate_stories(p_round_key text) TO service_role;


--
-- Name: FUNCTION generate_stories_catchup(p_grace integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_stories_catchup(p_grace integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_stories_catchup(p_grace integer) TO service_role;


--
-- Name: FUNCTION invite_lookup(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.invite_lookup(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.invite_lookup(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.invite_lookup(p_code text) TO service_role;


--
-- Name: FUNCTION invite_preview(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.invite_preview(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.invite_preview(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.invite_preview(p_code text) TO service_role;
GRANT ALL ON FUNCTION public.invite_preview(p_code text) TO anon;


--
-- Name: FUNCTION is_competition_visible(cid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_competition_visible(cid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_competition_visible(cid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_competition_visible(cid uuid) TO service_role;


--
-- Name: FUNCTION is_group_admin(gid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_group_admin(gid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_group_admin(gid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_group_admin(gid uuid) TO service_role;


--
-- Name: FUNCTION is_group_creator(gid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_group_creator(gid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_group_creator(gid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_group_creator(gid uuid) TO service_role;


--
-- Name: FUNCTION is_group_member(gid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_group_member(gid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_group_member(gid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_group_member(gid uuid) TO service_role;


--
-- Name: FUNCTION is_platform_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_platform_admin() TO service_role;


--
-- Name: FUNCTION match_day(ts timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_day(ts timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_day(ts timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.match_day(ts timestamp with time zone) TO service_role;


--
-- Name: FUNCTION match_day_complete(p_day date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_day_complete(p_day date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_day_complete(p_day date) TO authenticated;
GRANT ALL ON FUNCTION public.match_day_complete(p_day date) TO service_role;


--
-- Name: FUNCTION match_lock_at(kickoff_at timestamp with time zone, kickoff_tbd boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_lock_at(kickoff_at timestamp with time zone, kickoff_tbd boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_lock_at(kickoff_at timestamp with time zone, kickoff_tbd boolean) TO authenticated;
GRANT ALL ON FUNCTION public.match_lock_at(kickoff_at timestamp with time zone, kickoff_tbd boolean) TO service_role;


--
-- Name: FUNCTION match_locked(kickoff_at timestamp with time zone, kickoff_tbd boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_locked(kickoff_at timestamp with time zone, kickoff_tbd boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_locked(kickoff_at timestamp with time zone, kickoff_tbd boolean) TO authenticated;
GRANT ALL ON FUNCTION public.match_locked(kickoff_at timestamp with time zone, kickoff_tbd boolean) TO service_role;


--
-- Name: FUNCTION move_competition_to_group(p_comp_id uuid, p_group_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.move_competition_to_group(p_comp_id uuid, p_group_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_competition_to_group(p_comp_id uuid, p_group_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.move_competition_to_group(p_comp_id uuid, p_group_id uuid) TO service_role;


--
-- Name: FUNCTION my_profile(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_profile() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_profile() TO authenticated;
GRANT ALL ON FUNCTION public.my_profile() TO service_role;


--
-- Name: FUNCTION pc_points(ph integer, pa integer, hs integer, as_ integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pc_points(ph integer, pa integer, hs integer, as_ integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pc_points(ph integer, pa integer, hs integer, as_ integer) TO authenticated;
GRANT ALL ON FUNCTION public.pc_points(ph integer, pa integer, hs integer, as_ integer) TO service_role;


--
-- Name: FUNCTION profiles_name_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.profiles_name_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.profiles_name_guard() TO authenticated;
GRANT ALL ON FUNCTION public.profiles_name_guard() TO service_role;


--
-- Name: FUNCTION prune_analytics_events(keep_months integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prune_analytics_events(keep_months integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.prune_analytics_events(keep_months integer) TO service_role;


--
-- Name: FUNCTION prune_client_errors(keep_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prune_client_errors(keep_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.prune_client_errors(keep_days integer) TO service_role;


--
-- Name: FUNCTION prune_job_runs(keep_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prune_job_runs(keep_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.prune_job_runs(keep_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.prune_job_runs(keep_days integer) TO service_role;


--
-- Name: FUNCTION recompute_derived(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recompute_derived() FROM PUBLIC;
GRANT ALL ON FUNCTION public.recompute_derived() TO service_role;


--
-- Name: FUNCTION recompute_ratings(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recompute_ratings() FROM PUBLIC;
GRANT ALL ON FUNCTION public.recompute_ratings() TO service_role;


--
-- Name: FUNCTION recompute_ratings_if_scores_changed(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recompute_ratings_if_scores_changed() FROM PUBLIC;
GRANT ALL ON FUNCTION public.recompute_ratings_if_scores_changed() TO authenticated;
GRANT ALL ON FUNCTION public.recompute_ratings_if_scores_changed() TO service_role;


--
-- Name: FUNCTION refresh_kickoff_uncertain(p_season_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_kickoff_uncertain(p_season_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_kickoff_uncertain(p_season_id uuid) TO service_role;


--
-- Name: FUNCTION remember_participant_baseline(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remember_participant_baseline() FROM PUBLIC;
GRANT ALL ON FUNCTION public.remember_participant_baseline() TO authenticated;
GRANT ALL ON FUNCTION public.remember_participant_baseline() TO service_role;


--
-- Name: FUNCTION remember_previous_kickoff(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remember_previous_kickoff() FROM PUBLIC;
GRANT ALL ON FUNCTION public.remember_previous_kickoff() TO authenticated;
GRANT ALL ON FUNCTION public.remember_previous_kickoff() TO service_role;


--
-- Name: FUNCTION restore_participant_baseline(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.restore_participant_baseline() FROM PUBLIC;
GRANT ALL ON FUNCTION public.restore_participant_baseline() TO authenticated;
GRANT ALL ON FUNCTION public.restore_participant_baseline() TO service_role;


--
-- Name: FUNCTION round_key(ts timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.round_key(ts timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.round_key(ts timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.round_key(ts timestamp with time zone) TO service_role;


--
-- Name: FUNCTION round_key_of_date(d date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.round_key_of_date(d date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.round_key_of_date(d date) TO authenticated;
GRANT ALL ON FUNCTION public.round_key_of_date(d date) TO service_role;


--
-- Name: FUNCTION touch_activity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.touch_activity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.touch_activity() TO authenticated;
GRANT ALL ON FUNCTION public.touch_activity() TO service_role;


--
-- Name: FUNCTION touch_prediction_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.touch_prediction_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.touch_prediction_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_prediction_updated_at() TO service_role;


--
-- Name: FUNCTION user_day_scope(p_day date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.user_day_scope(p_day date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_day_scope(p_day date) TO authenticated;
GRANT ALL ON FUNCTION public.user_day_scope(p_day date) TO service_role;


--
-- Name: FUNCTION username_available(name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.username_available(name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.username_available(name text) TO authenticated;
GRANT ALL ON FUNCTION public.username_available(name text) TO service_role;
GRANT ALL ON FUNCTION public.username_available(name text) TO anon;


--
-- Name: FUNCTION users_with_complete_day(p_day date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.users_with_complete_day(p_day date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.users_with_complete_day(p_day date) TO authenticated;
GRANT ALL ON FUNCTION public.users_with_complete_day(p_day date) TO service_role;


--
-- Name: TABLE matches; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE public.matches TO authenticated;
GRANT ALL ON TABLE public.matches TO service_role;


--
-- Name: TABLE analytics_match_locks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_match_locks TO service_role;


--
-- Name: TABLE competition_matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competition_matches TO authenticated;
GRANT ALL ON TABLE public.competition_matches TO service_role;


--
-- Name: TABLE competition_participants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competition_participants TO authenticated;
GRANT ALL ON TABLE public.competition_participants TO service_role;


--
-- Name: TABLE competitions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competitions TO authenticated;
GRANT ALL ON TABLE public.competitions TO service_role;


--
-- Name: TABLE predictions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.predictions TO authenticated;
GRANT ALL ON TABLE public.predictions TO service_role;


--
-- Name: TABLE analytics_completion_facts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_completion_facts TO service_role;


--
-- Name: TABLE analytics_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_events TO authenticated;
GRANT ALL ON TABLE public.analytics_events TO service_role;


--
-- Name: TABLE analytics_round_locks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_round_locks TO service_role;


--
-- Name: TABLE client_errors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_errors TO authenticated;
GRANT ALL ON TABLE public.client_errors TO service_role;


--
-- Name: TABLE competition_awards; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competition_awards TO authenticated;
GRANT ALL ON TABLE public.competition_awards TO service_role;


--
-- Name: TABLE competition_match_points; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competition_match_points TO authenticated;
GRANT ALL ON TABLE public.competition_match_points TO service_role;


--
-- Name: TABLE competition_participant_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competition_participant_history TO service_role;


--
-- Name: TABLE seasons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seasons TO authenticated;
GRANT ALL ON TABLE public.seasons TO service_role;


--
-- Name: TABLE competition_status; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competition_status TO authenticated;
GRANT ALL ON TABLE public.competition_status TO service_role;


--
-- Name: TABLE feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feedback TO authenticated;
GRANT ALL ON TABLE public.feedback TO service_role;


--
-- Name: TABLE group_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.group_members TO authenticated;
GRANT ALL ON TABLE public.group_members TO service_role;


--
-- Name: TABLE groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.groups TO authenticated;
GRANT ALL ON TABLE public.groups TO service_role;


--
-- Name: TABLE group_counts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.group_counts TO service_role;
GRANT SELECT ON TABLE public.group_counts TO authenticated;


--
-- Name: TABLE job_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.job_runs TO authenticated;
GRANT ALL ON TABLE public.job_runs TO service_role;


--
-- Name: SEQUENCE job_runs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.job_runs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.job_runs_id_seq TO service_role;


--
-- Name: TABLE stories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stories TO authenticated;
GRANT ALL ON TABLE public.stories TO service_role;


--
-- Name: TABLE latest_story; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.latest_story TO authenticated;
GRANT ALL ON TABLE public.latest_story TO service_role;


--
-- Name: TABLE leagues; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leagues TO authenticated;
GRANT ALL ON TABLE public.leagues TO service_role;


--
-- Name: TABLE milestones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.milestones TO authenticated;
GRANT ALL ON TABLE public.milestones TO service_role;


--
-- Name: TABLE monthly_standings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.monthly_standings TO authenticated;
GRANT ALL ON TABLE public.monthly_standings TO service_role;


--
-- Name: TABLE notification_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_log TO authenticated;
GRANT ALL ON TABLE public.notification_log TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: COLUMN profiles.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id),UPDATE(id) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.display_name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(display_name),UPDATE(display_name) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.anonymized_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(anonymized_at) ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;


--
-- Name: TABLE rating_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rating_history TO authenticated;
GRANT ALL ON TABLE public.rating_history TO service_role;


--
-- Name: TABLE ratings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ratings TO authenticated;
GRANT ALL ON TABLE public.ratings TO service_role;


--
-- Name: TABLE round_standings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.round_standings TO authenticated;
GRANT ALL ON TABLE public.round_standings TO service_role;


--
-- Name: TABLE season_standings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.season_standings TO authenticated;
GRANT ALL ON TABLE public.season_standings TO service_role;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teams TO authenticated;
GRANT ALL ON TABLE public.teams TO service_role;


--
-- Name: TABLE user_activity_days; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_activity_days TO authenticated;
GRANT ALL ON TABLE public.user_activity_days TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict egxlvuOjOq4I3MvpanE20uVfwca4VWZSi7TVXdLlmlkBXfUg3uzcYZ74is0Lr5Z


-- Leagly — `standings_shared` ind i hændelseskataloget
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
-- Spec: docs/features/analytics-v1.md · katalogets hjem: sql/analytics_events.sql
--
-- HVORFOR FILEN FINDES. Stilling-skærmen fik 15. august 2026 en Del-knap, der
-- sender tabellen som billede. Hændelseskatalogets check-constraint hvidlister
-- hvert navn, og `standings_shared` stod ikke i den.
--
-- 🔴 KØR DEN FØR FRONTENDEN UDRULLES. `src/lib/analytics.js` har den kontrakt,
-- at INTET kaster: en afvist insert svælges stille. Uden migreringen virker
-- Del-knappen altså fint, mens hver eneste deling tabes UDEN at nogen opdager
-- det — og en måling, der er tavst nul, er værre end ingen måling, fordi den
-- læses som "funktionen bruges ikke". Det er filens eneste rækkefølge-regel;
-- den gamle klient sender ikke navnet og mærker intet til, at det er tilladt.
--
-- ✅ REN TILFØJELSE: ét navn i én constraint. Ingen tabel, ingen policy, ingen
-- rettighed smalnes, ingen eksisterende række ændres.
--
-- HVORFOR ET NYT NAVN OG IKKE EN `metadata.via` PÅ `story_shared`. En `via`
-- skelner mellem KILDER til det samme trin — det er derfor dagskortets deling
-- er `story_shared` med `from: 'day_card'`, for det ER en delt historie, bare
-- fra en anden flade end rundestoryens frames. En stilling er ikke en historie:
-- den har ingen `stories`-række, ingen regel, ingen nyhedsværdi, og den ville
-- forurene hver eneste opgørelse over Story Engine, den blev talt med i. Samme
-- afvejning som `invite_landed` traf i `sql/analytics_events.sql`.
--
-- LISTEN ER KOPIERET FRA sql/analytics_events.sql og skal holdes i trit med den:
-- constrainten kan kun sættes i sin helhed, så den fil, der køres SIDST, vinder.
-- Tilføjes et navn dér efter denne fil, skal denne fil ikke gen-køres — men en
-- gendannelse fra bunden skal køre denne EFTER #24.

alter table public.analytics_events drop constraint if exists analytics_events_name_check;
alter table public.analytics_events add constraint analytics_events_name_check
  check (event_name in (
    -- Account
    'account_created', 'login', 'logout',
    -- Liga
    'league_created', 'league_joined', 'league_invite_sent', 'league_invite_accepted',
    'invite_landed',
    -- Konkurrence
    'competition_created', 'competition_joined', 'competition_opened',
    -- Tip
    'prediction_started', 'prediction_saved', 'prediction_updated', 'prediction_submitted',
    -- Navigation
    'opened_home', 'opened_tip', 'opened_league', 'opened_standings', 'opened_rating',
    'opened_career', 'opened_story', 'opened_championship',
    -- Story Engine
    'story_viewed', 'story_shared',
    'story_score_distribution', 'story_frame_viewed', 'milestone_cta_clicked',
    -- Deling af en stilling (august 2026). Ikke en historie — se hovedet.
    'standings_shared',
    -- Notifikationer
    'push_opened'
  ));

-- ---------- Verifikation ----------
-- 1) Navnet er tilladt:
--    select 'standings_shared' = any (
--      string_to_array(
--        replace(replace(substring(pg_get_constraintdef(oid) from '\(\((.*)\)\)'), '''', ''), ' ', ''),
--        ','));
--    from pg_constraint where conname = 'analytics_events_name_check';
-- 2) Et opdigtet navn afvises fortsat (skal fejle med 23514):
--    insert into public.analytics_events (event_name) values ('ikke_et_navn');

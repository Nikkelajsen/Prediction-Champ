-- Live-resultater: nuværende stilling i kampe der spilles lige nu.
-- Idempotent — kan køres igen når som helst ("Run without RLS").
--
-- PRINCIP (vigtigt): live-scoren skrives i SEPARATE kolonner og rører ALDRIG
-- home_score/away_score. Grunden er, at hele appen (pointberegning, stillinger,
-- rating, views, låsning, Story Engine) bruger "home_score is not null" som
-- betydningen "kampen er spillet færdig". Skrev vi live-scoren dér, ville
-- tabellerne begynde at give point midt i en kamp — og rating-triggeren ville
-- køre en fuld Elo-genberegning hvert minut.
--
-- Med separate kolonner gælder derfor stadig:
--   * matches_recompute_ratings_upd (sql/rating_trigger_optimization.sql) kigger
--     KUN på home_score/away_score, så live-opdateringer udløser hverken
--     rating-genberegning eller generate_stories().
--   * round_standings / season_standings / monthly_standings summerer kun kampe
--     med endeligt resultat — stillinger opdaterer først, når kampen er slut.
--   * isLocked()/RLS er uændret (låsningen er runde-baseret og kigger på
--     home_score + kickoff, ikke på live-felterne).
--
-- Skrives af serverfunktionen api/sync-live.js (service role, cron hvert minut).
-- Læses af alle via den eksisterende "read matches"-policy — ingen ny policy nødvendig.

alter table public.matches
  add column if not exists live_home_score  integer,
  add column if not exists live_away_score  integer,
  add column if not exists live_state       text,
  add column if not exists live_minute      integer,
  add column if not exists live_updated_at  timestamptz;

comment on column public.matches.live_home_score is 'Nuværende mål (hjemme) mens kampen spilles. Null når kampen ikke er i gang. Tæller ALDRIG point.';
comment on column public.matches.live_away_score is 'Nuværende mål (ude) mens kampen spilles. Null når kampen ikke er i gang. Tæller ALDRIG point.';
comment on column public.matches.live_state     is 'Sportmonks-state (developer_name), fx INPLAY_1ST_HALF, HT, INPLAY_2ND_HALF. Null = ikke i gang.';
comment on column public.matches.live_minute    is 'Spilleminut fra den tickende periode. Null i pauser og når minuttet er ukendt.';
comment on column public.matches.live_updated_at is 'Hvornår live-felterne sidst blev opdateret af api/sync-live.js.';

-- Index til live-syncens vindues-opslag: "kampe uden endeligt resultat omkring nu".
create index if not exists matches_live_window_idx
  on public.matches (kickoff_at)
  where home_score is null;

-- Index til oprydning: kampe der stadig står som live og skal ryddes/afsluttes.
create index if not exists matches_live_state_idx
  on public.matches (live_state)
  where live_state is not null;

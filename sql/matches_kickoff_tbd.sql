-- Prediction Champ — "tid ikke fastlagt" som egenskab ved kampen (august 2026)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- PROBLEMET. En terminsliste offentliggøres med datoer længe før klokkeslæt.
-- Begge datakilder sender da en PLADSHOLDER-tid: midnat UTC. Den blev skrevet
-- ordret i matches.kickoff_at og var ikke til at skelne fra en ægte kampstart,
-- så seks Superliga-kampe stod i appen som "02.00" (midnat UTC vist i dansk
-- sommertid) med lås kl. 01.00 om natten — 15 timer før kampene faktisk spilles.
--
-- LØSNINGEN er ikke at gætte på tidsstemplet, men at bære leverandørens egen
-- viden med: football-data.org skelner SCHEDULED (grov dato) fra TIMED (eksakt
-- tid), og Sportmonks har state TBA plus midnat-pladsholderen. Providerlaget
-- udleder det hver for sig (api/_providers/) og skriver resultatet her.
--
-- LÅSEN for en kamp uden fastlagt tid bliver MIDNAT PÅ SPILLEDAGEN i dansk tid.
-- "1 time før kickoff" er meningsløst, når der ikke er noget kickoff — kun en
-- dato. Kampen kan ligge hvor som helst på dagen, og enhver senere lås ville
-- kunne ligge efter et fløjt.
--
-- ADFÆRDSÆNDRING VED KØRSEL: INGEN. Kolonnen får `default false`, så hver
-- eksisterende række starter som "tid er fastlagt", og låseudtrykket er da
-- bogstaveligt det gamle. Adfærden ændrer sig først, når `sync-matches` har
-- kørt og sat flaget — og dermed kun for kampe, der aldrig havde et rigtigt
-- klokkeslæt til at begynde med. Derfor kræver denne fil ikke, at du er mellem
-- to runder, sådan som predictions_match_lock.sql gjorde.
--
-- LÅSE-UDTRYKKET stod før 1:1 i fem policies med en advarsel om aldrig at
-- omskrive det ét sted. Det er nu ÉN funktion, kaldt fra alle fem — samme regel,
-- men den kan ikke længere drive fra sig selv. Ændres låsen igen, ændres den i
-- public.match_lock_at() og intet andet sted.

-- ============================================================================
-- PRE-FLIGHT (kommenteret, så filen kan køres i sin helhed)
-- ============================================================================
-- Hvor mange kampe rammes, når sync bagefter sætter flaget? Kør før og efter
-- første sync — tallet skal falde til nul, efterhånden som klokkeslættene
-- offentliggøres.
--
-- select l.name as turnering, m.round_key, count(*) as kampe_paa_midnat_utc
-- from public.matches m
-- join public.seasons s on s.id = m.season_id
-- join public.leagues  l on l.id = s.league_id
-- where m.home_score is null
--   and (m.kickoff_at at time zone 'UTC')::time = '00:00:00'
-- group by 1, 2
-- order by 2;

-- ============================================================================
-- 1) Kolonnen
-- ============================================================================
-- kickoff_at forbliver NOT NULL. DATOEN er kendt og rigtig — det er kun
-- tidsdelen, der er opdigtet — og round_key er en genereret kolonne oven på
-- kickoff_at, så en nullable kickoff ville rive langt mere med sig end nødvendigt.
-- kickoff_tbd siger præcis det, der er sandt: klokkeslættet er en pladsholder.
alter table public.matches
  add column if not exists kickoff_tbd boolean not null default false;

comment on column public.matches.kickoff_tbd is
  'Klokkeslættet i kickoff_at er en pladsholder — kun datoen er kendt. Sættes af api/sync-matches ud fra leverandørens egen markør.';

-- ============================================================================
-- 2) Låsen, ét sted
-- ============================================================================
-- Tidspunktet hvor en kamp lukker for tips. NULL kickoff → NULL: kampen har
-- ingen lås og regnes aldrig som låst. Det er samme null-semantik som før.
create or replace function public.match_lock_at(kickoff_at timestamptz, kickoff_tbd boolean)
  returns timestamptz
  language sql
  stable
as $$
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

-- Er kampen låst nu? Skrevet oven på match_lock_at, så de to aldrig kan sige
-- noget forskelligt. `kickoff_at <= now() + interval '1 hour'` fra A21 er
-- bogstaveligt det samme som `kickoff_at - interval '1 hour' <= now()`.
create or replace function public.match_locked(kickoff_at timestamptz, kickoff_tbd boolean)
  returns boolean
  language sql
  stable
as $$
  select coalesce(public.match_lock_at(kickoff_at, kickoff_tbd) <= now(), false);
$$;

-- ============================================================================
-- 3) Policies — samme regel, nu gennem funktionen
-- ============================================================================
-- Null-semantikken er uændret og står stadig eksplicit:
--   * skrivning: en kamp uden kendt kickoff er ÅBEN   (not match_locked → true)
--   * læsning:   andres gæt på den er IKKE synlige    (match_locked → false)

alter table public.predictions enable row level security;

-- ---------- INSERT ----------
drop policy if exists "insert own predictions" on public.predictions;
drop policy if exists "predictions_insert_own_unlocked" on public.predictions;
create policy "predictions_insert_own_unlocked"
on public.predictions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and m.home_score is null
      and not public.match_locked(m.kickoff_at, m.kickoff_tbd)
  )
);

-- ---------- UPDATE ----------
-- Betingelsen skal stå i BÅDE using og with check. `using` afgør, hvilke rækker
-- der må rettes; `with check` afgør, hvordan de må se ud bagefter. Uden `with
-- check` kunne en række flyttes til en anden (låst) kamp ved at ændre match_id.
drop policy if exists "update own predictions" on public.predictions;
drop policy if exists "predictions_update_own_unlocked" on public.predictions;
create policy "predictions_update_own_unlocked"
on public.predictions
for update
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and m.home_score is null
      and not public.match_locked(m.kickoff_at, m.kickoff_tbd)
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and m.home_score is null
      and not public.match_locked(m.kickoff_at, m.kickoff_tbd)
  )
);

-- ---------- DELETE ----------
drop policy if exists "predictions_delete_own_unlocked" on public.predictions;
create policy "predictions_delete_own_unlocked"
on public.predictions
for delete
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and m.home_score is null
      and not public.match_locked(m.kickoff_at, m.kickoff_tbd)
  )
);

-- ---------- SELECT: egne tips altid; andres kun når kampen er låst ----------
drop policy if exists "read predictions" on public.predictions;
drop policy if exists "predictions_select_visible" on public.predictions;
create policy "predictions_select_visible"
on public.predictions
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and (
        m.home_score is not null
        or public.match_locked(m.kickoff_at, m.kickoff_tbd)
      )
  )
);

-- ---------- competition_participants: framelding sletter ikke historik ----------
-- Samme lås, andet sted (sql/group_membership_invariant.sql, #13). Gren (b) bar
-- låseudtrykket 1:1 og følger med her. Gren (a) er uændret.
drop policy if exists comp_participants_delete_own_unlocked on public.competition_participants;
create policy comp_participants_delete_own_unlocked on public.competition_participants
  for delete to authenticated
  using (
    user_id = auth.uid()
    and (
      -- (a) Forløbet er forbi: ingen kampe i konkurrencen mangler resultat.
      not exists (
        select 1
        from public.competition_matches cm
        join public.matches m on m.id = cm.match_id
        where cm.competition_id = competition_participants.competition_id
          and (m.home_score is null or m.away_score is null)
      )
      -- (b) Ellers: ingen tips på låste kampe.
      or not exists (
        select 1
        from public.competition_matches cm
        join public.matches m on m.id = cm.match_id
        join public.predictions p on p.match_id = m.id and p.user_id = auth.uid()
        where cm.competition_id = competition_participants.competition_id
          and (
            m.home_score is not null
            or public.match_locked(m.kickoff_at, m.kickoff_tbd)
          )
      )
    )
  );

-- ============================================================================
-- 4) analytics_match_locks — læser låsen, definerer den ikke
-- ============================================================================
create or replace view public.analytics_match_locks as
select
  m.id                                             as match_id,
  m.season_id,
  m.round_key,
  m.kickoff_at,
  m.kickoff_tbd,
  public.match_lock_at(m.kickoff_at, m.kickoff_tbd) as lock_at,
  public.match_locked(m.kickoff_at, m.kickoff_tbd)  as is_locked
from public.matches m
where m.kickoff_at is not null;

revoke all on public.analytics_match_locks from anon, authenticated;

-- ============================================================================
-- Verifikation — kør efter scriptet
-- ============================================================================
-- 1) Kolonnen findes, og intet er flyttet endnu (alle rækker false):
--
--    select kickoff_tbd, count(*) from public.matches group by 1;
--
-- 2) Ingen policy nævner længere låsen i hånden. Nul rækker = alle går gennem
--    funktionen:
--
--    select policyname, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename in ('predictions','competition_participants')
--      and coalesce(qual,'') || coalesce(with_check,'') like '%interval%';
--
-- 3) Låsen for en TBD-kamp er midnat dansk, ikke 01.00:
--
--    select public.match_lock_at('2026-09-13 00:00:00+00'::timestamptz, true)  as tbd_laas,
--           public.match_lock_at('2026-09-13 00:00:00+00'::timestamptz, false) as normal_laas;
--    -- forventet: 2026-09-13 00:00 dansk (= 2026-09-12 22:00Z) · 2026-09-12 23:00Z
--
-- 4) Funktionel stikprøve som almindelig bruger (ikke service_role) på en kamp
--    med kickoff_tbd = true: tip skal kunne gemmes dagen før og afvises på selve
--    spilledagen med "new row violates row-level security policy".

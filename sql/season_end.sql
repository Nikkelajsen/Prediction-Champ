-- Leagly — sæsonen får en slutning, så en konkurrence ikke afsluttes for tidligt
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- ---------------------------------------------------------------------------
-- Hvorfor
--
-- `competition_status` (sql/milestones.sql) vidste allerede, at "alle MINE kampe
-- har resultat" ikke er nok for en konkurrence, der kan vokse: den krævede også,
-- at konkurrencens SÆSONER var færdigspillede.
--
-- Men "færdigspillet" blev aflæst på de kampe, sæsonen ALLEREDE har — og en kamp,
-- der endnu ikke er offentliggjort, findes slet ikke i `matches`. Betingelsen var
-- derfor trivielt sand i præcis det tilfælde, den skulle fange: Sportmonks
-- modellerer den danske Superliga som ÉN sæson med flere stages, og slutspillet
-- skemalægges først til foråret (sql/matches_stage.sql). Mellem sidste
-- grundspilsrunde og den dag, slutspillet udgives, så sæsonen færdig ud — og en
-- "hel sæson"-konkurrence blev erklæret afsluttet med pokal, vinder og
-- permanente milepæle, midt i sin egen sæson.
--
-- Det er samme hul, `api/_backfill.js` (A20) findes for at lukke på KAMPsiden.
-- Her lukkes det på STATUSsiden: sæsonen skal selv sige, at den er slut.
--
-- ⚠️ `competition_status` er FØRST defineret i sql/milestones.sql og redefineres
-- her. Kører du milestones.sql igen, ruller sæson-gaten tavst tilbage — kør da
-- denne fil umiddelbart efter. Samme fælde som de to afløste policies i
-- sql/groups.sql, jf. sql/README.md.

-- ======================= 1. To kolonner på sæsonen =======================
alter table public.seasons add column if not exists ends_at date;
alter table public.seasons add column if not exists is_finished boolean not null default false;

comment on column public.seasons.ends_at is
  'Sæsonens sidste spilledag ifølge datakilden. Sat af api/sync-matches.js. Null = ukendt.';
comment on column public.seasons.is_finished is
  'Sæsonen er slut og kan ikke få flere kampe. Sættes kun TIL true af sync; at rulle den tilbage er en bevidst handling i Admin → Drift.';

-- ======================= 2. competition_status v2 =======================
--
-- Uændret fra milestones.sql bortset fra `seasons_done`, som nu spørger sæsonen
-- selv og ikke kun dens kendte kampe.
--
-- TRE VEJE TIL "SÆSONEN ER SLUT", i den rækkefølge de betyder noget:
--
--   1. `is_finished` — datakildens (eller administratorens) erklæring. Den
--      primære vej og den eneste, der er præcis.
--   2. `ends_at < current_date` — bagstopper for en sæson, hvor vi kender
--      slutdatoen, men hvor flaget aldrig nåede at blive sat.
--   3. seneste kickoff er over 30 dage gammel — SIKKERHEDSVENTIL for en sæson,
--      vi ingen metadata har om.
--
-- Punkt 3 er en indrømmelse, og den skal stå åbent: det er en karensperiode, og
-- karensperioden blev netop fravalgt som primær mekanisme, fordi den altid
-- kommer for sent. Uden den ville hver eneste sæson uden `ends_at` — altså alle
-- eksisterende rækker på udrulningsdagen — aldrig blive færdig, og milepæle og
-- kåringer ville stoppe i tavshed. Den rammer kun det tilfælde, hvor vi intet
-- ved, og 30 dage er længere end enhver pause inde i en sæson (vinterpausen i
-- Superligaen er den længste, og den ligger under).
--
-- `mode_params ? 'stages'` markerer en håndafgrænset gammel konkurrence, som
-- aldrig vokser, jf. api/_backfill.js.
create or replace view public.competition_status
with (security_invoker = on) as
with cm as (
  select cm.competition_id, m.id as match_id, m.season_id,
         (m.home_score is not null and m.away_score is not null) as scored
  from public.competition_matches cm
  join public.matches m on m.id = cm.match_id
),
agg as (
  select competition_id, count(*)::int as matches,
         (count(*) filter (where scored))::int as scored_matches
  from cm group by competition_id
),
growable as (
  select c.id as competition_id,
         (c.mode in ('full_season', 'team', 'time_range')
          and not (c.mode_params ? 'stages')) as can_grow
  from public.competitions c
),
-- "Sæsonerne, den trækker fra" aflæses på konkurrencens EGNE kampe: den kan kun
-- vokse fra sæsoner, den allerede henter kampe i.
seasons_done as (
  select x.competition_id, bool_and(coalesce(sd.done, false)) as seasons_complete
  from (select distinct competition_id, season_id from cm) x
  join lateral (
    -- `coalesce(…, false)` er ikke pyntning: `max(kickoff_at)` er null for en
    -- sæson uden kendte spilletidspunkter, og en null ville boble op gennem
    -- `bool_and` og ende som "sæsonen ER færdig" via det ydre coalesce. Uvished
    -- skal trække den anden vej — en konkurrence, der ikke bliver afsluttet, kan
    -- rettes; en milepæl, der er uddelt, kan ikke tages tilbage.
    select
      bool_and(m.home_score is not null and m.away_score is not null)
      and coalesce(
            s.is_finished
            or (s.ends_at is not null and s.ends_at < current_date)
            or (s.ends_at is null and max(m.kickoff_at) < now() - interval '30 days'),
            false
          ) as done
    from public.matches m
    join public.seasons s on s.id = x.season_id
    where m.season_id = x.season_id
    group by s.is_finished, s.ends_at
  ) sd on true
  group by x.competition_id
)
select a.competition_id, a.matches, a.scored_matches, g.can_grow,
       coalesce(sd.seasons_complete, true) as seasons_complete,
       (a.matches > 0
        and a.scored_matches = a.matches
        and (not g.can_grow or coalesce(sd.seasons_complete, true))) as concluded
from agg a
join growable g on g.competition_id = a.competition_id
left join seasons_done sd on sd.competition_id = a.competition_id;

grant select on public.competition_status to authenticated, service_role;

-- ======================= 3. Den manuelle bagstopper =======================
--
-- `seasons` har kun en læse-policy, og det skal den blive ved med: kampprogram
-- og sæsoner skrives af sync med service-nøglen, ikke fra en browser. Men
-- sæson-gaten har brug for én undtagelse, og den er værd at have.
--
-- Sætter datakilden ikke flaget — football-data.org har intet `finished`-felt,
-- og en sæson uden `ends_at` lever på 30-dages ventilen — så er der ikke andre
-- veje til at lukke en sæson end at vente. Denne funktion er den vej, og den er
-- bevidst SNÆVER: ét felt, to værdier, kun for `is_admin`. Aflæses og betjenes
-- i Admin → Drift.
--
-- Begge retninger er tilladt her, modsat sync, som kun sætter true. En
-- administrator, der lukkede den forkerte sæson, skal kunne fortryde — og en
-- fejl, der kun kan rettes i databasekonsollen, er en fejl, der ikke bliver
-- rettet.
create or replace function public.admin_set_season_finished(p_season_id uuid, p_finished boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'forbidden';
  end if;
  update public.seasons set is_finished = coalesce(p_finished, false) where id = p_season_id;
  if not found then
    raise exception 'Sæsonen findes ikke';
  end if;
end $fn$;

revoke all on function public.admin_set_season_finished(uuid, boolean) from public, anon;
grant execute on function public.admin_set_season_finished(uuid, boolean) to authenticated;

-- Aflæsningen: sæsonerne med det, en administrator skal bruge for at afgøre,
-- om en af dem hænger. Egen funktion frem for et view, fordi den samler tal fra
-- `matches`, som en almindelig bruger ikke har nogen grund til at aggregere.
create or replace function public.admin_seasons()
returns table (
  season_id uuid, league_name text, season_name text,
  ends_at date, is_finished boolean,
  last_kickoff timestamptz, matches int, unplayed int
)
language sql
security definer
set search_path = public
stable
as $fn$
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
$fn$;

revoke all on function public.admin_seasons() from public, anon;
grant execute on function public.admin_seasons() to authenticated;

-- ======================= Verifikation efter kørsel =======================
-- 1) Hvilke sæsoner mangler metadata (og lever derfor på ventilen)?
--      select l.name as turnering, s.name, s.ends_at, s.is_finished,
--             max(m.kickoff_at) as sidste_kickoff
--        from public.seasons s
--        join public.leagues l on l.id = s.league_id
--        left join public.matches m on m.season_id = s.id
--       group by l.name, s.id, s.name, s.ends_at, s.is_finished
--       order by 1, 2;
--
-- 2) Hvad gør gaten ved konkurrencerne?
--      select c.name, cs.matches, cs.scored_matches, cs.can_grow,
--             cs.seasons_complete, cs.concluded
--        from public.competition_status cs
--        join public.competitions c on c.id = cs.competition_id
--       order by c.name;

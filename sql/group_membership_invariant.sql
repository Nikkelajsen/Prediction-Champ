-- Invariant: ingen kan være deltager i en liga-konkurrence uden at være medlem
-- af ligaen. Håndhæves i DATABASEN, ikke i klienten (A8, juli 2026).
-- Idempotent — kan køres igen når som helst. Kør med "Run without RLS".
--
-- BAGGRUND. A8 blev besluttet i juli 2026 ("ingen gæste-deltagelse — join via
-- konkurrence-link melder én ind i begge"), men blev kun implementeret i
-- frontenden — og kun ét af to steder, så de to veje ind i samme konkurrence
-- opførte sig forskelligt (A7, juli 2026). En regel, der kun findes i klienten,
-- er ikke en regel: hver ny kaldesti skal huske den, og ingen af dem retter de
-- rækker, der allerede er forkerte.
--
-- Den forældreløse tilstand er ikke bare uryddelig — den er synligt forkert:
-- deltageren står i konkurrencens stilling, men mangler på ligaens medlemsliste
-- og kan ikke åbne ligaens side.
--
-- TRE HULLER, tre svar:
--   1. Eksisterende rækker            → backfill (afsnit 1)
--   2. Nye deltagere (alle kaldestier)→ trigger, der automatisk indmelder (afsnit 2)
--   3. At forlade ligaen              → DELETE-policy, der blokerer (afsnit 3)
--
-- Hul 3 var det vigtigste: det skabte forældreløse deltagere EFTER at alt var
-- gået rigtigt til, fordi leaveGroup kun slettede group_members-rækken.

-- ============================================================================
-- 1. Backfill — ret de rækker, der allerede er forkerte
-- ============================================================================
-- Rolle 'member': backfill må aldrig give admin-rettigheder. `on conflict do
-- nothing` gør kørslen idempotent og rører ikke en eksisterende admin-række.
insert into public.group_members (group_id, user_id, role)
select distinct c.group_id, cp.user_id, 'member'
from public.competition_participants cp
join public.competitions c on c.id = cp.competition_id
where c.group_id is not null
on conflict (group_id, user_id) do nothing;

-- ============================================================================
-- 2. Trigger — nye deltagere indmeldes automatisk i ligaen
-- ============================================================================
-- security definer, fordi RLS på group_members kun tillader at indsætte sin EGEN
-- række (`user_id = auth.uid()`), mens denne trigger også skal kunne dække
-- security definer-funktioner som move_competition_to_group().
--
-- Hvorfor auto-indmelding frem for at afvise med en fejl: A8 siger, at deltagelse
-- i en liga-konkurrence ER liga-medlemskab — de to ting er én handling, ikke en
-- betingelse. En afvisning ville tvinge hver eneste kaldesti til at kende
-- rækkefølgen (præcis den fejl, A7 afdækkede); auto-indmelding gør invarianten
-- sand uanset hvem der skriver rækken. Frontenden fortæller stadig brugeren om
-- det i bekræftelses-modalen — dette er sikkerhedsnettet, ikke forklaringen.
create or replace function public.ensure_group_membership_for_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

drop trigger if exists competition_participants_ensure_group on public.competition_participants;
create trigger competition_participants_ensure_group
  before insert on public.competition_participants
  for each row
  execute function public.ensure_group_membership_for_participant();

-- ============================================================================
-- 3. Framelding fra en konkurrence: spærren gælder kun MIDT I ET FORLØB
-- ============================================================================
-- Erstatter comp_participants_delete_own_unlocked fra sql/groups.sql.
--
-- Den oprindelige begrundelse var at forhindre, at man "sletter en dårlig,
-- synlig historik MIDT I ET FORLØB". Men reglen så kun på, om man havde tips på
-- låste/spillede kampe — og en spillet kamp bliver aldrig uspillet igen, så
-- spærren var i praksis permanent. Sammen med afsnit 4 nedenfor ville det gøre
-- det umuligt nogensinde at forlade en liga, man havde spillet én runde i, og
-- da admin-fjernelse af andre medlemmer bevidst ikke er bygget (groups.sql
-- afsnit 4), ville der ikke være nogen vej ud overhovedet.
--
-- Ny regel, som matcher den oprindelige hensigt: er ALLE konkurrencens kampe
-- spillet, er forløbet forbi, og framelding kan ikke skjule noget, der stadig er
-- i spil. Er der kampe tilbage, gælder historik-beskyttelsen uændret.
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
      -- (b) Ellers: uændret historik-beskyttelse — ingen tips på låste kampe.
      --     Låse-udtrykket er kopieret 1:1 fra groups.sql (null-sikkert).
      or not exists (
        select 1
        from public.competition_matches cm
        join public.matches m on m.id = cm.match_id
        join public.predictions p on p.match_id = m.id and p.user_id = auth.uid()
        where cm.competition_id = competition_participants.competition_id
          and (
            m.home_score is not null
            or exists (
              select 1 from public.matches m2
              where m2.round_key = m.round_key
                and m2.season_id is not distinct from m.season_id
                and m2.kickoff_at is not null
                and m2.kickoff_at <= now() + interval '1 hour'
            )
          )
      )
    )
  );

-- ============================================================================
-- 4. DELETE-policy — man kan ikke forlade en liga, man stadig konkurrerer i
-- ============================================================================
-- Erstatter group_members_delete_self (som kun krævede user_id = auth.uid()).
--
-- Hvorfor blokere frem for at framelde automatisk: framelding fra en konkurrence
-- er beskyttet af afsnit 3 ovenfor. En automatisk framelding ved "forlad liga"
-- ville enten skulle omgå den beskyttelse eller lykkes kun delvist og dermed
-- genskabe den forældreløse tilstand. At blokere bevarer begge regler og kan
-- forklares i én sætning: "Frameld dig ligaens konkurrencer først."
--
-- Bemærk: den blokerer på DELTAGELSE, ikke på tips. Deltager man ikke i nogen af
-- ligaens konkurrencer, kan man forlade ligaen frit — også med en fuld historik.
-- Sammen med afsnit 3 betyder det: mens en konkurrence kører, er man bundet til
-- ligaen; når dens kampe er spillet, kan man melde sig ud af begge.
drop policy if exists group_members_delete_self on public.group_members;
create policy group_members_delete_self on public.group_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    and not exists (
      select 1
      from public.competition_participants cp
      join public.competitions c on c.id = cp.competition_id
      where cp.user_id = auth.uid()
        and c.group_id = group_members.group_id
    )
  );

-- ============================================================================
-- 5. Verifikation — skal give 0 rækker efter kørsel
-- ============================================================================
-- select cp.user_id, c.group_id, c.name
-- from public.competition_participants cp
-- join public.competitions c on c.id = cp.competition_id
-- left join public.group_members gm
--   on gm.group_id = c.group_id and gm.user_id = cp.user_id
-- where c.group_id is not null and gm.user_id is null;

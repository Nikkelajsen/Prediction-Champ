-- Prediction Champ — Liga-laget (permanente fællesskaber), fase 1: DB-fundament
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS"
-- (scriptet sætter selv RLS på de tabeller, der skal have det).
--
-- Spec: docs/features/liga-laget-v1.md. Indfører den permanente liga-enhed, som
-- konkurrencer lever indeni. NB om navngivning (spec afsnit 2): DB-enheden hedder
-- `groups`/`group_members` for at undgå kollision med `leagues` (fodbold-TURNERINGER).
-- I al brugervendt tekst hedder `groups` en "liga", `leagues` en "turnering".
--
-- Tilføjer:
--   * tabellen groups         — fællesskabet (navn + ét delbart invite-link)
--   * tabellen group_members  — medlemskab (admin/member)
--   * competitions.group_id   — nullable gruppetilhør (null = liga-løs, virker som før)
--   * hjælpefunktioner        — is_group_member / is_group_admin (security definer,
--                               bryder RLS-rekursion) + move_competition_to_group()
--   * RLS-policies            — inkl. ny competition_participants-DELETE (forlad
--                               konkurrence, men ikke med tips på låste kampe)
--
-- Kan køres igen når som helst. Ingen ændring i predictions/matches/ratings/views/triggere.

-- ======================= 1. Tabeller =======================
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 40),
  invite_code text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  created_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
-- Opslag "mine ligaer" (alle grupper en bruger er medlem af).
create index if not exists group_members_user_idx on public.group_members (user_id);

-- Gruppetilhør på konkurrencer. Nullable + "on delete set null": sletter man en liga,
-- bliver dens konkurrencer liga-løse (de slettes ALDRIG som følge af liga-sletning).
alter table public.competitions
  add column if not exists group_id uuid references public.groups (id) on delete set null;
create index if not exists competitions_group_idx on public.competitions (group_id);

-- ======================= 2. Hjælpefunktioner (security definer) =======================
-- Kritisk: group_members-SELECT-policyen må IKKE selv slå op i group_members (så ville
-- RLS udløse sig selv → "infinite recursion", jf. DOCUMENTATION.md afsnit 13). Derfor
-- læses medlemskab gennem en security definer-funktion, der kører som ejer og dermed
-- forbigår RLS på det interne opslag.

create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(gid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_admin(uuid) to authenticated;

-- ======================= 3. RLS: groups =======================
alter table public.groups enable row level security;

-- SELECT åbent for authenticated: nødvendigt for at slå en liga op via invite-koden,
-- før man er medlem (samme bevidste valg som for competitions, jf. fejlfindingsloggen
-- "Kunne ikke joine med kode"). Invite-koden er 8 tegn og er selve adgangsbilletten.
drop policy if exists groups_select_all on public.groups;
create policy groups_select_all on public.groups
  for select to authenticated using (true);

-- INSERT: man kan kun oprette en liga med sig selv som ejer.
drop policy if exists groups_insert_own on public.groups;
create policy groups_insert_own on public.groups
  for insert to authenticated with check (created_by = auth.uid());

-- UPDATE (omdøb): kun liga-admin.
drop policy if exists groups_update_admin on public.groups;
create policy groups_update_admin on public.groups
  for update to authenticated
  using (public.is_group_admin(id))
  with check (public.is_group_admin(id));

-- DELETE: kun liga-admin, og kun TOMME ligaer (ingen konkurrencer). v1 tillader ikke
-- sletning af en liga med indhold fra UI — det beskytter fællesskabets kerne mod
-- destruktive fejlklik (spec afsnit 8). Flyt/fjern konkurrencerne først.
drop policy if exists groups_delete_admin_empty on public.groups;
create policy groups_delete_admin_empty on public.groups
  for delete to authenticated
  using (
    public.is_group_admin(id)
    and not exists (select 1 from public.competitions c where c.group_id = groups.id)
  );

grant select, insert, update, delete on public.groups to authenticated;

-- ======================= 4. RLS: group_members =======================
alter table public.group_members enable row level security;

-- SELECT: egne rækker (hurtig sti) + rækker i ligaer, man selv er medlem af (via
-- security definer-funktionen — aldrig et direkte opslag i group_members her).
drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_group_member(group_id));

-- INSERT: man melder KUN sig selv ind (invite-koden er billetten). Man kan indsætte sig
-- som 'member'; kun ligaens opretter må indsætte sig som 'admin' (den første admin-række
-- ved oprettelsen). Det forhindrer, at et almindeligt medlem selv-forfremmer til admin.
drop policy if exists group_members_insert_self on public.group_members;
create policy group_members_insert_self on public.group_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      role = 'member'
      or exists (select 1 from public.groups g where g.id = group_id and g.created_by = auth.uid())
    )
  );

-- DELETE: man kan forlade en liga (fjerne sin egen række). Admin-fjernelse af ANDRE
-- medlemmer er bevidst udskudt (spec afsnit 8).
drop policy if exists group_members_delete_self on public.group_members;
create policy group_members_delete_self on public.group_members
  for delete to authenticated
  using (user_id = auth.uid());

-- Ingen UPDATE-policy i v1 (rolle-ændring = medlems-administration, uden for scope).
grant select, insert, delete on public.group_members to authenticated;

-- ======================= 5. RLS: competition_participants (forlad konkurrence) =======================
-- Ny DELETE-policy: en bruger kan framelde sig en konkurrence (slette sin egen
-- deltager-række) — MEN kun hvis vedkommende ikke har tips på konkurrencens allerede
-- LÅSTE kampe. Ellers kunne framelding bruges til at slette en dårlig, synlig historik
-- midt i et forløb. Låse-reglen er runde-baseret og genbrugt 1:1 fra
-- sql/predictions_round_lock_policies.sql (null-sikkert udtryk).
alter table public.competition_participants enable row level security;

drop policy if exists comp_participants_delete_own_unlocked on public.competition_participants;
create policy comp_participants_delete_own_unlocked on public.competition_participants
  for delete to authenticated
  using (
    user_id = auth.uid()
    and not exists (
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
  );

grant delete on public.competition_participants to authenticated;

-- ======================= 6. move_competition_to_group() =======================
-- Flytter en eksisterende konkurrence ind i en liga (blød migrering, spec afsnit 6).
-- Konkurrencens nuværende deltagere bliver automatisk liga-medlemmer (fællesskabet
-- følger med — ingen mister adgang eller skal gen-inviteres). Kræver security definer,
-- fordi almindelig RLS ikke må indsætte ANDRE brugeres medlemsrækker.
--
-- Guard: kalderen skal eje konkurrencen OG være medlem af mål-ligaen. (A6: alle
-- medlemmer må råde over ligaens konkurrencer — ingen admin-gate på flytning.)
create or replace function public.move_competition_to_group(p_comp_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

grant execute on function public.move_competition_to_group(uuid, uuid) to authenticated;

-- ======================= 7. Backfill: deltagere → liga-medlemmer =======================
-- Engangs-oprydning (idempotent): sørg for, at ALLE deltagere i en konkurrence, der
-- hører til en liga, også er medlemmer af ligaen. Fanger historiske deltagere fra før
-- rettelsen, hvor et konkurrence-deep-link (?join=) kun meldte ind i konkurrencen og
-- ikke i ligaen. Nye joins (deep-link + manuel kode) melder nu ind i begge, og
-- move_competition_to_group() gør det samme ved flytning — så dette er kun et catch-up.
-- Bevarer eksisterende roller (on conflict do nothing → en admin forbliver admin).
insert into public.group_members (group_id, user_id, role)
select distinct c.group_id, cp.user_id, 'member'
from public.competition_participants cp
join public.competitions c on c.id = cp.competition_id
where c.group_id is not null
on conflict (group_id, user_id) do nothing;

-- ======================= Noter før/efter kørsel =======================
-- 1) Verificér ingen "infinite recursion" på group_members (kendt fælde). Test som en
--    almindelig bruger:  select * from public.group_members;  — må ikke fejle.
-- 2) competition_participants kan allerede have policies (INSERT for join, evt. andre).
--    Denne fil RØRER dem ikke; den tilføjer kun DELETE-policyen. Auditér med:
--      select policyname, cmd from pg_policies
--      where schemaname='public' and tablename='competition_participants';
-- 3) Eksisterende konkurrencer har group_id = null og virker uændret ("Øvrige
--    konkurrencer" i UI). Ingen automatisk gruppering — opretteren flytter selv via
--    move_competition_to_group() (fase 3).

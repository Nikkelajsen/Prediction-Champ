-- =============================================================================
-- PRØVEKØRSEL AF KONTOLUKNINGEN — STAGING (og ét opslag, der må køres i drift)
-- =============================================================================
--
-- Formålet: at kunne SE, hvad `anonymize_my_account()` gør, før den køres på et
-- menneske. Filen skriver ingenting selv — den installerer to opslag, som
-- læses før og efter kørslen, så forskellen kan aflæses frem for formodes.
--
-- Rækken hedder `G76` i `docs/BACKLOG.md`. Anonymiseringen er **uigenkaldelig**
-- og havde aldrig kørt på en rigtig database, da filen blev skrevet.
--
-- ---------------------------------------------------------------------------
-- HVORFOR TO OPSLAG OG IKKE ÉT
--
-- `rehearsal.report()` svarer på "hvad skete der med brugeren?" og er hele
-- kontrakten i `sql/liga_admin.sql` stillet op som før/efter: det personlige
-- ryddes, historikken bevares, og deltagelser i konkurrencer, der ikke er
-- begyndt, forsvinder (`A25`).
--
-- `rehearsal.leagues()` svarer på noget andet, og det er dét, `A36` handler om:
-- hvad ligaen ser, når et af dens medlemmer er lukket. Den kan ikke aflæses på
-- brugeren, kun på LISTEN — og den har en kolonne, der ikke handler om
-- pseudonymet: `levende_admins`.
--
-- **`levende_admins = 0` er en liga, ingen kan administrere mere.** Admin-rollen
-- kan kun uddeles ÉN gang, ved oprettelsen, af opretteren selv
-- (`group_members_insert_self` tillader `role = 'admin'`, når
-- `groups.created_by = auth.uid()`), og der findes ingen UPDATE-policy på
-- `group_members`, altså ingen forfremmelse — det er bevidst udskudt fra v1
-- (`docs/features/liga-laget-v1.md`). En lukket konto kan aldrig logge ind igen
-- (`api/delete-account.js` soft-sletter `auth.users`), så `is_group_admin()`
-- kan aldrig blive sand for den liga igen. Ligaen kan derefter hverken omdøbes,
-- slettes, få fjernet en deltager eller få slettet en konkurrence. Nogensinde.
--
-- Rækken hedder `A37`, og opslaget er skrevet, så det kan køres **mod
-- produktionen** som et rent læse-opslag: det svarer på, om nogen liga allerede
-- står sådan.
--
-- ---------------------------------------------------------------------------
-- SÅDAN BRUGES DEN (staging, SQL-editoren, "Run without RLS")
--
--   1. Kør denne fil. Den installerer skemaet `rehearsal` og rører intet andet.
--
--   2. Find testkontoen og læs FØR-billedet:
--        select * from rehearsal.report('<bruger-id>');
--        select * from rehearsal.leagues('<bruger-id>');
--
--   3. Luk kontoen. I SQL-editoren findes der ingen `auth.uid()`, så det er
--      kroppen, der kaldes — nøjagtig den, begge indgange bruger:
--        select public._anonymize_account('<bruger-id>');
--
--      Vil man prøve HELE forløbet af (knappen i Profil + soft-sletningen i
--      `auth.users`), skal det gøres fra appen mod staging; RPC'en her er kun
--      databasehalvdelen.
--
--   4. Læs EFTER-billedet med de samme to kald. Kør gerne trin 3 en gang til:
--      funktionen er idempotent og skal svare det samme pseudonym uden at
--      flytte `anonymized_at`.
--
--   5. Ryd op, når du er færdig:  drop schema rehearsal cascade;
--
-- ---------------------------------------------------------------------------
-- Idempotent. Kan gen-køres.
-- =============================================================================

create schema if not exists rehearsal;

-- ---------------------------------------------------------------------------
-- 1) Brugeren: hvad ryddes, hvad bevares
-- ---------------------------------------------------------------------------
create or replace function rehearsal.report(p_user_id uuid)
returns table (felt text, vaerdi text)
language sql
stable
as $fn$
  select * from (values
    ('profiles.display_name',
       (select display_name from public.profiles where id = p_user_id)),
    ('profiles.anonymized_at',
       (select coalesce(anonymized_at::text, '—') from public.profiles where id = p_user_id)),
    ('profiles.is_admin',
       (select is_admin::text from public.profiles where id = p_user_id)),
    ('profiles.last_seen_at',
       (select coalesce(last_seen_at::text, '—') from public.profiles where id = p_user_id)),

    ('— ryddes —', ''),
    ('push_subscriptions',  (select count(*)::text from public.push_subscriptions where user_id = p_user_id)),
    ('notification_log',    (select count(*)::text from public.notification_log   where user_id = p_user_id)),
    ('stories',             (select count(*)::text from public.stories            where user_id = p_user_id)),
    ('analytics_events',    (select count(*)::text from public.analytics_events   where user_id = p_user_id)),
    ('user_activity_days',  (select count(*)::text from public.user_activity_days where user_id = p_user_id)),

    -- Rækken bliver stående, kun koblingen forsvinder. Derfor BEGGE tal: et
    -- fald i "i alt" ville betyde, at der blev slettet frem for afkoblet.
    ('— afkobles (rækken består) —', ''),
    ('feedback (koblet)',      (select count(*)::text from public.feedback      where user_id = p_user_id)),
    ('feedback (i alt)',       (select count(*)::text from public.feedback)),
    ('client_errors (koblet)', (select count(*)::text from public.client_errors where user_id = p_user_id)),
    ('client_errors (i alt)',  (select count(*)::text from public.client_errors)),

    -- Vennernes historik. Ændrer ét af disse tal sig, er løftet i `B4` brudt.
    ('— BEVARES —', ''),
    ('predictions',        (select count(*)::text from public.predictions        where user_id = p_user_id)),
    ('ratings',            (select count(*)::text from public.ratings            where user_id = p_user_id)),
    ('rating_history',     (select count(*)::text from public.rating_history     where user_id = p_user_id)),
    ('milestones',         (select count(*)::text from public.milestones         where user_id = p_user_id)),
    ('competition_awards', (select count(*)::text from public.competition_awards where user_id = p_user_id)),
    ('auth.users',         (select count(*)::text from auth.users                where id      = p_user_id)),

    -- `A25`: kun de konkurrencer, hvor ingen kamp er låst eller spillet, OG
    -- hvor der er mindst én anden deltager tilbage, forsvinder.
    ('— deltagelser (A25) —', ''),
    ('deltagelser i alt',
       (select count(*)::text from public.competition_participants where user_id = p_user_id)),
    ('… i konkurrencer, der ER begyndt',
       (select count(*)::text from public.competition_participants cp
         where cp.user_id = p_user_id and exists (
           select 1 from public.competition_matches cm
           join public.matches m on m.id = cm.match_id
           where cm.competition_id = cp.competition_id
             and (public.match_locked(m.kickoff_at, m.kickoff_tbd) or m.home_score is not null)))),
    ('… i konkurrencer, hvor brugeren er ALENE',
       (select count(*)::text from public.competition_participants cp
         where cp.user_id = p_user_id and not exists (
           select 1 from public.competition_participants o
           where o.competition_id = cp.competition_id and o.user_id <> p_user_id)))
  ) t(felt, vaerdi);
$fn$;

-- ---------------------------------------------------------------------------
-- 2) Ligaerne: hvad listen viser — og om nogen kan administrere den (A36/A37)
-- ---------------------------------------------------------------------------
-- Kaldes med en bruger for at se netop dennes ligaer, eller med `null` for at
-- se dem ALLE. Sidstnævnte er det opslag, der må køres mod produktionen: det
-- læser kun, og det svarer på, om der allerede findes en liga uden en levende
-- administrator.
create or replace function rehearsal.leagues(p_user_id uuid default null)
returns table (
  liga            text,
  medlemmer       bigint,
  lukkede         bigint,
  levende_admins  bigint,
  opretter_lukket boolean,
  medlemsliste    text
)
language sql
stable
as $fn$
  select
    g.name,
    count(*),
    count(*) filter (where p.anonymized_at is not null),
    count(*) filter (where gm.role = 'admin' and p.anonymized_at is null),
    (select op.anonymized_at is not null from public.profiles op where op.id = g.created_by),
    string_agg(
      p.display_name || case when gm.role = 'admin' then ' (admin)' else '' end
                     || case when p.anonymized_at is not null then ' · LUKKET' else '' end,
      ', ' order by p.display_name)
  from public.groups g
  join public.group_members gm on gm.group_id = g.id
  join public.profiles p       on p.id = gm.user_id
  where p_user_id is null
     or exists (select 1 from public.group_members me
                 where me.group_id = g.id and me.user_id = p_user_id)
  group by g.id, g.name, g.created_by
  order by 4, g.name;   -- ligaer uden levende admin først
$fn$;

-- ---------------------------------------------------------------------------
-- Verifikation efter kørsel: begge funktioner findes og kan kaldes.
--   select * from rehearsal.leagues();          -- alle ligaer, de frosne først
--   select * from rehearsal.report('<id>');
-- ---------------------------------------------------------------------------

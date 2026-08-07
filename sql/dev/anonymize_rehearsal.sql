-- =============================================================================
-- PRØVEKØRSEL AF KONTOLUKNINGEN — KUN STAGING
-- =============================================================================
--
-- Formålet: at kunne SE, hvad `anonymize_my_account()` gør, før den køres på et
-- menneske. Filen rører ingen DATA — men den er **ikke** harmløs i produktion,
-- se advarslen nedenfor.
--
-- Rækken hedder `G76` i `docs/BACKLOG.md`. Anonymiseringen er **uigenkaldelig**
-- og havde aldrig kørt på en rigtig database, da filen blev skrevet.
--
-- ---------------------------------------------------------------------------
-- 🛑 KØR IKKE DENNE FIL I PRODUKTION
--
-- Filen INSTALLERER noget: et skema og en funktion, som bliver stående, til
-- nogen dropper dem. Det er præcis det, `sql/checks/`-modellen findes for at
-- undgå — en forespørgsel, der skal køres mod produktion, skrives som en
-- **temporær** view, der kun lever i sin egen psql-session (`G84`, 7. august
-- 2026). En `create function` uden et eksplicit `revoke` får desuden `execute`
-- til `PUBLIC` som default; her er den utilgængelig alene fordi ingen rolle har
-- `usage` på skemaet, og "utilgængelig på grund af en default" er nøjagtig den
-- slags bredde, `G50`/`G58` blev kørt for at fjerne.
--
-- **Skal du aflæse produktionen, er filen `sql/checks/league_admin_coverage.sql`.**
-- Den installerer intet, er dækket af `sql/tests/league_admin_coverage.sql` i
-- CI, og den svarer på det spørgsmål (`A37`), som denne fil oprindeligt bar.
--
-- ---------------------------------------------------------------------------
-- HVAD OPSLAGET SVARER PÅ
--
-- `rehearsal.report()` svarer på "hvad skete der med brugeren?" og er hele
-- kontrakten i `sql/liga_admin.sql` stillet op som før/efter: det personlige
-- ryddes, historikken bevares, og deltagelser i konkurrencer, der ikke er
-- begyndt, forsvinder (`A25`).
--
-- Medlemslisten — altså `A36` og `A37` — læses IKKE herfra. Den læses med
-- `sql/checks/league_admin_coverage.sql`, som virker begge steder:
--
--   \ir ../checks/league_admin_coverage.sql
--   select * from league_admin_coverage order by levende_admins, liga;
--
-- ---------------------------------------------------------------------------
-- SÅDAN BRUGES DEN (staging, SQL-editoren, "Run without RLS")
--
--   1. Kør denne fil. Den installerer skemaet `rehearsal` og rører intet andet.
--
--   2. Find testkontoen og læs FØR-billedet:
--        select * from rehearsal.report('<bruger-id>');
--
--   3. Luk kontoen. I SQL-editoren findes der ingen `auth.uid()`, så det er
--      kroppen, der kaldes — nøjagtig den, begge indgange bruger:
--        select public._anonymize_account('<bruger-id>');
--
--      Vil man prøve HELE forløbet af (knappen i Profil + soft-sletningen i
--      `auth.users`), skal det gøres fra appen mod staging; RPC'en her er kun
--      databasehalvdelen.
--
--   4. Læs EFTER-billedet med det samme kald. Kør gerne trin 3 en gang til:
--      funktionen er idempotent og skal svare det samme pseudonym uden at
--      flytte `anonymized_at`.
--
--   5. **Ryd op, når du er færdig:**  drop schema rehearsal cascade;
--      Det er ikke pænhed — det er, hvad der gør denne fil forskellig fra en
--      migrering: den efterlader intet, fordi den ikke er en del af skemaet.
--
-- ---------------------------------------------------------------------------
-- Idempotent. Kan gen-køres.
-- =============================================================================

create schema if not exists rehearsal;

-- ---------------------------------------------------------------------------
-- Brugeren: hvad ryddes, hvad bevares
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
-- Verifikation efter kørsel: funktionen findes og kan kaldes.
--   select * from rehearsal.report('<id>');
--
-- Medlemslisten (`A36`/`A37`) læses med sql/checks/league_admin_coverage.sql,
-- som virker både her og mod produktion.
-- ---------------------------------------------------------------------------

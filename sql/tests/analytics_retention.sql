-- Test af `sql/analytics_retention.sql` (G77).
--
-- Kører mod en engangsdatabase, hvor PRODUKTIONSSKEMAET allerede er indlæst
-- (`node sql/tests/_schema.mjs`). Rører aldrig produktion.
--
-- HVORFOR DEN FINDES, når hverken `prune_job_runs()` eller
-- `prune_client_errors()` har en. Fordi denne rydning er et `delete` mod
-- brugerdata, hvor hele sikkerheden ligger i ÉN sammenligning — og en fejl i
-- den er ikke en fejlbesked, men en tabel, der er tom. Det er samme klasse som
-- `G84`s: kode, der ser rigtig ud, og som ville være tavs, hvad enten den
-- virkede eller ej. De to søskende blev skrevet, før den erfaring fandtes;
-- det er en grund til at skrive en test her, ikke til at lade være.
--
-- HVAD DEN BEVISER
--   1. Gamle rækker fjernes, og antallet meldes tilbage.
--   2. **Nye rækker bliver stående.** Fortegnsfejlen i sammenligningen ville
--      vende de to om og tømme tabellen for alt det, der stadig bruges.
--   3. Grænsen er 18 måneder, ikke 18 dage eller 18 uger: en række på 17
--      måneder overlever, en på 19 gør ikke.
--   4. `greatest(1, …)` holder: et kald med 0 bliver til ÉN måned og ikke til
--      "slet alt". Det er ikke det samme som en no-op, og forskellen er værd
--      at have skrevet ned — første udgave af testen antog det modsatte.
--   5. Rydningen er idempotent — anden kørsel fjerner nul.
--
-- KØR LOKALT
--   node sql/tests/_schema.mjs > /tmp/skema.sql
--   psql -d artest -v ON_ERROR_STOP=1 -f /tmp/skema.sql
--   psql -d artest -v ON_ERROR_STOP=1 -b -f sql/tests/analytics_retention.sql

\set ON_ERROR_STOP on
\timing off

\ir ../analytics_retention.sql

insert into auth.users (id, email, created_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@test.local', now());
insert into public.profiles (id, display_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Anna');

-- Fem rækker fordelt omkring grænsen. `login` er et lovligt navn i kataloget;
-- constraint'en i analytics_events.sql ville ellers afvise dem.
insert into public.analytics_events (event_name, user_id, created_at)
select 'login', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now() - make_interval(months => m)
from unnest(array[0, 6, 17, 19, 30]) m;

-- ---------------------------------------------------------------------------
-- Påstand 1, 2 og 3: grænsen ligger, hvor den skal
-- ---------------------------------------------------------------------------

do $$
declare v_fjernet int;
begin
  select public.prune_analytics_events(18) into v_fjernet;

  if v_fjernet <> 2 then
    raise exception 'forventede 2 fjernede rækker (19 og 30 måneder), fik %', v_fjernet;
  end if;
  if (select count(*) from public.analytics_events) <> 3 then
    raise exception 'forventede 3 tilbage (0, 6 og 17 måneder), fik %',
      (select count(*) from public.analytics_events);
  end if;
  -- Påstand 3, sagt direkte: den yngste af de fjernede lå på 19 måneder, og
  -- den ældste af de tilbageværende på 17. Uden dette kunne en enhedsfejl
  -- (dage frem for måneder) stadig give 2 og 3.
  if (select max(now() - created_at) from public.analytics_events) < interval '16 months' then
    raise exception 'grænsen ser ud til at være i en anden enhed end måneder — ældste tilbageværende er %',
      (select max(now() - created_at) from public.analytics_events);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 5: idempotent
-- ---------------------------------------------------------------------------

do $$
declare v_fjernet int;
begin
  select public.prune_analytics_events(18) into v_fjernet;
  if v_fjernet <> 0 then
    raise exception 'anden kørsel skal fjerne nul, fik %', v_fjernet;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Påstand 4: nul betyder ÉN måned, ikke "slet alt"
-- ---------------------------------------------------------------------------
-- Gulvet er det samme som i `prune_job_runs()` og `prune_client_errors()`, og
-- det, det beskytter mod, er en tom eller forkert parameter i en workflow —
-- ikke mod et bevidst lavt tal. Rækken fra i dag skal stå der bagefter.

do $$
declare v_fjernet int;
begin
  select public.prune_analytics_events(0) into v_fjernet;
  if not exists (select 1 from public.analytics_events where created_at > now() - interval '1 day') then
    raise exception 'et kald med 0 tømte tabellen — gulvet i greatest(1, …) virker ikke';
  end if;
  -- Og det gør faktisk noget: rækkerne på 6 og 17 måneder ligger over én måned.
  if v_fjernet <> 2 then
    raise exception 'et kald med 0 skal rydde alt over ÉN måned (2 rækker), fik %', v_fjernet;
  end if;
end $$;

\echo 'analytics_retention.sql: alle fem påstande holdt.'

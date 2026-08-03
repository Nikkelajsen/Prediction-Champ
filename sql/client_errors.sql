-- Fejltelemetri for frontenden: `client_errors` (G42).
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- ---------------------------------------------------------------------------
-- Hvorfor
--
-- Backenden har `job_runs`: hver kørsel efterlader en række, og Admin → Drift
-- kan aflæse den. Frontenden havde intet tilsvarende. En hvid skærm hos en
-- bruger kunne hverken ses, reproduceres eller kobles til et deploy — den
-- eneste modtager var `console.error` på en telefon, ingen udvikler har i
-- hånden. `G20` gav appen en error boundary, så fejlen bliver FANGET; denne
-- migrering er det sted, den bliver RAPPORTERET.
--
-- ---------------------------------------------------------------------------
-- Hvorfor Postgres og ikke Sentry
--
-- Tre grunde, i den rækkefølge de vejer:
--
--   1. **Privatliv.** `B4` (3. august 2026) gav appen en privatlivspolitik, der
--      opremser, hvad der gemmes og hvem der behandler det. En ekstern
--      fejltjeneste er en ny databehandler, som skal stå i den politik — og
--      den ville modtage stakspor fra en app, hvor brugerens data ER indholdet.
--      At holde fejlene i den database, brugeren allerede har accepteret, er
--      ikke en besparelse; det er den mindste ændring af løftet.
--   2. **Samme arkitekturvalg som Analytics v1** ("kun Postgres, intet Google
--      Analytics"). To måle-lag med hver sin leverandør ville betyde to steder
--      at kigge og to steder at rydde op, når en konto lukkes.
--   3. **Ingen ny afhængighed.** Appen har fire runtime-deps. En SDK til
--      fejlrapportering er typisk større end alt, appen selv sender.
--
-- Prisen er kendt: ingen gruppering, ingen søgning og ingen alarm ud af boksen.
-- Det er acceptabelt ved de tal, produktet har — otte brugere, hvor ÉN
-- fejlrække er en nyhed — og migreringen kan altid suppleres af en tjeneste,
-- hvis mængden vokser. Det omvendte (at fjerne en tjeneste igen) er dyrere.

create table if not exists public.client_errors (
  id             uuid primary key default gen_random_uuid(),
  -- `set null` og ikke cascade, af samme grund som `feedback`: en fejl er stadig
  -- sand, efter kontoen er lukket, og den fejl, den beskriver, findes stadig.
  user_id        uuid default auth.uid() references auth.users(id) on delete set null,
  -- 'render' (error boundary) · 'error' (window.onerror) · 'rejection'
  -- (unhandledrejection). Tre kilder, fordi de fanger hver sin slags fejl —
  -- og fordi kilden er det første, man vil vide.
  kind           text not null,
  message        text not null,
  -- Stakken er minificeret uden source maps. Den er alligevel værd at gemme:
  -- funktionsnavne overlever ofte, og linje/kolonne kan slås op i den
  -- `.map`-fil, buildet nu udgiver (vite.config.js).
  stack          text,
  component_stack text,
  -- Hvor stod brugeren, og hvilken version så de? De to spørgsmål er dem,
  -- enhver fejlmelding starter med, og `G42`s billige halvdel gav allerede
  -- versionen et sted at stå.
  screen         text,
  app_version    text,
  url            text,
  user_agent     text,
  created_at     timestamptz not null default now()
);

-- Grænser som i `feedback`: en fejlmelding må ikke kunne fylde tabellen.
-- Stakspor kan være lange, men ikke ubegrænsede — 8 KB rummer et helt
-- component-stack og klipper en uendelig rekursion af.
alter table public.client_errors drop constraint if exists client_errors_kind_check;
alter table public.client_errors add constraint client_errors_kind_check
  check (kind in ('render', 'error', 'rejection'));

alter table public.client_errors drop constraint if exists client_errors_message_len;
alter table public.client_errors add constraint client_errors_message_len
  check (char_length(message) between 1 and 2000);

alter table public.client_errors drop constraint if exists client_errors_stack_len;
alter table public.client_errors add constraint client_errors_stack_len
  check (stack is null or char_length(stack) <= 8000);

alter table public.client_errors drop constraint if exists client_errors_component_stack_len;
alter table public.client_errors add constraint client_errors_component_stack_len
  check (component_stack is null or char_length(component_stack) <= 8000);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

-- ---------- RLS ----------
-- Præcis samme form som `feedback`: kun INSERT, kun egne rækker, ingen
-- select-policy. En bruger skal ikke kunne læse andres fejl, og deres egne har
-- de ingen brug for. Følgen er, at insertet SKAL bruge `Prefer: return=minimal`.
alter table public.client_errors enable row level security;

drop policy if exists client_errors_insert_own on public.client_errors;
create policy client_errors_insert_own on public.client_errors
  for insert
  to authenticated
  with check (user_id = auth.uid());

revoke all on public.client_errors from anon;
grant insert on public.client_errors to authenticated;

-- ---------- Læsning: admin-gatet RPC ----------
-- Samme mønster som `admin_feedback()` og `admin_job_health()`: SECURITY
-- DEFINER med et eksplicit is_admin-tjek som første sætning, så adgangen står
-- som én linje, man kan se, frem for i en policy-betingelse.
create or replace function public.admin_client_errors(max_rows integer default 100)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  kind text,
  message text,
  stack text,
  component_stack text,
  screen text,
  app_version text,
  url text,
  user_agent text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
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

revoke execute on function public.admin_client_errors(integer) from public, anon;
grant execute on function public.admin_client_errors(integer) to authenticated;

-- ---------- Rydning ----------
-- Tabellen skal ikke vokse uden loft. Samme mønster og samme kalder som
-- `prune_job_runs()`: job-heartbeat'en har i forvejen adgangen og et skema.
create or replace function public.prune_client_errors(keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.client_errors
   where created_at < now() - make_interval(days => greatest(1, keep_days));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.prune_client_errors(integer) from public, anon, authenticated;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Tabel + RLS. Forvent rowsecurity = true.
-- select relname, relrowsecurity from pg_class where relname = 'client_errors';

-- 2) Kun insert til authenticated, intet til anon. Forvent én række: INSERT.
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'client_errors' and table_schema = 'public';

-- 3) Som admin: forvent en (tom) liste frem for en fejl.
-- select * from public.admin_client_errors(10);

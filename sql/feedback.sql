-- Prediction Champ — feedback fra brugerne (B14)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- ---------------------------------------------------------------------------
-- Hvorfor
--
-- Der fandtes ingen vej fra en bruger til udvikleren. En fejl, en forvirring
-- eller et ønske døde, hvor det opstod, og det eneste, der nåede frem, var det,
-- nogen huskede at sige i telefonen. Det er samme hul som G42 set fra den anden
-- side: dér mangler maskinens spor efter et crash, her mangler menneskets.
--
-- ---------------------------------------------------------------------------
-- Hvorfor en tabel og ikke en mailto:
--
-- En `mailto:`-genvej havde kostet nul kode og nul migrering, men den åbner
-- brugerens egen mailklient — på iOS ofte ingen — og efterlader ingen liste at
-- arbejde ud fra. Den ville også have tabt `context` nedenfor, som er halvdelen
-- af værdien: en melding uden version og skærm kan sjældent følges op.
--
-- Mønstret er analytics_events' (sql/analytics_events.sql): user_id ejes af en
-- default, RLS giver KUN insert, og læsningen sker gennem en admin-gatet RPC.
-- Forskellen er, at feedback IKKE er fire-and-forget — brugeren får en
-- kvittering, og et fejlet skriv skal siges højt.

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid default auth.uid() references auth.users(id) on delete set null,
  kind        text not null,
  message     text not null,
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  uuid references auth.users(id) on delete set null
);

-- user_id: klienten sender ALDRIG kolonnen — defaulten ejer den, så den hverken
-- kan forfalskes eller glemmes i et kaldested.
--
-- on delete SET NULL og ikke cascade, modsat analytics_events. Det er et valg,
-- ikke en forglemmelse: en hændelseslog uden sin bruger er værdiløs, men en
-- fejlmelding er stadig sand, efter den, der skrev den, har slettet sin konto —
-- og den fejl, den beskriver, findes stadig.
--
-- Derfor er kolonnen NULLABLE, og det er ikke en svækkelse: `not null` og
-- `on delete set null` udelukker hinanden, så en konto ville simpelthen ikke
-- kunne slettes (fanget af sql/tests/feedback.sql, ikke ved gennemlæsning).
-- Skrivesiden er stadig lukket: en klient, der sender `user_id: null`, brydes
-- på RLS-policyens `user_id = auth.uid()`, fordi `null = <uuid>` er NULL og
-- ikke sand. Kun defaulten kan udfylde feltet, og kun med kalderens eget id.
--
-- handled_by peger på auth.users og ikke profiles, fordi den er en admin-
-- registrering og ikke noget, nogen bruger får at se.

-- kind: hvad er det for en slags melding? Tre værdier, fordi tre er det antal,
-- en bruger kan overskue i en radiogruppe, og fordi den fjerde ("spørgsmål")
-- i praksis altid er en af de to første. Håndhæves som constraint frem for i
-- klienten alene — ellers rådner ordforrådet stille, præcis som
-- hændelseskataloget ville.
alter table public.feedback drop constraint if exists feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check
  check (kind in ('problem', 'idea', 'other'));

-- Længden er både en produkt- og en misbrugsgrænse. Nedre grænse på 4 tegn
-- fanger "test" ikke, men fanger den tomme og den utilsigtede indsendelse;
-- øvre grænse på 2000 er rigeligt til en fejlbeskrivelse og lukker samtidig
-- for, at tabellen kan fyldes med én besked.
alter table public.feedback drop constraint if exists feedback_message_len;
alter table public.feedback add constraint feedback_message_len
  check (char_length(message) between 4 and 2000);

-- Admin-listen læser nyeste først og skiller ubehandlede fra behandlede.
create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_open_idx on public.feedback (created_at desc) where handled_at is null;

-- ---------- RLS ----------
alter table public.feedback enable row level security;

-- Kun INSERT, kun egne rækker. INGEN select-policy: en bruger skal ikke kunne
-- læse andres meldinger, og deres egne har de ingen brug for at hente igen —
-- klienten viser kvitteringen ud fra sit eget kald. Følgen er, at insertet SKAL
-- bruge `Prefer: return=minimal`; `return=representation` kræver SELECT-ret,
-- som ingen policy her giver.
drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert
  to authenticated
  with check (user_id = auth.uid());

revoke all on public.feedback from anon;
grant insert on public.feedback to authenticated;

-- ---------- Læsning: admin-gatet RPC ----------
-- Samme form som admin_job_health() i sql/job_runs.sql: SECURITY DEFINER med
-- et eksplicit is_admin-tjek som første sætning. Uden funktionen ville
-- læsningen kræve en select-policy, og så ville adgangskontrollen ligge i en
-- policy-betingelse frem for i én linje, man kan se.
--
-- display_name joines på, fordi en melding, man ikke kan svare på, er halvt
-- ubrugelig — og navnet er den eneste identitet, appen selv bruger. E-mail
-- hentes bevidst IKKE med: den ligger i auth.users, og en admin, der skal
-- bruge den, kan slå den op i Supabase. Listen her skal kunne stå åben på en
-- telefon uden at være en eksport af brugernes mailadresser.
create or replace function public.admin_feedback(only_open boolean default false, max_rows integer default 200)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  kind text,
  message text,
  context jsonb,
  created_at timestamptz,
  handled_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- `pr.` og ikke bare `id`: returtabellen ovenfor erklærer en OUT-parameter,
  -- der HEDDER id, og plpgsql kan ikke se forskel på den og profiles-kolonnen.
  -- Uden aliasset fejler funktionen med "column reference id is ambiguous" —
  -- ikke ved oprettelsen, men først når den kaldes. admin_job_health() slipper
  -- for det, fordi ingen af dens kolonner deler navn med en tabel-kolonne i
  -- vagten; det er ikke en forskel, man kan se ved at kopiere mønstret.
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'forbidden';
  end if;

  return query
  select f.id, f.user_id, p.display_name, f.kind, f.message, f.context, f.created_at, f.handled_at
  from public.feedback f
  left join public.profiles p on p.id = f.user_id
  where not only_open or f.handled_at is null
  order by f.created_at desc
  -- Loftet er eksplicit og ikke PostgREST's tavse 1000: en liste, der bare
  -- holder op, ligner en tom liste. `max_rows` kan hæves fra kaldestedet den
  -- dag, det bliver nødvendigt.
  limit greatest(max_rows, 1);
end $fn$;

-- ---------- Skrivning: markér som behandlet ----------
-- Uden den vokser listen kun, og den samme melding læses forfra hver gang.
-- Egen RPC frem for en update-policy af samme grund som læsningen: så er
-- admin-tjekket ét sted og ikke to.
create or replace function public.admin_feedback_set_handled(feedback_id uuid, handled boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $fn$
declare v_at timestamptz;
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'forbidden';
  end if;

  update public.feedback
     set handled_at = case when handled then now() else null end,
         handled_by = case when handled then auth.uid() else null end
   where id = feedback_id
  returning handled_at into v_at;

  return v_at;
end $fn$;

grant execute on function public.admin_feedback(boolean, integer) to authenticated;
grant execute on function public.admin_feedback_set_handled(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Verifikation efter kørsel
-- 1) Præcis én policy, og den er en INSERT-policy:
--      select policyname, cmd from pg_policies where tablename = 'feedback';
-- 2) Som en almindelig (ikke-admin) bruger skal begge fejle med 'forbidden':
--      select * from public.admin_feedback();
--      select public.admin_feedback_set_handled(gen_random_uuid(), true);
select count(*) as feedback_rows, count(*) filter (where handled_at is null) as ubehandlede
from public.feedback;

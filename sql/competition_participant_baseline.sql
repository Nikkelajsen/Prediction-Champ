-- Deltagerens nulpunkt overlever en framelding (G108).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- 📍 `#N` er en migrering: nummeret står i kolonne 1 i filoversigten i
--    `sql/README.md`, hvor filnavnene er links. `#61` =
--    `competition_join_baseline.sql`, denne fil er `#63`.
--
-- ✅ **REN TILFØJELSE — SIKKER AT KØRE NÅR SOM HELST OG UAFHÆNGIGT AF ET
-- DEPLOY.** Filen tilføjer én tabel, to trigger-funktioner og to triggere.
-- Ingen policy røres, ingen rettighed smalnes, og ingen eksisterende række
-- ændres. Klienten kender ikke tabellen og skal ikke ændres.
--
-- ---------------------------------------------------------------------------
-- HVAD DER VAR GALT
--
-- `#61` (`A53`) gjorde et gæt gyldigt i en konkurrence, kun hvis kampen låste
-- EFTER deltagerens `joined_at`. Det er den rigtige regel for en NY deltager —
-- uden den havde den, der meldte sig til midt i en konkurrence, point fra
-- første sekund for kampe, ingen andre kunne nå at gætte på.
--
-- Men `competition_participants` har ingen historik: rækken SLETTES ved
-- framelding, og `joined_at` har `default now()`. Melder man sig til igen,
-- starter nulpunktet altså forfra. Og der er ét sted, hvor det gør ondt:
--
--   · `comp_participants_delete_own_unlocked`s gren (a) tillader framelding,
--     når hver eneste kamp i konkurrencen har resultat.
--   · I netop den konkurrence er ALLE kampe låst.
--   · Så efter en genindtræden nulstiller `#61` hele sæsonen — i en stilling,
--     der er endelig, og for en spiller, der kan have vundet den.
--
-- Den anden gren er lukket i forvejen: gren (b) spærrer framelding, mens man
-- har tips på låste kampe, så en IGANGVÆRENDE konkurrence kan man ikke forlade
-- og genindtræde i. Tilbage er kun den færdigspillede. Snæver — men grim.
--
-- ---------------------------------------------------------------------------
-- HVORFOR IKKE BARE SPÆRRE FOR FRAMELDINGEN
--
-- Det var den anden vej, rækken navngav, og den er farligere end den ser ud.
-- Gren (a) findes netop, for at man kan forlade en konkurrence, man HAR spillet
-- (`sql/group_membership_invariant.sql`): uden den ville en deltager være
-- bundet til sin konkurrence for altid, og da liga-medlemskabet hænger sammen
-- med konkurrencedeltagelsen (`ensure_group_membership_for_participant()`),
-- ville hun i praksis være låst inde i ligaen. En spærre ville altså bytte en
-- sjælden, grim fejl ud med en hverdagsagtig, grimmere.
--
-- ---------------------------------------------------------------------------
-- HVAD DER ER GJORT I STEDET: NULPUNKTET HUSKES
--
-- En lille intern tabel, skrevet af to triggere. Framelding gemmer `joined_at`,
-- genindtræden arver det igen (`least`, så tallet aldrig kan flytte sig frem).
--
-- 🔴 **`A53` svækkes IKKE.** En helt ny deltager har ingen historik-række og
-- starter fortsat på 0 — det er kun DEN, DER KOMMER TILBAGE, der får sit eget
-- nulpunkt igen. Reglen bliver dermed "dit nulpunkt er første gang, du meldte
-- dig til denne konkurrence", hvilket er præcis det, `#61`s tekst allerede
-- siger, den vil beskytte.
--
-- Ingen klientændring: `db.insert` sender `Prefer: return=representation`, så
-- det gendannede `joined_at` kommer med i svaret, og appens billede er rigtigt
-- med det samme.
--
-- ⚠️ **Bagud omskrives intet.** Hver, der ALLEREDE har forladt og genindtrådt,
-- efterlod ingen række at huske ud fra; deres nulpunkt kan ikke gendannes.
-- Verifikation 3a nedenfor finder dem, der KAN bevises — de bærer en kåring
-- eller en historie fra før deres eget nulpunkt, og frosne artefakter kan kun
-- være opstået, mens de deltog.
--
-- 🔴 **Efterslæbet kan ikke måles på "gæt, der ikke tæller" alene**, og det er
-- værd at sige højt, fordi den forespørgsel ligger lige for: en helt almindelig
-- sen tilmelding giver præcis samme billede, og dét er `A53`s hensigt. De to
-- tilfælde er kun adskillelige, hvis nogen har gemt, at hun var der før — og
-- det er nøjagtig dét, denne migrering begynder at gøre. Derfor er 3b en
-- bruttoliste med et forbehold og ikke en kontrol med et facit.

-- ============================================================================
-- 1. Hukommelsen
-- ============================================================================
-- Tabellen er INTERN: den har RLS slået til og ingen policies, så ingen klient
-- kan læse eller skrive i den. De to trigger-funktioner er `security definer`
-- og kører som ejer, altså uden om RLS — samme model som `competition_awards`,
-- `stories` og `milestones`, hvor en `security definer`-funktion er eneste
-- skriver.
create table if not exists public.competition_participant_history (
  competition_id  uuid        not null references public.competitions (id) on delete cascade,
  user_id         uuid        not null references public.profiles (id)     on delete cascade,
  first_joined_at timestamptz not null,
  primary key (competition_id, user_id)
);

alter table public.competition_participant_history enable row level security;

revoke all on public.competition_participant_history from public, anon, authenticated;
grant select on public.competition_participant_history to service_role;

-- ============================================================================
-- 2. Framelding husker nulpunktet
-- ============================================================================
-- 🔴 **GUARDEN ER IKKE PYNT.** `competition_participants` har `on delete
-- cascade` fra BÅDE `competitions` og `profiles`, og en RI-cascade kører som en
-- AFTER DELETE-trigger på den tabel, rækken er slettet fra — altså ER
-- forældrerækken væk, når denne trigger fyrer. Uden guarden ville en insert i
-- historik-tabellen ramme sin egen fremmednøgle og fejle med `23503`, og
-- følgen ville være, at man **ikke længere kunne slette en konkurrence eller
-- lukke en konto**. Guarden er samtidig den rigtige semantik: er konkurrencen
-- eller brugeren væk, findes der ikke noget at komme tilbage til.
create or replace function public.remember_participant_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from public.competitions where id = old.competition_id)
     or not exists (select 1 from public.profiles where id = old.user_id) then
    return old;
  end if;

  insert into public.competition_participant_history (competition_id, user_id, first_joined_at)
  values (old.competition_id, old.user_id, old.joined_at)
  on conflict (competition_id, user_id) do nothing;

  -- `do nothing` + en betinget `update` frem for `do update set least(…)`, og
  -- det er ikke en omskrivning for smagens skyld: vagt 2 i
  -- `sql/migration_syntax.test.js` afviser enhver `update … set` uden `where`,
  -- og en `on conflict do update set` ligner præcis dét for en grep. Vagten er
  -- bevidst grov (`G86`), og filens eget svar på en falsk positiv er at
  -- omskrive sætningen frem for at svække vagten. Formen her er desuden den
  -- ærligste: `where first_joined_at > old.joined_at` SIGER, at nulpunktet kun
  -- flytter sig bagud, hvor `least()` skulle læses for at afsløre det.
  update public.competition_participant_history
     set first_joined_at = old.joined_at
   where competition_id = old.competition_id
     and user_id = old.user_id
     and first_joined_at > old.joined_at;

  return old;
end;
$fn$;

-- ============================================================================
-- 3. Genindtræden arver det igen
-- ============================================================================
-- `least` og ikke en ren overskrivning: nulpunktet må aldrig kunne flytte sig
-- FREM. Sender en fremtidig kaldesti et eksplicit `joined_at` med, der er
-- tidligere end det huskede, vinder det tidligste — og et senere kan ikke
-- fortrænge historikken.
create or replace function public.restore_participant_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_first timestamptz;
begin
  select h.first_joined_at into v_first
    from public.competition_participant_history h
   where h.competition_id = new.competition_id
     and h.user_id = new.user_id;

  if v_first is not null then
    new.joined_at := least(new.joined_at, v_first);
  end if;

  return new;
end;
$fn$;

-- `revoke … from public` FØR `grant`, og det er en REGEL og ikke en vane:
-- PostgreSQLs indbyggede default giver PUBLIC — og dermed `anon` — EXECUTE på
-- hver ny funktion (`G96`, `sql/anon_grants_functions.sql`). En trigger-funktion
-- kan ikke kaldes meningsfuldt fra SQL, men vagten i
-- `sql/tests/anon_grants_functions.sql` måler, at `anon` kan nøjagtig TO
-- funktioner i hele `public`, og den bliver rød ved den første, der glemmer
-- linjen. Rollerne herunder er de samme, som
-- `ensure_group_membership_for_participant()` har.
revoke all on function public.remember_participant_baseline() from public, anon;
revoke all on function public.restore_participant_baseline()  from public, anon;
grant execute on function public.remember_participant_baseline() to authenticated, service_role;
grant execute on function public.restore_participant_baseline()  to authenticated, service_role;

-- ============================================================================
-- 4. Triggerne
-- ============================================================================
-- `competition_participants` har i forvejen en BEFORE INSERT-trigger
-- (`competition_participants_ensure_group`). To BEFORE INSERT-triggere fyrer i
-- alfabetisk rækkefølge efter navn, og de to er uafhængige: den ene udfylder et
-- liga-medlemskab, den anden retter et felt på rækken selv.
drop trigger if exists competition_participants_remember_baseline on public.competition_participants;
create trigger competition_participants_remember_baseline
  after delete on public.competition_participants
  for each row
  execute function public.remember_participant_baseline();

drop trigger if exists competition_participants_restore_baseline on public.competition_participants;
create trigger competition_participants_restore_baseline
  before insert on public.competition_participants
  for each row
  execute function public.restore_participant_baseline();

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- ⚠️ Blokkene er KOMMENTERET UD, så hele filen kan pastes i ét stykke.
--
-- 1) Begge triggere sidder. Forvent to rækker.
-- select tgname, tgtype from pg_trigger
--  where tgrelid = 'public.competition_participants'::regclass
--    and tgname like '%_baseline';

-- 2) `anon` og `authenticated` kan ikke læse hukommelsen. Forvent to 'f'.
-- select has_table_privilege('anon', 'public.competition_participant_history', 'SELECT'),
--        has_table_privilege('authenticated', 'public.competition_participant_history', 'SELECT');

-- 3a) EFTERSLÆBET, BEVIST: deltagere, der bærer et FROSSENT spor fra før deres
--     eget nulpunkt — en kåring eller en historie i samme konkurrence, dateret
--     tidligere end `joined_at`. Frosne artefakter kan kun være opstået, mens
--     hun deltog, så rækken her er ikke en formodning: hun HAR været med før og
--     er kommet tilbage. Forvent 0; svarer den med noget, sættes
--     `first_joined_at` i hånden for netop dem.
-- select cp.competition_id, c.name as konkurrence, p.display_name as spiller, cp.joined_at,
--        count(*) filter (where a.user_id is not null) as kaaringer,
--        count(*) filter (where s.user_id is not null) as historier
--   from public.competition_participants cp
--   join public.competitions c on c.id = cp.competition_id
--   join public.profiles p on p.id = cp.user_id
--   left join public.competition_awards a
--     on a.competition_id = cp.competition_id and a.user_id = cp.user_id and a.awarded_at < cp.joined_at
--   left join public.stories s
--     on s.competition_id = cp.competition_id and s.user_id = cp.user_id and s.created_at < cp.joined_at
--  where a.user_id is not null or s.user_id is not null
--  group by cp.competition_id, c.name, p.display_name, cp.joined_at;

-- 3b) KANDIDATER, og læs svaret med det forbehold, 3a findes for: gæt, der
--     ikke tæller, fordi kampen låste før tilmeldingen. **Forvent IKKE 0 her.**
--     En helt almindelig sen tilmelding giver præcis dette billede, og det er
--     `A53`s hensigt og ikke en fejl. Forespørgslen er en bruttoliste at holde
--     3a op imod — den kan ikke i sig selv skelne "meldte sig sent" fra
--     "forlod og kom tilbage", og det er netop dét, hukommelsen fra i dag
--     gemmer for fremtiden.
-- select c.name as konkurrence, p.display_name as spiller, cp.joined_at,
--        count(*) as gaet_der_ikke_taeller, min(m.kickoff_at) as tidligste
--   from public.competition_participants cp
--   join public.competitions c on c.id = cp.competition_id
--   join public.profiles p on p.id = cp.user_id
--   join public.competition_matches cm on cm.competition_id = cp.competition_id
--   join public.matches m on m.id = cm.match_id
--   join public.predictions pr on pr.match_id = m.id and pr.user_id = cp.user_id
--  where pr.pred_home is not null and pr.pred_away is not null
--    and public.match_lock_at(m.kickoff_at, m.kickoff_tbd) <= cp.joined_at
--  group by c.name, p.display_name, cp.joined_at
--  order by 4 desc;

-- 4) Hukommelsen er tom lige efter kørslen (den fyldes først ved en
--    framelding). Forvent 0.
-- select count(*) from public.competition_participant_history;

-- ============================================================================
-- Tilbagerulning
-- ============================================================================
-- drop trigger if exists competition_participants_restore_baseline  on public.competition_participants;
-- drop trigger if exists competition_participants_remember_baseline on public.competition_participants;
-- drop function if exists public.restore_participant_baseline();
-- drop function if exists public.remember_participant_baseline();
-- drop table if exists public.competition_participant_history;

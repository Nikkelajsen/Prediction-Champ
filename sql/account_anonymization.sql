-- Prediction Champ — luk din egen konto ved ANONYMISERING (B4)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- ---------------------------------------------------------------------------
-- Hvorfor anonymisering og ikke sletning
--
-- En rigtig sletning af `auth.users` er i dette skema en fælde, og det er ikke
-- til at se på overfladen:
--
--   * `groups.created_by` er `on delete cascade`. En sletning ville altså tage
--     brugerens LIGAER med sig — og dermed alle de ANDRE medlemmers medlemskab.
--     Én person, der lukker sin konto, ville kunne opløse en ligas fællesskab.
--   * `competitions.created_by` har til gengæld slet ingen `on delete`-regel.
--     Sletningen ville derfor blive BLOKERET for enhver, der nogensinde har
--     oprettet en konkurrence — altså for de mest aktive brugere.
--
-- Anonymisering går uden om begge dele, fordi `profiles`-rækken bliver
-- stående. Det er ikke en billigere løsning end sletning; det er den, der ikke
-- ødelægger noget for andre.
--
-- ---------------------------------------------------------------------------
-- Hvad der ryddes, og hvad der bevares
--
--   TABEL                         HANDLING     HVORFOR
--   profiles                      pseudonym    rækken SKAL blive — hele
--                                              kaskaden hænger i den
--   push_subscriptions            slettes      endpoint er en enheds-id, og
--                                              beskeder skal stoppe
--   notification_log              slettes      ren leveringslog
--   stories                       slettes      personlige fortællinger, kan
--                                              nævne andre ved navn
--   analytics_events              slettes      adfærdslog knyttet til en person
--   user_activity_days            slettes      aktivitetsmønster = adfærd
--   feedback.user_id              → null       samme valg som tabellens egen
--                                              `on delete set null`; teksten er
--                                              stadig sand
--   predictions, ratings,         BEVARES      andres stillinger, ratinghistorik
--   rating_history,                            og kåringer er REGNET ud fra dem
--   competition_awards
--   competition_participants,     BEVARES      se nedenfor
--   group_members
--   groups, competitions          røres ikke   overlever, fordi profiles gør
--
-- MEDLEMSKABERNE KAN IKKE BEHANDLES HVER FOR SIG. `group_membership_invariant.sql`
-- håndhæver, at en konkurrence-deltager altid er ligamedlem; at slette
-- medlemskabet og beholde deltagelsen ville genskabe præcis den forældreløse
-- tilstand, invarianten findes for at forhindre. Enten begge eller ingen — og
-- valget er "ingen": en sletning ville omskrive vennernes historik, så en
-- afsluttet konkurrence pludselig havde haft én deltager færre, og en delt
-- sejr kunne blive udelt. Prisen er, at pseudonymet står tilbage i gamle
-- stillinger. Det er det ærlige billede, og politikken siger det med netop de
-- ord.
--
-- ---------------------------------------------------------------------------
-- Hvad funktionen IKKE gør
--
-- Den rører ikke `auth.users`. E-mailen ligger dér, uden for `public`, og en
-- almindelig RPC må ikke skrive i det skema. Den del gøres af
-- `api/delete-account.js` med service-nøglen, EFTER dette kald — rækkefølgen er
-- ikke til forhandling, fordi funktionen her har brug for en levende
-- `auth.uid()`.
--
-- Den kan ikke fortrydes. Navnet er overskrevet og rækkerne slettet; der er
-- intet at rulle tilbage til. Den er til gengæld IDEMPOTENT — samme navn, intet
-- nyt slettet — hvilket er dét, der gør et halvt fejlet forløb sikkert at prøve
-- igen.
-- ---------------------------------------------------------------------------

-- Markøren. Både idempotens-nøgle, statusflag for et forløb, der gik i stykker
-- undervejs, og det eneste sted, der kan svare på "hvornår efterkom vi
-- anmodningen".
alter table public.profiles add column if not exists anonymized_at timestamptz;

-- INGEN PARAMETER. Det er hele svaret på "kan den udføres for en anden bruger?"
-- — der findes ikke et argument at forfalske. En vagt, der sammenligner et
-- argument med auth.uid(), ville være svagere og skulle læses for at forstås.
create or replace function public.anonymize_my_account()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_navn  text;
  v_hex   int := 8;
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;

  -- Allerede lukket: gør ingenting, men svar det samme, så klienten kan
  -- gentage kaldet uden at skulle skelne.
  select display_name into v_navn from public.profiles where id = v_uid and anonymized_at is not null;
  if found then
    return v_navn;
  end if;

  -- Navnet er unikt på lower(display_name) (profiles_display_name_lower_idx) og
  -- skal være 2–20 tegn (profiles_display_name_len). "Slettet bruger" kan
  -- derfor kun bruges ÉN gang. Otte hex-tegn af brugerens eget id giver 16 tegn
  -- og er unikt — men "unikt nok" er ikke godt nok, når fejlen ville ramme
  -- netop den, der har bedt om at forsvinde, så der forlænges ved kollision.
  loop
    v_navn := 'Slettet ' || left(replace(v_uid::text, '-', ''), v_hex);
    exit when not exists (
      select 1 from public.profiles
      where lower(display_name) = lower(v_navn) and id <> v_uid
    );
    v_hex := v_hex + 2;
    if v_hex > 12 then
      raise exception 'kunne ikke danne et ledigt pseudonym';
    end if;
  end loop;

  delete from public.push_subscriptions where user_id = v_uid;
  delete from public.notification_log   where user_id = v_uid;
  delete from public.stories            where user_id = v_uid;
  delete from public.analytics_events   where user_id = v_uid;
  delete from public.user_activity_days where user_id = v_uid;

  update public.feedback set user_id = null where user_id = v_uid;

  update public.profiles
     set display_name  = v_navn,
         anonymized_at = now(),
         is_admin      = false,
         last_seen_at  = null
   where id = v_uid;

  return v_navn;
end $fn$;

-- `to authenticated` og ikke `to anon`: funktionen selvgater på auth.uid(), men
-- en anonym kalder har ingen grund til overhovedet at kunne nå den.
revoke all on function public.anonymize_my_account() from public, anon;
grant execute on function public.anonymize_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Verifikation efter kørsel
-- 1) Funktionen skal have NUL parametre — det er selve adgangsgarantien:
--      select p.proname, p.pronargs from pg_proc p
--       where p.proname = 'anonymize_my_account';   -- pronargs skal være 0
-- 2) Kolonnen findes, og ingen er lukket endnu:
select count(*) filter (where anonymized_at is not null) as lukkede_konti,
       count(*)                                          as konti_i_alt
from public.profiles;

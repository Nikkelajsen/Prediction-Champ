-- Skift af brugernavn (B29) — og den kolonne-rettelse, opgaven blotlagde.
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- Filen gør tre ting, og kun den første er den, rækken bad om:
--   1. `profiles.display_name_changed_at` + en trigger, der stempler den, og
--      som afviser at omdøbe en LUKKET konto.
--   2. Navnet trimmes ved både insert og update, så unikhedsindekset måler det,
--      brugeren faktisk ser.
--   3. 🔴 `authenticated` mister UPDATE på hele `profiles` og får den igen på
--      NETOP `id` og `display_name`. Uden det trin er et navneskift bygget oven
--      på en rettighed, der også rækker til `is_admin`.
--
-- ---------------------------------------------------------------------------
-- 🔴 HVORFOR TRIN 3 ER DET VIGTIGSTE I FILEN
--
-- `B29` skulle finde ud af, HVORDAN en bruger må skrive sit eget navn. Svaret lå
-- allerede i skemaet, og det var for bredt:
--
--     GRANT ALL ON TABLE public.profiles TO authenticated;
--     CREATE POLICY "update own profile" ON public.profiles
--       FOR UPDATE USING (auth.uid() = id);
--
-- Policyen afgrænser, hvilken RÆKKE man må skrive — ikke hvilke KOLONNER. En
-- policy kan ikke gøre det; kun kolonne-privilegier kan. Med `grant all` kunne
-- enhver indlogget bruger derfor sende
--
--     PATCH /rest/v1/profiles?id=eq.<sit eget id>   {"is_admin": true}
--
-- og blive administrator. Det er ikke en teoretisk svaghed: `is_admin` er den
-- ENE betingelse i admin-vagten i `admin_user_stats()`, `admin_feedback()`,
-- `admin_client_errors()`, `admin_job_health()` og `admin_anonymize_account()`
-- — altså brugerlisten, feedback, fejllog, drift og retten til at lukke andres
-- konti. Efterprøvet mod `sql/schema.sql` i en PostgreSQL 16 den 10. august
-- 2026: `update public.profiles set is_admin = true where id = auth.uid()`
-- svarede `UPDATE 1` som rollen `authenticated`.
--
-- Hullet er ældre end `B29` og har intet med brugernavne at gøre. Det står her
-- alligevel, fordi rækkefølgen ellers ville være forkert: en skærm, der skriver
-- `profiles` som `authenticated`, gør den brede rettighed til noget, produktet
-- BRUGER, og så er den sværere at tage tilbage. Retten skal være smal, FØR der
-- bygges oven på den.
--
-- **De to kolonner er ikke et skøn.** `display_name` er navneskiftet.
-- `id` skal med, fordi PostgREST's upsert (`Prefer: resolution=merge-duplicates`,
-- brugt af `sikrProfil()` og `App.jsx`) oversættes til
-- `insert … on conflict (id) do update set id = excluded.id, display_name = …`,
-- og PostgreSQL kræver UPDATE-privilegiet på hver kolonne i `set`-listen —
-- også når konflikt-grenen aldrig tages. Uden `id` fejler oprettelsen af en
-- profil med "permission denied for table profiles". Rettigheden er ufarlig:
-- policyens `auth.uid() = id` bruges også som WITH CHECK, så en flytning af
-- rækken til en anden bruger afvises af RLS (efterprøvet, påstand 8 i testen).
--
-- ---------------------------------------------------------------------------
-- HVAD DER IKKE SKER VED ET NAVNESKIFT, OG HVORFOR DET ER I ORDEN
--
-- Stillinger, ligaer og karriereprofilens tal joiner på `user_id` og følger
-- derfor med af sig selv. To steder gør ikke:
--
--   · `stories` gemmer navnet som TEKST i overskrift, brødtekst og payload.
--     Gamle historie-kort bliver ved med at sige det gamle navn. Det er en
--     historie skrevet en bestemt dag — at omskrive den bagud ville ændre, hvad
--     der stod, dengang den blev læst.
--   · Karriereprofilens rival-tæller joiner `stories.payload->>'rival'` på
--     `display_name` (`sql/career_profile.sql`), så tælleren nulstilles for en
--     rival, der skifter navn. Filen dér siger allerede, at det er en FARVE og
--     aldrig en rangering — netop derfor er prisen til at betale.
--
-- Begge dele er kendte og accepterede. Skal de laves om, er det historiernes
-- datamodel, der skal ændres, ikke navneskiftet.

-- ---------------------------------------------------------------------------
-- 1. Hvornår navnet sidst blev skiftet
--
-- Kolonnen er ikke pynt: uden den kan et navneskift hverken ses i Admin →
-- Brugere eller begrænses senere, hvis nogen skifter navn hver dag for at
-- forvirre en stilling. Den er bevidst et TIDSSTEMPEL og ikke en tæller — en
-- karantæne kan udledes af det ene, en tæller kan ikke.
--
-- Null betyder "har aldrig skiftet navn", altså også hver eneste eksisterende
-- række. Der backfilles derfor ikke: oprettelsestidspunktet ville være et
-- forkert svar på et andet spørgsmål.

alter table public.profiles add column if not exists display_name_changed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Triggeren: trim altid, stempl ved skift, og lås en lukket konto
--
-- **Trimningen er ikke kosmetik.** Unikhedsindekset står på `lower(display_name)`
-- og IKKE på `lower(btrim(display_name))`, mens `username_available()`
-- sammenligner med `lower(trim(name))`. Et gemt navn med et mellemrum til sidst
-- ville derfor svare "ledigt" på det trimmede navn og alligevel kunne indsættes
-- ved siden af det — to brugere, der ser ud til at hedde det samme, uden at
-- garantien var brudt nogen steder man kunne pege. Trimmes værdien ved
-- skrivningen, måler indekset det, brugeren ser. Længde-constrainten trimmer i
-- forvejen selv, så de tre regler er nu enige om, hvad navnet er.
--
-- **En lukket konto må ikke omdøbes.** Pseudonymet er det eneste, der binder
-- vennernes stillinger sammen bagud, og kontoen kan ikke logge ind — så et
-- navneskift dér kan kun komme fra en fejl eller fra admin-vejen. `old` og ikke
-- `new` afgør: selve anonymiseringen sætter `display_name` og `anonymized_at` i
-- samme sætning, hvor `old.anonymized_at` stadig er null, og den skal igennem.
--
-- **Stemplet sættes kun for en LEVENDE konto** — ellers ville hver anonymisering
-- se ud som et navneskift i Admin → Brugere.
--
-- Ikke SECURITY DEFINER: triggeren rører kun `new` og har intet at slå op.

create or replace function public.profiles_name_guard() returns trigger
  language plpgsql
  set search_path to 'public'
  as $$
begin
  new.display_name := btrim(new.display_name);

  if tg_op = 'UPDATE' and new.display_name is distinct from old.display_name then
    if old.anonymized_at is not null then
      raise exception 'En lukket konto kan ikke skifte brugernavn.'
        using errcode = '42501';
    end if;
    if new.anonymized_at is null then
      new.display_name_changed_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_name_guard on public.profiles;
create trigger profiles_name_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_name_guard();

-- ---------------------------------------------------------------------------
-- 3. 🔴 Kolonne-privilegier frem for GRANT ALL
--
-- Se den lange begrundelse i filens hoved. `revoke update` fjerner IKKE select,
-- insert eller delete — dem afgør policies fortsat, og de er uændrede.
--
-- `service_role` beholder alt: `api/delete-account.js` og de SECURITY
-- DEFINER-funktioner skriver `is_admin`, `last_seen_at` og `anonymized_at`, og
-- ingen af de veje går gennem `authenticated`.
--
-- ⚠️ **Adfærdsændring ved kørsel: ja.** Skulle en fremtidig skærm få brug for at
-- skrive en ny kolonne på `profiles` som den indloggede bruger, skal kolonnen
-- tilføjes HER. Fejlen er tydelig ("permission denied for table profiles") og
-- er hele pointen: en ny kolonne skal vælges ind, ikke arves.

revoke update on public.profiles from authenticated;
grant update (id, display_name) on public.profiles to authenticated;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Kolonnen og triggeren står der. Forvent to rækker.
-- select 'kolonne' as slags, column_name as navn
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'profiles'
--    and column_name = 'display_name_changed_at'
-- union all
-- select 'trigger', tgname from pg_trigger
--  where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_name_guard';

-- 2) 🔴 Rettigheden er smal. Forvent PRÆCIS to rækker: id og display_name.
-- select column_name from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'profiles'
--    and grantee = 'authenticated' and privilege_type = 'UPDATE'
--  order by column_name;

-- 3) Ingen har skiftet navn endnu. Forvent 0 lige efter kørslen.
-- select count(*) from public.profiles where display_name_changed_at is not null;

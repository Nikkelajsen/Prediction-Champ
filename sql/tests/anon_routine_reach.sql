-- Test af `sql/checks/anon_routine_reach.sql` (G100).
--
-- Kører mod en TOM engangsdatabase. Rører aldrig produktion.
--
-- HVORFOR DEN IKKE BRUGER PRODUKTIONSSKEMAET
-- Modsat `sql/tests/anon_grants_functions.sql`, som skal måle alle 54 rigtige
-- funktioner (`G91`), måler denne fil KONTROLLEN og ikke skemaet. Det, der skal
-- efterprøves, er, om viewet kan se sine fire tilstande — og tre af dem findes
-- pr. konstruktion ikke i produktionsskemaet, hvor `#56` er kørt. En fixture,
-- der bygger hver tilstand med to linjer, er derfor både hurtigere og skarpere:
-- den kan vise kontrollen en verden, produktionen forhåbentlig aldrig får.
--
-- HVAD DEN BEVISER
--   1. Et tomt `public` giver TO rækker og ikke nul. Viewet kan aldrig svare
--      tomt, og dét er den egenskab, den, der læser den, tør bygge på.
--   2. De to tilladte rutiner melder `ok`.
--   3. **Regressionen:** en funktion, hvis migrering glemte sin `revoke execute
--      … from public`, melder `AABEN FOR ANON` med `via_public`. Det er den
--      fejl, `G96`s regel kan begås på, og hele grunden til, at filen findes.
--   4. Den ANDEN vej ind skelnes: et eksplicit `grant … to anon` melder også
--      `AABEN FOR ANON`, men med `egen_grant` og uden `via_public`. To årsager,
--      to rettelser — en sammenlagt kolonne ville have gjort begge uleselige.
--   5. **`G100`s fund:** en PROCEDURE overlever `revoke execute on all functions
--      … from public` og bliver stående åben for `anon`. Kontrollen ser den;
--      `#56`s trin 2 og den eksisterende tests `prokind = 'f'` gør ikke.
--      Efterprøvet mod PostgreSQL 16.13.
--   6. Et AGGREGAT dækkes derimod af `all functions` — men er åbent, indtil det
--      revokeres, og kontrollen ser også det.
--   7. Den anden retning: en tilladt rutine, der er LUKKET for `anon`, melder
--      `LUKKET FOR ANON`. Det er trin 2 og trin 5 i `#56` byttet om — en
--      migrering, der er grøn, og en app, hvor ingen kan oprette en konto.
--   8. …og en, der slet ikke findes, melder `FINDES IKKE`. En sprunget
--      migrering og et for bredt `revoke` er ikke det samme problem.
--   9. Et andet SKEMA end `public` tælles ikke med. Reglen er om `public`, og en
--      kontrol, der også råbte om `auth` eller `extensions`, ville blive slukket.
--  10. Kontrollen måler `anon` og ikke adgang i almindelighed: en funktion, kun
--      `authenticated` kan nå, står ikke på listen.
--  11. Filen kan læses to gange i samme session (`create or replace`).
--  12. Svaret afhænger ikke af, hvem der spørger: en session UDEN `public` i sin
--      `search_path` får det samme. Uden den påstand er kontrollens
--      normalisering af signaturen utestet — se noten ved påstanden.
--
-- Testen findes af samme grund som kontrollen — og `G93` er præcedensen: en
-- kontrol udløser per definition næsten aldrig, så den ser lige rigtig ud, hvad
-- enten den virker eller ej. `G84`s lære var, at en test, man ikke har set
-- fejle, er en formodning; denne er efterprøvet ved at mutere kontrollen tolv
-- gange og se den fange hver enkelt. **Én af de tolv slap igennem den første
-- udgave** og gav filen påstand 12 — se noten dér.
--
-- KØR LOKALT
--   createdb g100
--   psql -d g100 -v ON_ERROR_STOP=1 -b -f sql/tests/anon_routine_reach.sql

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Rollerne. Supabase har dem; en tom database har dem ikke.
-- ---------------------------------------------------------------------------
-- `anon` ER kontrollens emne, og filen fejler højlydt uden den (se dens hoved).
-- `authenticated` findes kun for påstand 10.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Et tomt `public`: to rækker, begge `FINDES IKKE`
-- ---------------------------------------------------------------------------
-- Den vigtigste egenskab ved viewet står her: det kan ALDRIG svare tomt, så en
-- tom udlæsning betyder, at kontrollen selv er i stykker. Uden denne påstand
-- ville en kontrol, der intet returnerede, se grøn ud i hvert eneste led.
\ir ../checks/anon_routine_reach.sql

do $$
declare v_n int; v_findes_ikke int;
begin
  select count(*), count(*) filter (where tilstand = 'FINDES IKKE')
    into v_n, v_findes_ikke from anon_routine_reach;
  if v_n <> 2 or v_findes_ikke <> 2 then
    raise exception '1) tomt public: forventede 2 rækker, alle FINDES IKKE, fik % (% findes-ikke)',
      v_n, v_findes_ikke;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixture — én rutine pr. tilstand, kontrollen skal kunne skelne
-- ---------------------------------------------------------------------------
-- De to tilladte, skrevet som `#56`s trin 5 foreskriver: revoke FØR grant.
create function public.username_available(p_navn text) returns boolean
  language sql immutable as $$ select true $$;
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon;

create function public.invite_preview(p_kode text) returns text
  language sql immutable as $$ select 'liga' $$;
revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon;

-- Den lydige: reglen fulgt, altså lukket for `anon`.
create function public.g100_lukket() returns int language sql immutable as $$ select 1 $$;
revoke execute on function public.g100_lukket() from public;
grant execute on function public.g100_lukket() to authenticated;

-- **Den glemte** — reglens ene fejlmulighed. Ingen `revoke`, så PostgreSQLs
-- indbyggede default giver PUBLIC EXECUTE, og `anon` er en rolle.
create function public.g100_glemt() returns int language sql immutable as $$ select 1 $$;

-- Den bevidste: nogen har skrevet et eksplicit `grant … to anon`. Samme signal
-- som en tilbagerulning af `#56`s trin 3 (Supabases default privileges åbnet
-- igen), fordi begge giver `anon` sin EGEN post i ACL'en.
create function public.g100_eksplicit() returns int language sql immutable as $$ select 1 $$;
revoke execute on function public.g100_eksplicit() from public;
grant execute on function public.g100_eksplicit() to anon;

-- Kun for `authenticated` (påstand 10).
create function public.g100_kun_indlogget() returns int language sql immutable as $$ select 1 $$;
revoke execute on function public.g100_kun_indlogget() from public;
grant execute on function public.g100_kun_indlogget() to authenticated;

-- Et andet skema (påstand 9). Vidt åbent — og skal alligevel ikke tælles med.
create schema g100_andet;
create function g100_andet.helt_aaben() returns int language sql immutable as $$ select 1 $$;
grant usage on schema g100_andet to anon;

-- ---------------------------------------------------------------------------
-- 2–4, 9, 10. Hvad kontrollen ser
-- ---------------------------------------------------------------------------
do $$
declare r record; v_n int;
begin
  -- 2) de to tilladte er `ok`
  for r in select * from anon_routine_reach
            where rutine in ('username_available(text)', 'invite_preview(text)')
  loop
    if r.tilstand <> 'ok' then
      raise exception '2) %: forventede ok, fik %', r.rutine, r.tilstand;
    end if;
    if not r.egen_grant or r.via_public then
      raise exception '2) %: forventede egen grant og ingen PUBLIC, fik %/%',
        r.rutine, r.egen_grant, r.via_public;
    end if;
  end loop;

  -- 3) REGRESSIONEN: den glemte revoke
  select * into r from anon_routine_reach where rutine = 'g100_glemt()';
  if not found then
    raise exception '3) g100_glemt(): kontrollen så den ikke — reglens ene fejlmulighed er usynlig';
  end if;
  if r.tilstand <> 'AABEN FOR ANON' then
    raise exception '3) g100_glemt(): forventede AABEN FOR ANON, fik %', r.tilstand;
  end if;
  if not r.via_public or r.egen_grant then
    raise exception '3) g100_glemt(): forventede via_public og ingen egen grant, fik %/%',
      r.via_public, r.egen_grant;
  end if;
  if r.slags <> 'funktion' then
    raise exception '3) g100_glemt(): forkert slags (%)', r.slags;
  end if;

  -- 4) den anden vej ind — samme dom, anden forklaring
  select * into r from anon_routine_reach where rutine = 'g100_eksplicit()';
  if r.tilstand <> 'AABEN FOR ANON' then
    raise exception '4) g100_eksplicit(): forventede AABEN FOR ANON, fik %', r.tilstand;
  end if;
  if not r.egen_grant or r.via_public then
    raise exception '4) g100_eksplicit(): forventede egen grant og ingen PUBLIC, fik %/%',
      r.egen_grant, r.via_public;
  end if;

  -- 1 (fortsat)) den lydige står slet ikke på listen
  if exists (select 1 from anon_routine_reach where rutine = 'g100_lukket()') then
    raise exception 'g100_lukket(): en lukket funktion må ikke stå på listen';
  end if;

  -- 10) kontrollen måler `anon` og ikke adgang i almindelighed
  if exists (select 1 from anon_routine_reach where rutine = 'g100_kun_indlogget()') then
    raise exception '10) g100_kun_indlogget(): kontrollen måler authenticated og ikke anon';
  end if;

  -- 9) et andet skema tælles ikke med
  if exists (select 1 from anon_routine_reach where rutine like '%helt_aaben%') then
    raise exception '9) g100_andet.helt_aaben(): kontrollen rækker ud over public';
  end if;

  -- Samlet: præcis to røde og to `ok` netop nu.
  select count(*) into v_n from anon_routine_reach where tilstand = 'AABEN FOR ANON';
  if v_n <> 2 then
    raise exception 'forventede præcis 2 åbne rutiner, fik %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5–6. `G100`s fund: procedurer overlever `all functions`, aggregater gør ikke
-- ---------------------------------------------------------------------------
-- Efterprøvet mod PostgreSQL 16.13 under `G100`. Rækkefølgen i blokken ER
-- beviset: begge oprettes, `#56`s trin 2 køres ordret, og bagefter er kun den
-- ene lukket.
create procedure public.g100_procedure() language sql as $$ select 1 $$;
create aggregate public.g100_aggregat (int) (sfunc = int4pl, stype = int, initcond = '0');

do $$
declare r record;
begin
  select * into r from anon_routine_reach where rutine like 'g100_procedure%';
  if not found or r.tilstand <> 'AABEN FOR ANON' or r.slags <> 'procedure' then
    raise exception '5) g100_procedure(): forventede AABEN FOR ANON/procedure, fik %/%',
      coalesce(r.tilstand, '(ingen række)'), coalesce(r.slags, '-');
  end if;

  select * into r from anon_routine_reach where rutine like 'g100_aggregat%';
  if not found or r.tilstand <> 'AABEN FOR ANON' or r.slags <> 'aggregat' then
    raise exception '6) g100_aggregat(): forventede AABEN FOR ANON/aggregat, fik %/%',
      coalesce(r.tilstand, '(ingen række)'), coalesce(r.slags, '-');
  end if;
end $$;

-- `#56`s trin 2, ordret — BEGGE sætninger, fordi `anon` kommer ind ad to veje.
-- Den lukker aggregatet og lader proceduren stå.
revoke all on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

do $$
declare v_procedure int; v_aggregat int;
begin
  select count(*) into v_procedure from anon_routine_reach where rutine like 'g100_procedure%';
  select count(*) into v_aggregat  from anon_routine_reach where rutine like 'g100_aggregat%';

  -- 🟢 **Fejler denne linje, er det GODE nyheder.** Så dækker `all functions`
  --    også procedurer i den PostgreSQL, testen kører mod, og `G100`s fund
  --    gælder ikke længere: kontrollens `prokind`-afsnit skal skrives om, og
  --    hullet, den blev bredere for, findes ikke.
  if v_procedure <> 1 then
    raise exception '5) `revoke … on all functions` lukkede proceduren i denne PostgreSQL — se punkt 5 i testen, kontrollens hoved skal opdateres';
  end if;
  if v_aggregat <> 0 then
    raise exception '6) `revoke … on all functions` lukkede IKKE aggregatet — kontrollens hoved påstår, at den gør';
  end if;
end $$;

-- Bevis, at det ikke kun er PUBLIC-halvdelen, der springer proceduren over:
-- også `revoke all … from anon` gik forbi den. Uden denne linje kunne påstand 5
-- forklares med, at proceduren bare havde sin egen anon-grant i behold.
do $$
declare v record;
begin
  select egen_grant, via_public into v from anon_routine_reach where rutine like 'g100_procedure%';
  if v.egen_grant or not v.via_public then
    raise exception '5) proceduren står åben af en anden grund end PUBLIC (egen_grant=%, via_public=%)',
      v.egen_grant, v.via_public;
  end if;
end $$;

-- Ryd op, så de sidste påstande måler det, de handler om.
drop procedure public.g100_procedure();
drop aggregate public.g100_aggregat(int);

-- Trin 2 tog også de to tilladte med — præcis som i `#56`, hvor trin 5 giver dem
-- tilbage. Her bruges mellemtilstanden som fixture til påstand 7.
-- ---------------------------------------------------------------------------
-- 7. Den anden retning: en tilladt rutine, der er lukket
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  select * into r from anon_routine_reach where rutine = 'username_available(text)';
  if r.tilstand <> 'LUKKET FOR ANON' then
    raise exception '7) username_available(): forventede LUKKET FOR ANON efter trin 2, fik %', r.tilstand;
  end if;
  if r.slags <> 'funktion' then
    raise exception '7) username_available(): forventede at slags stadig kendes, fik %', r.slags;
  end if;
end $$;

-- `#56`s trin 5 giver dem tilbage.
grant execute on function public.username_available(text) to anon;
grant execute on function public.invite_preview(text) to anon;

do $$
declare v_n int;
begin
  select count(*) into v_n from anon_routine_reach where tilstand = 'ok';
  if v_n <> 2 then
    raise exception '7) efter trin 5: forventede 2 ok, fik %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Svaret må ikke afhænge af, HVEM der spørger
-- ---------------------------------------------------------------------------
-- `regprocedure::text` skriver `public.` foran, når `public` ikke står i
-- sessionens `search_path`, og udelader det, når det gør — altså to forskellige
-- tekster for den samme rutine. Kontrollen normaliserer derfor med et
-- `regexp_replace`, og UDEN denne påstand er den linje utestet: enhver almindelig
-- psql-session har `public` i sin sti, så mutationen ville være usynlig. En
-- session uden den ville se begge tilladte rutiner som `AABEN FOR ANON` — en
-- kontrol, der råber falsk, bliver slukket.
--
-- (Fundet ved at mutere kontrollen: det var den ene af tolv mutationer, første
-- udgave af testen ikke fangede. `G84`s lære, endnu en gang.)
do $$
declare v_ok int;
begin
  perform set_config('search_path', 'pg_catalog', true);
  select count(*) into v_ok from anon_routine_reach where tilstand = 'ok';
  perform set_config('search_path', '"$user", public', true);
  if v_ok <> 2 then
    raise exception '12) uden public i search_path meldte kontrollen % ok — signaturen normaliseres ikke', v_ok;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. `FINDES IKKE` — en migrering, ingen har kørt
-- ---------------------------------------------------------------------------
drop function public.invite_preview(text);

do $$
declare r record;
begin
  select * into r from anon_routine_reach where rutine = 'invite_preview(text)';
  if not found then
    raise exception '8) invite_preview(): rækken forsvandt med funktionen — den anden retning måles ikke';
  end if;
  if r.tilstand <> 'FINDES IKKE' then
    raise exception '8) invite_preview(): forventede FINDES IKKE, fik %', r.tilstand;
  end if;
  if r.slags <> '-' or r.egen_grant or r.via_public then
    raise exception '8) invite_preview(): en rutine, der ikke findes, kan ikke have en ACL (%/%/%)',
      r.slags, r.egen_grant, r.via_public;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Filen kan læses to gange i samme session
-- ---------------------------------------------------------------------------
-- Samme regel som for migreringerne (`DOCUMENTATION.md` §13): en fil, der siger,
-- at den kan gen-læses, skal have været læst to gange.
\ir ../checks/anon_routine_reach.sql

do $$
declare v_n int; v_ok int; v_findes_ikke int;
begin
  select count(*),
         count(*) filter (where tilstand = 'ok'),
         count(*) filter (where tilstand = 'FINDES IKKE')
    into v_n, v_ok, v_findes_ikke from anon_routine_reach;
  if v_n <> 2 or v_ok <> 1 or v_findes_ikke <> 1 then
    raise exception '11) anden læsning ændrede resultatet (% rækker: % ok, % findes-ikke)',
      v_n, v_ok, v_findes_ikke;
  end if;
end $$;

select 'anon_routine_reach: OK' as result;

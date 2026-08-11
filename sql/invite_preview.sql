-- Invitationens ETIKET må læses uden login (`I7`, `A41`).
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- ✅ **SIKKER AT KØRE NÅR SOM HELST, OGSÅ FØR FRONTEND-MERGEN.** Filen TILFØJER
-- kun én funktion og dens grants. Ingen policy røres, ingen rettighed smalnes,
-- ingen række ændres. Den nuværende klient kalder ikke funktionen og mærker
-- derfor intet.
--
-- ---------------------------------------------------------------------------
-- HVAD DER VAR GALT
--
-- `invite_lookup()` (#52) kræver `auth.uid()`. Det er rigtigt for et opslag, der
-- fører til en TILMELDING — men det betød også, at en helt ny bruger, der trykker
-- på et invitationslink, lander på en generisk login-skærm uden en antydning af,
-- hvorfor de er der. Modtageren skulle altså oprette en konto for at få at vide,
-- hvad de var inviteret til.
--
-- Det samme hul har en anden ende: en crawler (Messenger, WhatsApp, iMessage) er
-- pr. definition ikke logget ind, så et delt link kunne ikke vise andet end
-- appens generelle forside — uanset hvilken liga det pegede på.
--
-- ---------------------------------------------------------------------------
-- SNITTET: ETIKET vs. ADGANG
--
-- Der er nu to funktioner på den samme kode, og forskellen mellem dem er hele
-- pointen:
--
--   `invite_preview()`  — ETIKETTEN. Anonym. Svarer kun med et NAVN og et
--                         ANTAL. Kan ikke bruges til noget.
--   `invite_lookup()`   — OPSLAGET. Kræver login. Svarer med id'er, `already`
--                         og alt det, en bekræftelses-dialog skal bruge.
--   `accept_invite()`   — ADGANGEN. Kræver login OG koden.
--
-- Denne fil rører kun den første. De to andre står uændret.
--
-- ---------------------------------------------------------------------------
-- ⚠️ SPÆNDINGEN MOD `A40` — LÆST OG ACCEPTERET, IKKE OVERSET
--
-- `A40` (10. august 2026) gjorde invitationskoden til hemmeligheden igen, efter
-- at enhver indlogget bruger kunne høste hver eneste kode i appen. Filen her
-- åbner en sprække i den mur med vilje, og den skal kunne forsvares:
--
-- 1. **Hvad der udleveres, er en etiket til en kode, man allerede har.** Et navn
--    og et tal. Ingen id'er, ingen `invite_code` retur, ingen medlemsliste,
--    intet opretternavn. Og frem for alt: ingen ADGANG. `accept_invite()` er
--    stadig kun for `authenticated` og kræver stadig koden. `A40`s hul var, at
--    et ID var nok til at melde sig ind; det er ikke dét, der åbnes her.
--
-- 2. **Regnestykket, sagt højt frem for viftet væk.** `groups.invite_code` er
--    `substr(md5(...), 1, 8)` — 8 hextegn, altså 16^8 ≈ 4,3 mia. muligheder. Med
--    nogle hundrede levende koder skal der i størrelsesordenen millioner af
--    HTTPS-kald til for at ramme én, og præmien er et liganavn. Begge kolonner
--    er `unique`, så et gæt er et indeksopslag og ikke en scanning — endpointet
--    er altså heller ikke en billig måde at belaste databasen på.
--
-- 3. **Træf og forbier ligner hinanden**: ét indeksopslag, ét `{"kind": ...}`,
--    samme svartid. Der er ikke et orakel her ud over det, der er meningen.
--
-- 4. **Hvad `anon` nu må.** `G50`/`G58` satte reglen "`anon` har brug for:
--    ingenting" og efterlod præcis ÉN undtagelse, `username_available()` — som
--    selv er et eksistens-orakel, og som blev holdt med vilje, fordi oprettelsen
--    ikke kan undvære den. Dette er den anden. Det tal skal blive ved med at
--    være lille nok til at kunne stå i en sætning; se `sql/README.md`.
--
-- 5. **Tilbagevejen er designet ind nu.** Viser der sig misbrug, fjernes
--    `grant ... to anon`, og begge aftagere (login-skærmen og
--    `api/invite-preview.js`) føres gennem serverfunktionen, hvor en
--    hastighedsgrænse kan bo. Det koster én linje her og én funktionskrop i
--    `src/lib/data/invites.js` — hvilket er præcis derfor klientens kald ligger
--    samlet ét sted.
--
-- 6. **Ikke foreslået: en længere kode.** Koden tastes i hånden ("Har du en
--    kode?", `LigaerTab.jsx`), så dens længde er et brugsvalg og ikke en
--    sikkerhedsknap — og 8 hextegn koster i forvejen mere, end præmien er værd.

-- ---------------------------------------------------------------------------
-- Etiketten
--
-- INGEN `auth.uid()`-vagt. Det er hele formålet, og fraværet er derfor det, der
-- skal springe i øjnene ved en gennemlæsning — ikke noget, der ser ud som en
-- forglemmelse.
--
-- Koden matches EKSAKT, ligesom `invite_lookup()` (samme `btrim`, intet
-- `lower()`). De to funktioner skal svare ens på den samme streng; gjorde den
-- ene mere for at være venlig, ville en kode kunne have et preview uden at have
-- et opslag.
--
-- Rækkefølgen liga → konkurrence er også den samme som `invite_lookup()`s. Den
-- er vilkårlig, men den skal være FAST: koderne er fra to forskellige rum, og en
-- kode, der tilfældigvis fandtes begge steder, skal give det samme svar hver
-- gang, uanset hvilken funktion der spørger.
create or replace function public.invite_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_code  text := btrim(coalesce(p_code, ''));
  v_group public.groups%rowtype;
  v_comp  public.competitions%rowtype;
begin
  -- Længdegrænsen er ikke en validering af formatet, men et loft: funktionen er
  -- åben for enhver, og en megabyte-lang parameter skal afvises før opslaget.
  if v_code = '' or length(v_code) > 64 then
    return jsonb_build_object('kind', 'none');
  end if;

  select * into v_group from public.groups where invite_code = v_code;
  if found then
    return jsonb_build_object(
      'kind', 'group',
      'name', v_group.name,
      'member_count', (select count(*) from public.group_members
                        where group_id = v_group.id));
  end if;

  select * into v_comp from public.competitions where invite_code = v_code;
  if not found then
    return jsonb_build_object('kind', 'none');
  end if;

  -- Ligaens navn er med, fordi en konkurrence-invitation også melder ind i
  -- ligaen (`A8`) — modtageren skal kunne se begge dele, de siger ja til.
  -- Er konkurrencen ligaløs, er feltet `null`, og skærmen udelader linjen.
  return jsonb_build_object(
    'kind', 'competition',
    'name', v_comp.name,
    'group_name', (select name from public.groups where id = v_comp.group_id),
    'member_count', (select count(*) from public.competition_participants
                      where competition_id = v_comp.id));
end;
$$;

revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated, service_role;

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- ⚠️ Blokkene herunder er KOMMENTERET UD, så hele filen kan pastes i ét stykke.
-- Skal de køres, fjernes `--` først — ellers udføres der ingenting, og editoren
-- svarer "Success. No rows returned", hvilket ligner et svar.
--
-- 1) Funktionen findes og er security definer. Forvent én række, 't'.
-- select proname, prosecdef from pg_proc
--  where pronamespace = 'public'::regnamespace and proname = 'invite_preview';

-- 2) `anon` må køre den — og må stadig IKKE køre de to andre.
--    Forvent: true, false, false.
-- select has_function_privilege('anon', 'public.invite_preview(text)', 'execute'),
--        has_function_privilege('anon', 'public.invite_lookup(text)', 'execute'),
--        has_function_privilege('anon', 'public.accept_invite(text)', 'execute');

-- 3) Svaret bærer kun det, det må. Indsæt en rigtig kode fra din egen liga;
--    forvent præcis nøglerne kind, name, member_count — og hverken `id`,
--    `invite_code` eller `created_by`.
-- select jsonb_object_keys(public.invite_preview('<kode>'));

-- 4) En ukendt kode afslører ingenting. Forvent {"kind": "none"}.
-- select public.invite_preview('detherfindesikke');

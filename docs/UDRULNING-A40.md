# Udrulning af `A40` — invitationskoden bliver hemmeligheden igen

Runbog for de to migreringer, der lukker `A40`. **Læs registeret først, ikke
filen forfra:** hvis kørslen er begyndt, står tilstanden nedenfor, og du skal
fortsætte derfra.

## Register — hvor står vi?

| Trin | Hvad | Tilstand |
|---|---|---|
| 1 | `sql/invite_lookup.sql` (#52) kørt i **staging** | ✅ 11. august 2026 |
| 2 | Preview afprøvet mod staging: invitation kan tages imod | ✅ |
| 3 | `sql/invite_policies.sql` (#53) kørt i **staging** | ✅ |
| 4 | Preview afprøvet igen — begge invitationstyper | ✅ |
| 5 | `sql/invite_lookup.sql` (#52) kørt i **produktion** | ✅ 11. august 2026 |
| 6 | PR merget, Vercel-deploy færdig | ✅ 11. august 2026 |
| 7 | Produktionen afprøvet: invitation kan tages imod | ✅ |
| 8 | `sql/invite_policies.sql` (#53) kørt i **produktion** | ✅ 11. august 2026 |
| 9 | Produktionen afprøvet igen, og hullet efterprøvet lukket | ⬜ |

✅ **Tilstand pr. 11. august 2026: begge migreringer er kørt i produktion.**
Hullet er lukket. Det, der mangler, er trin 9 — efterprøvningen.

**Under afprøvningen i staging dukkede en fejl op, der IKKE var `A40`:** Hjem og
Tip kunne ikke hente kampe med "Alle konkurrencer" valgt. Årsagen var URL-længde
(778 kamp-id'er ≈ 29 KB), ikke rettighederne — se `DOCUMENTATION.md` §13. Den er
rettet i samme PR med `selectIn()`, så den følger med deployet i trin 6.

Sæt ✅ efterhånden. Bliver du afbrudt, er registeret det eneste, der fortæller,
hvor du var.

---

## Hvorfor to trin og ikke ét

Den første udgave af migreringen var én fil med instruksen *"kør sammen med
frontend-mergen"*. **Den instruks kan ikke følges.** Supabase betjenes i hånden,
Vercel deployer af sig selv, og de to kan ikke ramme det samme sekund. Uanset
hvilken rækkefølge man så valgte, var der et vindue, hvor invitationer ikke
virkede:

- **SQL først:** den gamle klient slår ligaen op med `groups?invite_code=eq.…`,
  og det opslag er tomt fra det sekund, policyen smalnes. Ingen kan tage imod en
  invitation, før deployet er færdigt.
- **Frontend først:** den nye klient kalder `invite_lookup()`, som ikke findes
  endnu. Samme symptom, anden årsag.

Delt i to har **hvert trin en tilstand, hvor det, der er i produktion, virker**:

| Efter | Gammel klient | Ny klient | Hullet |
|---|---|---|---|
| #52 | virker | virker | åbent |
| deploy | — | virker | åbent |
| #53 | (væk) | virker | **lukket** |

Rækkefølgen er dermed et **krav**, ikke et sammentræf — og et krav kan et
menneske følge.

**Vinduet mellem #52 og #53 er ikke gratis:** hullet står åbent imens. Men det
har stået åbent, siden liga-laget blev bygget, og en time mere er en anden pris
end en invitation, ingen kan tage imod. Har du travlt, kan trin 5–8 køres i ét
stræk på et kvarter.

Mellemtilstanden er ikke et løfte i denne tekst — den er målt. `sql/tests/invite_lookup.sql`
har tre påstande (a–c) om præcis den: at #52 ikke rører en eneste policy, at den
gamle klients opslag stadig virker, og at den nye klients kald allerede gør.

---

## Trin for trin

### Prøv det af i staging først (trin 1–4)

Staging findes (`B18`), og preview peger på sit eget Supabase-projekt
([`STAGING.md`](./STAGING.md)). Kør hele sekvensen dér først. Det koster tyve
minutter og er den eneste måde at se join-flowet virke, før rigtige brugere gør.

1. Åbn **staging-projektets** SQL-editor → "Run without RLS" → indsæt hele
   `sql/invite_lookup.sql` → kør.
2. Åbn preview-deployet af denne PR. Lav en liga med én konto, kopiér
   invitationslinket, åbn det med en anden konto. Bekræftelsen skal komme med
   ligaens navn, og tilmeldingen skal virke.
3. Kør `sql/invite_policies.sql` samme sted.
4. Gentag trin 2 — **og gør det med begge slags links**: `?liga=` (liga-kode) og
   `?join=` (konkurrence-kode). Den anden er den, der melder ind i to ting på én
   gang, og det er den, der kan gå galt i stilhed.

### Produktion (trin 5–9)

5. **Kør `sql/invite_lookup.sql` i produktionens SQL-editor.** Der sker
   ingenting for brugerne: filen tilføjer tre funktioner og rører ingen policy.
   Efterprøv med verifikationsblok 1 og 2 nederst i filen — forvent tre
   funktioner og **fire** gamle policies stadig på plads. **Husk at fjerne `--`**;
   blokkene står som kommentarer, så filen kan pastes i ét stykke.
6. **Merge PR'en.** Vent til Vercels deploy er færdig og produktionen kører den
   nye kode. (Tjek versionen nederst i appen, hvis du er i tvivl — den bærer
   commit-SHA'en.)
7. **Prøv en invitation i produktionen.** Den nye klient kalder nu funktionerne
   fra trin 5, mens policyerne stadig er brede. Virker det ikke her, skal du
   **ikke** køre trin 8 — så er det klienten, der er galt på den, og hullet er
   det mindste problem.
8. **Kør `sql/invite_policies.sql`.** Hullet er lukket i det sekund, kørslen er
   færdig.
9. **Prøv igen — og efterprøv hullet.** Én invitation af hver slags, og
   forespørgslen nedenfor.

   ⚠️ **Verifikationsblokkene NEDERST I MIGRERINGSFILERNE er kommenteret ud**
   med `--`, så hele filen kan pastes i ét stykke. Kopierer du dem derfra, skal
   `--` væk først — ellers kører der ingenting, og editoren svarer *"Success. No
   rows returned"*, som ligner et foruroligende svar på et spørgsmål, der aldrig
   blev stillet. Det skete 11. august 2026. Brug derfor denne, som er kørbar
   som den er, og som samler alle fire tjek i ét svar:

   ```sql
   select 'nye policies (forvent 4)' as tjek, count(*)::text as svar
     from pg_policies
    where schemaname = 'public'
      and policyname in ('groups_select_member', 'competitions_select_involved',
                         'group_members_insert_creator', 'competition_participants_insert_involved')
   union all
   select 'gamle policies (forvent 0)', count(*)::text
     from pg_policies
    where schemaname = 'public'
      and policyname in ('groups_select_all', 'read all competitions',
                         'group_members_insert_self', 'join competition')
   union all
   select 'funktioner (forvent 3)', count(*)::text
     from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('invite_lookup', 'accept_invite', 'is_group_creator')
   union all
   select 'ligaer uden medlemmer (forvent 0)', count(*)::text
     from public.groups g
    where not exists (select 1 from public.group_members m where m.group_id = g.id);
   ```

   **4 / 0 / 3 / 0.** Den sidste er ikke en fejl, hvis den er over nul — en liga
   uden medlemmer er en kendt og tilladt tilstand efter en kontolukning
   (`A36`) — men den skal ses her frem for at blive opdaget senere.

---

## Hvis noget går galt

**Symptom: "Kunne ikke tilmelde dig ligaen lige nu", eller bekræftelsen kommer
aldrig.**

Er det sket efter trin 8, er tilbagerulningen fire `create policy`, og de står
nederst i `sql/invite_policies.sql`. Kør dem. Hullet er så åbent igen, præcis
som det har været hele tiden — **det er den rigtige pris** for at få join-flowet
tilbage med det samme. Meld tilbage, så finder vi fejlen med staging i hånden
frem for med brugerne.

Er det sket mellem trin 6 og 8, er policyerne stadig brede, og fejlen er i
klienten. Rul deployet tilbage i Vercel; #52 kan blive stående, den gør ingen
skade.

**Symptom: `42883: function public.is_group_creator(uuid) does not exist`** ved
kørsel af #53. Så er #52 ikke kørt i det projekt, du står i. Kør den først.

**Symptom: en verifikation svarer "Success. No rows returned", hvor du ventede
rækker.** Se efter, om linjerne begynder med `--`. Verifikationsblokkene i
migreringsfilerne er kommenteret ud, så filen kan pastes hel — kopieres de
derfra, kører der ingenting, og editoren melder succes på en tom kørsel. Brug
den kørbare udgave i trin 9.

**Symptom: en liga er "forsvundet" for et medlem.** Det skal ikke kunne ske —
policyen er `is_group_member(id)` — men hvis det gør, så kør verifikationsblok 3
i #53: den finder ligaer uden medlemmer. En liga uden medlemmer er en kendt og
tilladt tilstand efter en kontolukning (`A36`), ikke en fejl fra denne
migrering.

---

## Hvad ændrer sig for brugerne

**Ingenting synligt.** Invitationslinks ser ens ud, bekræftelsen siger det
samme, og tilmeldingen virker som før. Det eneste, der er væk, er noget, ingen
bruger nogensinde så: at enhver indlogget kunne læse hver liga i appen — navn,
opretter og invitationskode — og melde sig ind i den uden en invitation.

Ét sted er adfærden ægte ændret, og det er værd at kende: **en liga, du har
forladt, kan du ikke længere se.** Før kunne du læse hver liga, også dem du ikke
var med i; nu kræver læsning et medlemskab. Det er den tilsigtede regel og ikke
en bivirkning.

-- Kontrol: har hver liga stadig en administrator, der kan logge ind? (A37)
--
-- HVORFOR DEN FINDES
-- Fundet 7. august 2026 ved prøvekørslen af kontolukningen (`G76`). Tre ting,
-- der hver især er rigtige og dokumenterede, ganger op til én, der ikke er:
--
--   1. Admin-rollen uddeles kun ÉN gang — af opretteren til sig selv, ved
--      oprettelsen. `group_members_insert_self` tillader `role = 'admin'`, kun
--      når `groups.created_by = auth.uid()`.
--   2. Der findes ingen UPDATE-policy på `group_members`, altså ingen
--      forfremmelse. Medlems-administration er bevidst uden for v1
--      (`docs/features/liga-laget-v1.md`).
--   3. En lukket konto kan aldrig logge ind igen: `api/delete-account.js`
--      soft-sletter rækken i `auth.users`.
--
-- Følgen er, at `is_group_admin()` aldrig kan blive sand for den liga igen.
-- Ligaen kan derefter hverken omdøbes, slettes, få fjernet en deltager eller få
-- slettet en konkurrence. Nogensinde. Den eneste vej ud er manuel SQL.
--
-- **Det er ikke et hjørnetilfælde.** Hver liga har præcis én administrator,
-- nemlig sin opretter, så det er enhver opretter, der lukker sin konto.
--
-- HVAD DEN PÅSTÅR
-- Hver liga har mindst én administrator, hvis konto ikke er lukket. Nul er ikke
-- en grad af noget — det er en tilstand, der ikke kan komme sig selv, og derfor
-- er der ingen tærskel at kalibrere her (modsat `kickoff_coverage`, hvor
-- 100 %-reglen var selve beslutningen).
--
-- HVORFOR OGSÅ `lukkede` OG `opretter_lukket`
-- De to kolonner dømmer ikke, de forklarer. `A36` — om en lukket konto også
-- skal forlade ligaen — er stadig åben, og svaret på den ændrer, hvad man ser i
-- `lukkede`. Kolonnerne gør, at den samme kørsel kan besvare begge spørgsmål,
-- og det var hele grunden til, at de to blev holdt sammen i backloggen.
--
-- HVORFOR `left join` OG IKKE `join`
-- En liga uden ét eneste medlem har heller ingen levende admin, og den er endnu
-- mere forældreløs end den, kontrollen blev skrevet for. Et indre join ville
-- skjule præcis det værste tilfælde.
--
-- HVORFOR EN TEMPORÆR VIEW OG IKKE EN MIGRERING
-- Samme begrundelse som `kickoff_coverage.sql`: der installeres INTET i
-- produktionen — viewet lever kun i den psql-session, der lige har læst filen —
-- og den samme forespørgsel kan derfor køres både mod produktion og mod en tom
-- engangsdatabase i CI (`sql/tests/league_admin_coverage.sql`). En kontrol, der
-- er skrevet ét sted og testet et andet, er to kontroller.
--
-- ---------------------------------------------------------------------------
-- SÅDAN KØRES DEN — TO VEJE, OG DE ER IKKE OMBYTTELIGE
--
-- **Vej A — Supabase SQL-editoren.** Indsæt HELE denne fil og tilføj en linje
-- til sidst:
--
--   select * from league_admin_coverage order by levende_admins, liga;
--
-- Begge sætninger skal sendes i SAMME kørsel, fordi en temporær view kun lever
-- i sin egen session. Kører du dem hver for sig, findes viewet ikke i anden
-- kørsel. Vil du hellere undgå det helt, så indsæt bare `select`-sætningen
-- nederst i filen direkte — den står alene og kræver ingen view.
--
-- 🛑 **Editoren kan kun tage imod SQL.** `psql …` nedenfor er en
-- TERMINAL-kommando; indsat i editoren giver den
-- `42601: syntax error at or near "psql"`. Det er ikke en fejl i filen.
--
-- **Vej B — psql fra en terminal.** Kræver en session-forbindelse (port 5432),
-- som `SUPABASE_DB_URL` har:
--
--   psql "$SUPABASE_DB_URL" -q -At -F'|' \
--     -f sql/checks/league_admin_coverage.sql \
--     -c 'select liga, medlemmer, lukkede, levende_admins, tilstand
--           from league_admin_coverage order by levende_admins, liga'
--
-- Det er vej B, en workflow ville bruge; vej A er den, et menneske bruger.

-- `or replace`, så filen kan læses to gange i samme session uden at fejle.
create or replace temporary view league_admin_coverage as
select
  g.name                                                              as liga,
  count(gm.user_id)::int                                              as medlemmer,
  count(*) filter (where p.anonymized_at is not null)::int            as lukkede,
  count(*) filter (where gm.role = 'admin'
                     and p.anonymized_at is null)::int                as levende_admins,
  -- Forklarer HVORFOR, når tilstanden er rød: er opretteren lukket, er ligaen
  -- frossen af den grund og ikke af en senere hændelse.
  coalesce((select op.anonymized_at is not null
              from public.profiles op where op.id = g.created_by), false) as opretter_lukket,
  case
    when count(*) filter (where gm.role = 'admin'
                            and p.anonymized_at is null) = 0
      then 'INGEN LEVENDE ADMIN'
    else 'ok'
  end                                                                 as tilstand
from public.groups g
left join public.group_members gm on gm.group_id = g.id
left join public.profiles p       on p.id = gm.user_id
group by g.id, g.name, g.created_by;

-- Oprydning i efterladte databaseobjekter.
--
-- Kun objekter, hvor der er ført bevis for, at INTET bruger dem: hverken
-- app-koden (src/, api/), de øvrige migreringer i sql/, eller skemaet selv
-- (views, policies, triggere, genererede kolonner). Bevisbyrden ligger her i
-- filen ud for hvert objekt.
--
-- Verificeret mod sql/schema.sql fra eksporten 30. juli 2026 — altså et
-- øjebliksbillede, der matcher produktionen. Den rækkefølge er ikke tilfældig:
-- man kan ikke lede efter forældreløse objekter i et skema, der er bagud.
--
-- Idempotent — kan køres igen når som helst.

-- ---------- 1. trg_recompute_ratings() ----------
-- Efterladt fra den gamle row-level trigger. sql/rating_trigger_optimization.sql
-- droppede den trigger (`matches_recompute_ratings`), der pegede på funktionen,
-- og erstattede den med tre statement-level triggere, som alle kalder
-- recompute_ratings_if_scores_changed() i stedet.
--
-- Bevis: funktionen optræder 6 gange i schema.sql — alle er dens egen definition
-- plus grants. Ingen CREATE TRIGGER nævner den, og der er nul referencer i src/,
-- api/ og de øvrige sql-filer. DOCUMENTATION.md afsnit 2 kalder den allerede
-- "Efterladt legacy … kan ryddes op".
drop function if exists public.trg_recompute_ratings();

-- ---------- 2. leagues.country ----------
-- Bevis: `grep country sql/schema.sql` giver ét hit — selve kolonne-definitionen.
-- Nul referencer i src/, api/ og øvrige sql-filer. Ingen view, policy eller
-- constraint rører den. DOCUMENTATION.md afsnit 2 lister den blandt "kolonner,
-- der ikke er nævnt i tabellen ovenfor, men findes".
alter table public.leagues drop column if exists country;

-- ---------- 3. seasons.end_date ----------
-- Bevis: samme som ovenfor — ét hit i schema.sql, som er definitionen.
-- (Det ene hit på "end_date" i src/lib/data.js er en parameter til
-- time_range-konkurrencer og har intet med denne kolonne at gøre.)
-- Bemærk at seasons.start_date BLIVER brugt (sortering i sync-matches) og
-- derfor ikke røres.
alter table public.seasons drop column if exists end_date;

-- ---------- IKKE fjernet: matches.status ----------
-- Kolonnen skrives 6 steder (5 i api/sync-live.js, 1 i src/screens/AdminScreen.jsx)
-- og læses 0 steder. Den ser dermed ud som en oplagt kandidat, og den er
-- bevidst ladt stå alligevel:
--
--   * Adfærden er DOKUMENTERET i DOCUMENTATION.md afsnit 8 ("skrives det
--     endelige resultat (home_score/away_score, status='finished')"), altså
--     ikke bare et tilfældigt levn.
--   * De fleste af skrivningerne er `status: m.status` — de bevarer den
--     eksisterende værdi under en upsert, hvor alle kolonner skal med. At
--     fjerne kolonnen betyder derfor at røre selve live-syncens skrive-sti,
--     som er den mest kritiske kode i projektet.
--   * Gevinsten er én ubrugt kolonne. Prisen er en irreversibel ændring i den
--     sti, der færdigmelder kampe og udløser ratingberegningen.
--
-- Skal den væk, er den rigtige rækkefølge: stop skrivningerne først, lad en
-- hel runde køre igennem grønt, og drop så kolonnen bagefter. Det er en
-- selvstændig ændring, ikke et vedhæng til en oprydning.

-- ---------- IKKE fjernet: ratings.scope / rating_history.scope ----------
-- Kun værdien 'ALL' bruges, men det er en bevidst forberedelse til per-liga-
-- rating uden skemaændring (DOCUMENTATION.md afsnit 5). Ikke gæld.

-- ---------- IKKE fjernet: rating_history.round_score/matches_predicted/rnk ----------
-- Skrives af recompute_ratings(), men klienten henter kun user_id/round_key/delta.
-- Det er dødt indhold, ikke døde kolonner: de koster ingenting, og
-- `rounds_played` skal alligevel tilføjes til samme tabel, hvis ratingen
-- senere gøres inkrementel. Lad dem stå til den ombæring.

-- ---------- IKKE fjernet: is_group_admin(), pc_points(), round_key(), ensure_group_membership_for_participant() ----------
-- Alle fire har nul hits i src/ og api/ og ligner derfor forældreløse ved en
-- overfladisk søgning. De er det ikke:
--   is_group_admin()   — brugt af RLS-policies groups_update_admin og
--                        groups_delete_admin_empty
--   pc_points()        — brugt af recompute_ratings, alle tre stillings-views,
--                        generate_stories() og career_profile()
--   round_key()        — ligger bag den genererede kolonne matches.round_key
--   ensure_group_...() — bundet til triggeren competition_participants_ensure_group
-- Skrevet ned her, så næste oprydning ikke skal opdage det forfra.

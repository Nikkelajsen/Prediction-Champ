-- OPRYDNING efter to fejl i milepæls-kataloget (v1.1, august 2026).
-- Engangskørsel. Kør EFTER en gen-kørsel af sql/milestones.sql.
--
-- ---------------------------------------------------------------------------
-- Hvorfor der slettes i en tabel, hvis hele princip er, at der ikke slettes
--
-- `milestones` er frossen med vilje: en uddelt milepæl trækkes ALDRIG tilbage,
-- heller ikke hvis en resultatrettelse sænker en peak-rating under den tærskel,
-- der udløste den. Det princip beskytter mod, at en **datakorrektion** kan tage
-- noget fra en bruger, de har opnået.
--
-- Det er noget andet end en **fejl i reglen**. De rækker, der slettes her, blev
-- aldrig opnået — de blev skrevet af en regel, der påstod noget, som ikke kunne
-- være sket. At beholde dem ville ikke være at holde et løfte, det ville være at
-- lade en fejl stå.
--
-- ---------------------------------------------------------------------------
-- De to fejl
--
-- 1. `COMP_COMEBACK` uddeltes i konkurrencer med ÉN runde. Definitionen er
--    "vandt uden at have ligget nr. 1 før sidste runde" — med kun én runde
--    findes der ingen tidligere runde, mængden af tidligere førere er tom, og
--    `not exists` var derfor sandt for enhver vinder. Reglen manglede desuden
--    helt den deltagergrænse, alle de øvrige konkurrence-milepæle har: man kan
--    ikke komme bagfra mod ingen. Nu kræves ≥3 runder og ≥3 deltagere.
--
-- 2. `SEASONS_2/3` talte rækker i `seasons` frem for fodboldsæsoner. Tabellen
--    har én række pr. TURNERING pr. år, så en bruger, der tippede Superliga og
--    Premier League i den samme sæson, fik "To sæsoner med" efter en uge.
--    Sæsonåret udledes nu af kampens danske kickoff (juli→juni).
--
-- Rækkerne slettes og uddeles forfra. Alt, der stadig er berettiget, kommer
-- tilbage i samme kørsel; resten forsvinder.
--
-- Svaret kommer som TABELLER (Supabases editor viser ikke `raise notice`).

-- ---------- 1. Hvad findes lige nu? Kør, og gem tallet ----------
select 'FØR' as naar, key, count(*) as antal
from public.milestones
where key in ('COMP_COMEBACK', 'SEASONS_2', 'SEASONS_3')
group by key
order by key;

-- ---------- 2. Slet og uddel forfra ----------
delete from public.milestones
where key in ('COMP_COMEBACK', 'SEASONS_2', 'SEASONS_3');

select public.award_milestones(null) as nye_milepaele_uddelt;

-- ---------- 3. Hvad står der nu? ----------
-- Forventning: færre rækker end i trin 1 — og de tilbageværende er dem, der
-- faktisk holder mod de nye grænser.
select 'EFTER' as naar, key, count(*) as antal
from public.milestones
where key in ('COMP_COMEBACK', 'SEASONS_2', 'SEASONS_3')
group by key
order by key;

-- ---------- 4. Kontrol: kan et comeback stadig forklares? ----------
-- Hver tilbageværende comeback skal pege på en konkurrence med mindst tre
-- runder og mindst tre deltagere. Forvent NUL rækker.
select m.user_id, m.competition_id, c.name,
       (select count(*) from public.competition_participants cp
         where cp.competition_id = m.competition_id) as deltagere,
       (select count(distinct round_key) from public.competition_match_points p
         where p.competition_id = m.competition_id) as runder
from public.milestones m
join public.competitions c on c.id = m.competition_id
where m.key = 'COMP_COMEBACK'
  and ((select count(*) from public.competition_participants cp
         where cp.competition_id = m.competition_id) < 3
    or (select count(distinct round_key) from public.competition_match_points p
         where p.competition_id = m.competition_id) < 3);

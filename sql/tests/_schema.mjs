// Produktionsskemaet, bygget i en tom PostgreSQL 16 — ét sted (G82).
//
// HVORFOR DEN ER FLYTTET HERTIL. Viden om, hvordan `sql/schema.sql` (et
// PG17-dump) læses af CI's PG16-klient, blev skrevet til `docs_sql.mjs` med
// `G74` og havde dengang ét aftagerled. Sæson-simulatorens test er det andet:
// den kan ikke bygge sit eget minischema som de øvrige `sql/tests/*.sql`, fordi
// simulatoren rører hele kæden — ligaer, sæsoner, hold, kampe, tips, triggere,
// rating, historier, kåringer, milepæle. Den skal have det RIGTIGE skema.
//
// To aftagere er grænsen: en regel, der køres to steder, må kun findes ét.
// Samme argument som `sql/checks/` (G84).
//
// Kør som script for at få hele kørslen på stdout:
//   node sql/tests/_schema.mjs > /tmp/skema.sql
//   psql -d mindatabase -v ON_ERROR_STOP=1 -f /tmp/skema.sql

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SKEMA = fileURLToPath(new URL("../schema.sql", import.meta.url));

// `sql/schema.sql` er dumpet af pg_dump 17 fra en PG17-server. Tre ting i den
// findes ikke i PostgreSQL 16, som CI's service-container og runnerens psql
// kører. Alle tre er ren emballage — ingen af dem ændrer, hvilke tabeller,
// kolonner eller typer skemaet definerer, og det er dét, testene bruger det
// til. De fjernes her, hvor grunden kan stå ved siden af, frem for i en sed i
// en YAML-fil.
//
//   · `\restrict` / `\unrestrict` — psql-META-kommandoer, nye i psql 17.5.
//     En psql 16 svarer "invalid command" og stopper på ON_ERROR_STOP.
//   · `SET transaction_timeout` — GUC'en er ny i PG17.
//   · `MAINTAIN` — privilegiet er nyt i PG17 og optræder i ét grant på
//     public.matches. Kun rettigheder, ikke struktur.
//
// Bliver CI'ens Postgres nogensinde 17, kan hele funktionen ryge — men så skal
// runnerens psql-klient også være 17, og det er den, der bestemmer over
// `\restrict`.
function tilPG16(dump) {
  return dump
    .split("\n")
    .filter((l) => !/^\\(un)?restrict\b/.test(l))
    .filter((l) => !/^SET transaction_timeout\b/.test(l))
    .map((l) => l.replace(/\bMAINTAIN,/, "").replace(/,MAINTAIN\b/, ""))
    .join("\n");
}

// Rollerne og auth-skemaet, som Supabase leverer, og som dumpet forudsætter.
const PRELUDE = `
\\set ON_ERROR_STOP on
\\timing off

do $prelude$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role','supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I', r); end if;
  end loop;
end $prelude$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $fn$ select nullif(current_setting('test.uid', true), '')::uuid $fn$;
create or replace function auth.role() returns text language sql stable as
  $fn$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                       nullif(current_setting('test.role', true), ''), 'authenticated') $fn$;
-- Attrappen bærer KUN de kolonner, testene og docs-blokkene faktisk rører —
-- ikke hele GoTrues tabel. Det er med vilje: en fuld kopi ville skulle
-- vedligeholdes efter en tabel, vi hverken ejer eller migrerer.
--
-- email_confirmed_at kom til 10. august 2026 med B26's runbog, som slår op i
-- og retter netop den kolonne (docs/OPRETTELSE.md). Uden den fejlede
-- docs-SQL-tjekket med 'column "email_confirmed_at" does not exist' — altså
-- ikke fordi dokumentationen var forkert, men fordi attrappen var smallere end
-- virkeligheden. Mangler en kolonne igen, er det symptomet at kende.
--
-- last_sign_in_at kom til 12. august 2026 af nøjagtig samme grund: runbogens
-- trin 7 tæller ubekræftede konti, før bekræftelsen slås til, og kolonnen er
-- dét, der skiller "oprettet og aldrig brugt" fra en aktiv bruger, der er
-- endt ubekræftet. Anden gang samme fælde, og forudsigelsen ovenfor holdt.
--
-- BEMÆRK: ingen backticks i denne blok. PRELUDE er et JS-template-literal, så
-- en backtick i en SQL-kommentar afslutter strengen og giver en SyntaxError i
-- Node, længe før PostgreSQL ser noget.
create table if not exists auth.users (
  id uuid primary key, email text, encrypted_password text,
  raw_user_meta_data jsonb, created_at timestamptz,
  email_confirmed_at timestamptz, last_sign_in_at timestamptz
);

-- Dumpet indeholder selv \`create schema public\`.
drop schema if exists public cascade;
`;

function skemaKørsel(dump = readFileSync(SKEMA, "utf8")) {
  return [PRELUDE, tilPG16(dump), "\nset search_path = public;\n"].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(skemaKørsel());
}

export { PRELUDE, SKEMA, tilPG16, skemaKørsel };

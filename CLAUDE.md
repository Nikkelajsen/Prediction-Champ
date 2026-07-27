`DOCUMENTATION.md` er den tekniske sandhed — læs den for fuld teknisk dokumentation af, hvordan systemet hænger sammen.

Ved produktbeslutninger og nye features læses desuden:
- `docs/PRODUCT_BOOK.md` — produktfilosofi (hvorfor produktet findes, og hvilke principper der beskytter dets identitet).
- `docs/ROADMAP.md` — status, prioritering og beslutningslog.
- relevant spec i `docs/features/` — fuld feature-specifikation før implementering.

Når en feature leveres eller en beslutning træffes, opdatér **både**:
- `docs/ROADMAP.md` (status + beslutningslog), og
- den relevante spec i `docs/features/`, hvis den leverede adfærd afviger fra det, spec'en beskriver.

Det andet punkt er lige så vigtigt som det første: en spec beskriver, hvad der var *planlagt*, og bliver forkert i det øjeblik leverancen afviger — eller senere rulles tilbage. Markér rettelser efter levering tydeligt i spec'en frem for at slette udkastet, så det fremgår, at noget blev ændret undervejs.

## Kommandoer

- `npm run dev` — udviklingsserver · `npm run build` — produktions-build
- `npm test` — Vitest. **Ingen CI kører testene**, så de skal køres i hånden før merge, sammen med "Tjekliste før merge" i `DOCUMENTATION.md` afsnit 11.

## SQL

Migreringerne i `sql/` køres **manuelt** i Supabase SQL-editor med "Run without RLS". De er idempotente, men to af dem ruller tavst nyere regler tilbage, hvis de gen-køres — læs filindekset og advarslen i `sql/README.md`, før du kører noget.

`sql/schema.sql` er et **genereret** øjebliksbillede (skema-eksport-workflowen), aldrig en fil man redigerer i hånden. Den er kun en gyldig reference, når eksporten er kørt efter seneste migrering.

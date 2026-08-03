-- `predictions.updated_at` flytter sig, når et tip RETTES (G13).
-- Idempotent — kan køres igen når som helst.
--
-- ---------------------------------------------------------------------------
-- Hvad der var galt
--
-- Kolonnen har en `default now()` og er dermed rigtig ved oprettelsen — men der
-- fandtes ingen trigger, og klienten sender ikke feltet: `PredictionsScreen`
-- upserter kun `pred_home`/`pred_away`, og et `on conflict do update` uden
-- feltet i sin `set`-liste lader den gamle værdi stå. Et rettet tip så derfor
-- ud som et tip, der aldrig var rørt siden det blev afgivet.
--
-- ---------------------------------------------------------------------------
-- Hvorfor det er en BESLUTNING og ikke en oprydning
--
-- Fire steder læser feltet, og de er ikke enige om, hvad de tror det betyder:
--
--   * Analytics' "Aktive konkurrencer"/"Aktive ligaer" tæller rækker rørt i
--     vinduet. Uden triggeren tæller de kun AFGIVNE tips, og en liga, hvor alle
--     retter deres gamle tips, ser død ud.
--   * Retention (uge 1/4/12/26/52) spørger, om brugeren var aktiv i uge N. Uden
--     triggeren tælles en rettelse ikke som aktivitet, og tallet er dermed for
--     lavt.
--   * Tragtens "tid til første tip" advarer allerede i sin egen forbeholds-tekst
--     om, at feltet "flytter sig, når et tip rettes" — hvilket det ikke gjorde.
--     Den advarsel bliver sand med denne migrering.
--
-- Beslutningen er altså ikke "skal tallet være pænere", men **hvad vil vi vide**:
-- om nogen HAR TIPPET, eller om nogen HAR VÆRET AKTIV. Svaret er det sidste for
-- alle fire læsere, og det er også den eneste af de to, der giver et
-- revisionsspor for et rettet gæt — noget, der i dag slet ikke findes.
--
-- **Målene skifter betydning den dag, den køres.** Det er prisen, og den er
-- valgt: tallene bliver en anelse højere og beskriver derefter det, deres egne
-- etiketter altid har lovet. Måle-ordbogen (`src/lib/analyticsMetrics.js`) er
-- rettet i samme ombæring — et tal, der skifter betydning uden at ordbogen
-- følger med, er værre end det gamle tal.

create or replace function public.touch_prediction_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Kun ved en RIGTIG ændring. Et upsert, der skriver den samme score igen
  -- (klienten gemmer ved hvert tastetryk-ophold), er ikke en rettelse, og et
  -- felt, der flytter sig uden at noget skete, ville gøre "aktiv" til "åbnede
  -- skærmen" — præcis den udvanding, målene skal undgå.
  if new.pred_home is distinct from old.pred_home
     or new.pred_away is distinct from old.pred_away then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists predictions_touch_updated_at on public.predictions;
create trigger predictions_touch_updated_at
  before update on public.predictions
  for each row
  execute function public.touch_prediction_updated_at();

-- ============================================================================
-- Verifikation — kør efter migreringen
-- ============================================================================
-- 1) Triggeren findes. Forvent én række.
-- select tgname from pg_trigger where tgrelid = 'public.predictions'::regclass
--   and not tgisinternal;

-- 2) En rettelse flytter feltet, en gen-skrivning af samme score gør ikke.
--    (Kør på en testrække, ikke på en rigtig brugers tip.)

-- Prediction Champ — Slet-adgang til egne forudsigelser (predictions)
-- Idempotent. Kør i Supabase SQL-editor med "Run without RLS".
--
-- Baggrund: En bruger kunne rydde sit tip i appen, men det dukkede op igen ved
-- næste åbning. Årsag: `predictions` havde ingen DELETE-policy, så PostgREST
-- returnerede 204 uden faktisk at slette nogen række (RLS blokerede sletningen
-- lydløst). Denne policy tillader en bruger at slette sine EGNE tips — men kun
-- så længe kampen ikke er låst (spiller kan altså kun slette inden runden går i
-- gang). Låsereglen er identisk med `isLocked()` i frontenden:
--   låst = resultat er sat  ELLER  nu >= kickoff minus 1 time.

alter table public.predictions enable row level security;

drop policy if exists "predictions_delete_own_unlocked" on public.predictions;
create policy "predictions_delete_own_unlocked"
on public.predictions
for delete
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.matches m
    where m.id = predictions.match_id
      and m.home_score is null
      and (m.kickoff_at is null or now() < m.kickoff_at - interval '1 hour')
  )
);

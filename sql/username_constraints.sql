-- Brugernavn-længde: display_name skal være 2–20 tegn (efter trim).
-- Idempotent — kan køres igen når som helst (kør med "Run without RLS").
--
-- Frontenden validerer også (Auth.jsx), men constraint'en er den egentlige
-- garanti, der ikke kan omgås. Grænsen beskytter samtidig mobil-layoutet:
-- display_name bruges bl.a. som kolonneoverskrift i "Point pr. runde"-tabellen.
--
-- NOT VALID: eksisterende rækker tjekkes ikke (undgår fejl på evt. gamle,
-- lange navne), men alle nye/ændrede rækker håndhæves. Er alle eksisterende
-- navne inden for grænsen, kan man senere køre:
--   alter table public.profiles validate constraint profiles_display_name_len;

alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles
  add constraint profiles_display_name_len
  check (char_length(btrim(display_name)) between 2 and 20) not valid;

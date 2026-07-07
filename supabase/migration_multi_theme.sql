-- Migration : permet à une entrée d'appartenir à plusieurs thèmes à la fois.
-- À exécuter dans le SQL Editor Supabase, sur un projet déjà initialisé avec
-- l'ancien schéma (entries.theme_id, un seul thème par fiche).
-- Ce script est rejouable sans risque : si vous l'exécutez plusieurs fois
-- (par exemple après une erreur en cours de route), il reprend là où il en
-- était sans dupliquer ni planter sur ce qui a déjà été fait.
-- Après cette migration, supabase/schema.sql reflète le nouvel état attendu.

create table if not exists entry_themes (
  entry_id text not null references entries(id) on delete cascade,
  theme_id text not null references themes(id) on delete cascade,
  owner_id uuid not null,
  primary key (entry_id, theme_id)
);

alter table entry_themes enable row level security;

drop policy if exists "owner_all_entry_themes" on entry_themes;
create policy "owner_all_entry_themes" on entry_themes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on entry_themes to authenticated;

-- Reprend l'affectation existante (une par entrée) dans la nouvelle table N-N,
-- puis retire l'ancienne colonne à thème unique. Protégé par ce test pour
-- rester sûr à rejouer même si la colonne a déjà été supprimée précédemment.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'entries' and column_name = 'theme_id'
  ) then
    insert into entry_themes (entry_id, theme_id, owner_id)
    select id, theme_id, owner_id from entries where theme_id is not null
    on conflict do nothing;

    alter table entries drop column theme_id;
  end if;
end $$;

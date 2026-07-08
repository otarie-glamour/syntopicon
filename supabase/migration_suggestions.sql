-- Migration : suggestions de rapprochement entre fiches (mots-clés communs).
-- Ajoute juste la table qui mémorise les suggestions déclinées, pour ne pas
-- les reproposer indéfiniment. À exécuter dans le SQL Editor Supabase.
-- Script rejouable sans risque.

create table if not exists dismissed_suggestions (
  entry_a_id text not null references entries(id) on delete cascade,
  entry_b_id text not null references entries(id) on delete cascade,
  owner_id uuid not null,
  dismissed_at timestamptz not null default now(),
  primary key (entry_a_id, entry_b_id)
);

alter table dismissed_suggestions enable row level security;

drop policy if exists "owner_all_dismissed_suggestions" on dismissed_suggestions;
create policy "owner_all_dismissed_suggestions" on dismissed_suggestions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on dismissed_suggestions to authenticated;

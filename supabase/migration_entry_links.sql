-- Migration : permet de relier deux fiches entre elles (répond à / prolonge /
-- contredit / lien générique), indépendamment des thèmes.
-- À exécuter dans le SQL Editor Supabase. Script rejouable sans risque.

create table if not exists entry_links (
  id text primary key,
  from_entry_id text not null references entries(id) on delete cascade,
  to_entry_id text not null references entries(id) on delete cascade,
  relation text not null default 'lien',
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  constraint entry_links_no_self check (from_entry_id <> to_entry_id),
  constraint entry_links_unique unique (from_entry_id, to_entry_id, relation)
);

alter table entry_links enable row level security;

drop policy if exists "owner_all_entry_links" on entry_links;
create policy "owner_all_entry_links" on entry_links
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on entry_links to authenticated;

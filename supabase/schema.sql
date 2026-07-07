-- Syntopicon : schéma Supabase.
-- À coller une fois dans le SQL Editor de votre projet Supabase (Dashboard > SQL Editor > New query),
-- puis cliquer "Run". Voir README.md pour la suite de la configuration (clés, compte, etc.).
-- Pour un projet déjà initialisé avec l'ancien schéma (une entrée = un seul
-- thème), voir supabase/migration_multi_theme.sql à la place.

create table if not exists themes (
  id text primary key,
  name text not null,
  owner_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists entries (
  id text primary key,
  title text not null,
  source text not null default '',
  notes text not null default '',
  owner_id uuid not null,
  created_at timestamptz not null default now()
);

-- Une entrée peut appartenir à plusieurs thèmes à la fois (relation N-N).
create table if not exists entry_themes (
  entry_id text not null references entries(id) on delete cascade,
  theme_id text not null references themes(id) on delete cascade,
  owner_id uuid not null,
  primary key (entry_id, theme_id)
);

create table if not exists imported_batches (
  id text primary key,
  owner_id uuid not null,
  imported_at timestamptz not null default now()
);

alter table themes enable row level security;
alter table entries enable row level security;
alter table entry_themes enable row level security;
alter table imported_batches enable row level security;

-- Chaque ligne n'est lisible/modifiable que par son propriétaire (owner_id = votre utilisateur connecté).
-- Comme les inscriptions publiques seront désactivées et que vous serez la seule personne
-- à avoir un compte, cela revient à réserver toutes les données à vous seul.
create policy "owner_all_themes" on themes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner_all_entries" on entries
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner_all_entry_themes" on entry_themes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner_all_imported_batches" on imported_batches
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Les policies RLS ci-dessus restreignent l'accès, mais ne l'accordent pas :
-- sans ces GRANT, Postgres refuse toute requête ("permission denied") avant
-- même de regarder les policies. On accorde uniquement au rôle "authenticated"
-- (jamais à "anon"), pour que seule une session connectée puisse lire/écrire.
grant usage on schema public to authenticated;
grant select, insert, update, delete on themes to authenticated;
grant select, insert, update, delete on entries to authenticated;
grant select, insert, update, delete on entry_themes to authenticated;
grant select, insert, update, delete on imported_batches to authenticated;

-- Syntopicon : schéma Supabase.
-- À coller une fois dans le SQL Editor de votre projet Supabase (Dashboard > SQL Editor > New query),
-- puis cliquer "Run". Voir README.md pour la suite de la configuration (clés, compte, etc.).

create table if not exists themes (
  id text primary key,
  name text not null,
  owner_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists entries (
  id text primary key,
  title text not null,
  theme_id text references themes(id) on delete set null,
  source text not null default '',
  notes text not null default '',
  owner_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists imported_batches (
  id text primary key,
  owner_id uuid not null,
  imported_at timestamptz not null default now()
);

alter table themes enable row level security;
alter table entries enable row level security;
alter table imported_batches enable row level security;

-- Chaque ligne n'est lisible/modifiable que par son propriétaire (owner_id = votre utilisateur connecté).
-- Comme les inscriptions publiques seront désactivées et que vous serez la seule personne
-- à avoir un compte, cela revient à réserver toutes les données à vous seul.
create policy "owner_all_themes" on themes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner_all_entries" on entries
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
grant select, insert, update, delete on imported_batches to authenticated;

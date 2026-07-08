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
  -- Date de l'idée/lecture elle-même (éditable, distincte de created_at qui
  -- est la date d'enregistrement technique dans l'outil).
  captured_at date not null default current_date,
  -- Référence bibliographique complète, en vue d'un futur export (Zotero...).
  ref_type text not null default '',
  ref_authors text not null default '',
  ref_title text not null default '',
  ref_container text not null default '',
  ref_publisher text not null default '',
  ref_year text not null default '',
  ref_edition text not null default '',
  ref_pages text not null default '',
  ref_isbn text not null default '',
  ref_doi text not null default '',
  deleted_at timestamptz,
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

-- Lien dirigé et typé entre deux fiches (ex : A "répond à" B), indépendant des thèmes.
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

create table if not exists imported_batches (
  id text primary key,
  owner_id uuid not null,
  imported_at timestamptz not null default now()
);

-- Paires de fiches pour lesquelles une suggestion de rapprochement (mots-clés
-- communs) a été déclinée, pour ne plus la reproposer. entry_a_id est
-- toujours la plus petite des deux id (ordre alphabétique), fixé côté appli.
create table if not exists dismissed_suggestions (
  entry_a_id text not null references entries(id) on delete cascade,
  entry_b_id text not null references entries(id) on delete cascade,
  owner_id uuid not null,
  dismissed_at timestamptz not null default now(),
  primary key (entry_a_id, entry_b_id)
);

alter table themes enable row level security;
alter table entries enable row level security;
alter table entry_themes enable row level security;
alter table entry_links enable row level security;
alter table imported_batches enable row level security;
alter table dismissed_suggestions enable row level security;

-- Chaque ligne n'est lisible/modifiable que par son propriétaire (owner_id = votre utilisateur connecté).
-- Comme les inscriptions publiques seront désactivées et que vous serez la seule personne
-- à avoir un compte, cela revient à réserver toutes les données à vous seul.
create policy "owner_all_themes" on themes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner_all_entries" on entries
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner_all_entry_themes" on entry_themes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner_all_entry_links" on entry_links
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner_all_imported_batches" on imported_batches
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner_all_dismissed_suggestions" on dismissed_suggestions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Les policies RLS ci-dessus restreignent l'accès, mais ne l'accordent pas :
-- sans ces GRANT, Postgres refuse toute requête ("permission denied") avant
-- même de regarder les policies. On accorde uniquement au rôle "authenticated"
-- (jamais à "anon"), pour que seule une session connectée puisse lire/écrire.
grant usage on schema public to authenticated;
grant select, insert, update, delete on themes to authenticated;
grant select, insert, update, delete on entries to authenticated;
grant select, insert, update, delete on entry_themes to authenticated;
grant select, insert, update, delete on entry_links to authenticated;
grant select, insert, update, delete on imported_batches to authenticated;
grant select, insert, update, delete on dismissed_suggestions to authenticated;

-- Migration : enrichit les fiches avec une date de capture éditable et une
-- référence bibliographique complète (en vue d'un futur export, Zotero
-- notamment). À exécuter dans le SQL Editor Supabase. Script rejouable sans
-- risque.

alter table entries add column if not exists captured_at date not null default current_date;
alter table entries add column if not exists ref_type text not null default '';
alter table entries add column if not exists ref_authors text not null default '';
alter table entries add column if not exists ref_title text not null default '';
alter table entries add column if not exists ref_container text not null default '';
alter table entries add column if not exists ref_publisher text not null default '';
alter table entries add column if not exists ref_year text not null default '';
alter table entries add column if not exists ref_edition text not null default '';
alter table entries add column if not exists ref_pages text not null default '';
alter table entries add column if not exists ref_isbn text not null default '';
alter table entries add column if not exists ref_doi text not null default '';

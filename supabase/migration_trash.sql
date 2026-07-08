-- Migration : ajoute une corbeille pour les fiches (suppression douce).
-- « Supprimer » depuis la fiche ne fait plus qu'y poser une date de
-- suppression ; la fiche disparaît du tableau mais reste récupérable dans la
-- corbeille jusqu'à suppression définitive manuelle.
-- À exécuter dans le SQL Editor Supabase. Script rejouable sans risque.

alter table entries add column if not exists deleted_at timestamptz;

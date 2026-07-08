-- Migration : ajoute un champ "réflexion personnelle" distinct des notes de
-- lecture, pour vos questionnements et commentaires. À exécuter dans le SQL
-- Editor Supabase. Script rejouable sans risque.

alter table entries add column if not exists reflection text not null default '';

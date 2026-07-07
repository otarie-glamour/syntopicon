const { useState, useEffect, useMemo } = React;

/*
  Persistance via Supabase (base de données + authentification).
  Le site est privé : tant que vous n'êtes pas connecté, aucune donnée n'est
  chargée ni affichée. Une fois connecté, la session reste enregistrée dans ce
  navigateur (vous ne vous reconnectez plus sur cet appareil). SUPABASE_URL et
  SUPABASE_ANON_KEY viennent de supabase-config.js (voir README.md).
*/
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Charge themes/entries (+ leurs thèmes N-N)/imported_batches de l'utilisateur connecté. */
async function fetchRemoteData(userId) {
  const [{ data: themes, error: te }, { data: entries, error: ee }, { data: links, error: le }, { data: batches, error: be }] =
    await Promise.all([
      sb.from("themes").select("id,name").eq("owner_id", userId).order("name"),
      sb
        .from("entries")
        .select("id,title,source,notes,created_at")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false }),
      sb.from("entry_themes").select("entry_id,theme_id").eq("owner_id", userId),
      sb.from("imported_batches").select("id").eq("owner_id", userId),
    ]);
  if (te || ee || le || be) throw te || ee || le || be;
  const themeIdsByEntry = {};
  (links || []).forEach((l) => {
    if (!themeIdsByEntry[l.entry_id]) themeIdsByEntry[l.entry_id] = [];
    themeIdsByEntry[l.entry_id].push(l.theme_id);
  });
  return {
    themes: themes || [],
    entries: (entries || []).map((e) => ({
      id: e.id,
      title: e.title,
      themeIds: themeIdsByEntry[e.id] || [],
      source: e.source || "",
      notes: e.notes || "",
      createdAt: new Date(e.created_at).getTime(),
    })),
    importedBatches: (batches || []).map((b) => b.id),
  };
}

/* Insère en base un lot de thèmes / fiches (+ leurs liaisons) / identifiants de lots importés. */
async function insertRows(userId, { themes = [], entries = [], batchIds = [] }) {
  if (themes.length) {
    const { error } = await sb
      .from("themes")
      .insert(themes.map((t) => ({ id: t.id, name: t.name, owner_id: userId })));
    if (error) throw error;
  }
  if (entries.length) {
    const { error } = await sb.from("entries").insert(
      entries.map((e) => ({
        id: e.id,
        title: e.title,
        source: e.source,
        notes: e.notes,
        owner_id: userId,
      }))
    );
    if (error) throw error;
    const links = [];
    entries.forEach((e) => {
      (e.themeIds || []).forEach((themeId) => links.push({ entry_id: e.id, theme_id: themeId, owner_id: userId }));
    });
    if (links.length) {
      const { error: linkError } = await sb.from("entry_themes").insert(links);
      if (linkError) throw linkError;
    }
  }
  if (batchIds.length) {
    const { error } = await sb
      .from("imported_batches")
      .insert(batchIds.map((id) => ({ id, owner_id: userId })));
    if (error) throw error;
  }
}

/*
  SYNTOPICON : espace de travail personnel inspiré du Syntopicon d'Adler.
  Vue Kanban par thème (une fiche peut appartenir à plusieurs thèmes), capture rapide,
  groupes masqués, analytique des idées. Données enregistrées dans Supabase et
  exportables en JSON. Esthétique : fiches de lecture / catalogue de bibliothèque.
*/

const SEED = {
  themes: [
    { id: "th_connaissance", name: "Connaissance" },
    { id: "th_amour", name: "Amour" },
    { id: "th_ecriture", name: "Écriture" },
    { id: "th_economie", name: "Économie" },
    { id: "th_education", name: "Éducation" },
    { id: "th_morale", name: "Morale" },
  ],
  entries: [],
};

const uid = (p) => p + "_" + Math.random().toString(36).slice(2, 9);

/*
  Lots d'importation : fiches préparées par Claude à partir des carnets de
  lecture. Chaque lot est fusionné une seule fois dans les données existantes
  (jamais d'écrasement : les identifiants sont stables et le lot est marqué
  comme traité dans importedBatches).
*/
const IMPORT_BATCHES = [
  {
    id: "import_foucault_sp_20260704",
    themes: ["Pouvoir et discipline", "Punition"],
    entries: [
      {
        id: "en_fsp_damiens",
        title: "Du supplice de Damiens à l'emploi du temps (1757-1838)",
        theme: "Punition",
        source: "Foucault, Surveiller et Punir (1975), I, ch. 1",
        notes: "L'ouverture du livre juxtapose le supplice de Damiens (1757) et le règlement de la maison des jeunes détenus de Paris (1838). En moins d'un siècle, le châtiment-spectacle disparaît au profit d'une pénalité sourde de l'emploi du temps. Ce n'est pas un adoucissement mais un changement d'économie punitive.",
      },
      {
        id: "en_fsp_ame",
        title: "La punition vise l'âme et non plus le corps",
        theme: "Punition",
        source: "Foucault, Surveiller et Punir (1975), I, ch. 1",
        notes: "Déplacement de l'objet punitif : on ne châtie plus le corps, on corrige l'âme (penchants, volonté, dispositions). D'où le renversement de la formule chrétienne : l'âme devient la prison du corps.",
      },
      {
        id: "en_fsp_panoptique",
        title: "Le panoptique de Bentham",
        theme: "Pouvoir et discipline",
        source: "Foucault, Surveiller et Punir (1975), III, ch. 3",
        notes: "Architecture induisant un état conscient et permanent de visibilité. Le détenu, ne sachant jamais s'il est observé, devient le principe de son propre assujettissement. Le pouvoir s'automatise et se désindividualise : il tient au dispositif, non à une personne.",
      },
      {
        id: "en_fsp_pouvoirsavoir",
        title: "Pouvoir-savoir",
        theme: "Connaissance",
        source: "Foucault, Surveiller et Punir (1975), I, ch. 1",
        notes: "Pouvoir et savoir s'impliquent directement l'un l'autre : il n'y a pas de relation de pouvoir sans constitution corrélative d'un champ de savoir, ni de savoir qui ne suppose et ne constitue en même temps des relations de pouvoir.",
      },
      {
        id: "en_fsp_corpsdociles",
        title: "Les corps dociles",
        theme: "Pouvoir et discipline",
        source: "Foucault, Surveiller et Punir (1975), III, ch. 1",
        notes: "La discipline fabrique des corps soumis et exercés. Techniques de répartition des individus dans l'espace : clôture, quadrillage, emplacements fonctionnels, rang. Le corps devient objet et cible d'un pouvoir qui le travaille dans le détail.",
      },
      {
        id: "en_fsp_examen",
        title: "L'examen : surveiller et normaliser",
        theme: "Pouvoir et discipline",
        source: "Foucault, Surveiller et Punir (1975), III, ch. 2",
        notes: "L'examen combine la surveillance hiérarchique et la sanction normalisatrice. Il fait de chaque individu un cas : descriptible, mesurable, comparable. L'individu entre dans un champ documentaire (registres, dossiers) qui le constitue comme objet de savoir.",
      },
      {
        id: "en_fsp_delinquance",
        title: "La prison fabrique la délinquance",
        theme: "Punition",
        source: "Foucault, Surveiller et Punir (1975), IV, ch. 2",
        notes: "L'échec apparent de la prison (récidive) est en réalité fonctionnel : elle produit un milieu délinquant clos, contrôlable, utilisable, et le différencie des illégalismes populaires. L'échec fait partie du fonctionnement.",
      },
    ],
  },
];

/* Fusion non destructive d'un lot dans les données existantes. */
function mergeImports(base) {
  let d = {
    themes: [...(base.themes || [])],
    entries: [...(base.entries || [])],
    importedBatches: [...(base.importedBatches || [])],
  };
  const added = { themes: [], entries: [], batchIds: [] };
  let changed = false;
  for (const batch of IMPORT_BATCHES) {
    if (d.importedBatches.includes(batch.id)) continue;
    const themeIdByName = {};
    d.themes.forEach((t) => (themeIdByName[t.name.toLowerCase()] = t.id));
    for (const name of batch.themes) {
      if (!themeIdByName[name.toLowerCase()]) {
        const t = { id: uid("th"), name };
        d.themes.push(t);
        themeIdByName[name.toLowerCase()] = t.id;
        added.themes.push(t);
      }
    }
    const existingIds = new Set(d.entries.map((e) => e.id));
    for (const e of batch.entries) {
      if (existingIds.has(e.id)) continue;
      const linkedThemeId = themeIdByName[e.theme.toLowerCase()] || null;
      const entry = {
        id: e.id,
        title: e.title,
        themeIds: linkedThemeId ? [linkedThemeId] : [],
        source: e.source,
        notes: e.notes,
        createdAt: Date.now(),
      };
      d.entries.push(entry);
      added.entries.push(entry);
    }
    d.importedBatches.push(batch.id);
    added.batchIds.push(batch.id);
    changed = true;
  }
  return { data: d, changed, added };
}

/* ---------- Connexion ---------- */
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (ev) => {
    ev.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError("Connexion refusée. Vérifiez votre email et votre mot de passe.");
  };

  return (
    <div className="syn-root" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{css}</style>
      <form className="syn-panel" onSubmit={submit} style={{ width: 320 }}>
        <div className="syn-eyebrow">Accès privé</div>
        <h1 className="syn-title" style={{ fontSize: 28, marginBottom: 4 }}>Syntopicon</h1>
        <label className="syn-field" style={{ width: "100%", marginTop: 10 }}>
          <span>Email</span>
          <input
            className="syn-input"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="syn-field" style={{ width: "100%" }}>
          <span>Mot de passe</span>
          <input
            className="syn-input"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div style={{ color: "var(--filet)", fontSize: 13, marginBottom: 6 }}>{error}</div>}
        <button className="syn-btn syn-btn-primary" type="submit" disabled={loading}>
          {loading ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </div>
  );
}

function Syntopicon() {
  const [session, setSession] = useState(undefined); // undefined = vérification en cours, null = déconnecté
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [quickText, setQuickText] = useState("");
  const [quickFlash, setQuickFlash] = useState(false);
  const [editing, setEditing] = useState(null); // entry id
  const [creating, setCreating] = useState(false);
  const [newTheme, setNewTheme] = useState("");
  const [addingTheme, setAddingTheme] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [search, setSearch] = useState("");

  /* ---------- authentification ---------- */
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = sb.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  /* ---------- chargement (une fois connecté) ---------- */
  useEffect(() => {
    if (!session) {
      setData(null);
      return;
    }
    (async () => {
      const userId = session.user.id;
      let base;
      try {
        base = await fetchRemoteData(userId);
      } catch (e) {
        console.error("Syntopicon: échec du chargement depuis Supabase :", e);
        setLoadError(e && e.message ? e.message : true);
        return;
      }
      const isFresh = base.themes.length === 0 && base.entries.length === 0 && base.importedBatches.length === 0;
      const { data: merged, changed, added } = mergeImports(isFresh ? SEED : base);
      setData(merged);
      if (isFresh) {
        setSaveState("saving");
        try {
          await insertRows(userId, { themes: merged.themes, entries: merged.entries, batchIds: merged.importedBatches });
          setSaveState("saved");
        } catch (e) {
          setSaveState("error");
        }
      } else if (changed) {
        setSaveState("saving");
        try {
          await insertRows(userId, added);
          setSaveState("saved");
        } catch (e) {
          setSaveState("error");
        }
      }
    })();
  }, [session]);

  /* ---------- mutations ---------- */
  const addEntry = async (entry) => {
    const e = {
      id: uid("en"),
      title: entry.title.trim(),
      themeIds: entry.themeIds || [],
      source: (entry.source || "").trim(),
      notes: (entry.notes || "").trim(),
      createdAt: Date.now(),
    };
    setSaveState("saving");
    const { error } = await sb.from("entries").insert({
      id: e.id,
      title: e.title,
      source: e.source,
      notes: e.notes,
      owner_id: session.user.id,
    });
    if (error) {
      setSaveState("error");
      return;
    }
    if (e.themeIds.length) {
      const { error: linkError } = await sb
        .from("entry_themes")
        .insert(e.themeIds.map((themeId) => ({ entry_id: e.id, theme_id: themeId, owner_id: session.user.id })));
      if (linkError) {
        setSaveState("error");
        return;
      }
    }
    setData((d) => ({ ...d, entries: [e, ...d.entries] }));
    setSaveState("saved");
  };

  const updateEntry = async (id, patch) => {
    setSaveState("saving");
    const dbPatch = {};
    if ("title" in patch) dbPatch.title = patch.title;
    if ("source" in patch) dbPatch.source = patch.source;
    if ("notes" in patch) dbPatch.notes = patch.notes;
    if (Object.keys(dbPatch).length) {
      const { error } = await sb.from("entries").update(dbPatch).eq("id", id);
      if (error) {
        setSaveState("error");
        return;
      }
    }
    if ("themeIds" in patch) {
      const { error: delError } = await sb.from("entry_themes").delete().eq("entry_id", id);
      if (delError) {
        setSaveState("error");
        return;
      }
      if (patch.themeIds.length) {
        const { error: insError } = await sb
          .from("entry_themes")
          .insert(patch.themeIds.map((themeId) => ({ entry_id: id, theme_id: themeId, owner_id: session.user.id })));
        if (insError) {
          setSaveState("error");
          return;
        }
      }
    }
    setData((d) => ({ ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    setSaveState("saved");
  };

  const deleteEntry = async (id) => {
    setSaveState("saving");
    const { error } = await sb.from("entries").delete().eq("id", id);
    if (error) {
      setSaveState("error");
      return;
    }
    setData((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }));
    setSaveState("saved");
    setEditing(null);
  };

  const addTheme = async (name) => {
    const n = name.trim();
    if (!n) return;
    if (data.themes.some((t) => t.name.toLowerCase() === n.toLowerCase())) return;
    const t = { id: uid("th"), name: n };
    setSaveState("saving");
    const { error } = await sb.from("themes").insert({ id: t.id, name: t.name, owner_id: session.user.id });
    if (error) {
      setSaveState("error");
      return;
    }
    setData((d) => ({ ...d, themes: [...d.themes, t] }));
    setSaveState("saved");
  };

  const renameTheme = async (id, name) => {
    const n = name.trim();
    if (!n) return;
    setSaveState("saving");
    const { error } = await sb.from("themes").update({ name: n }).eq("id", id);
    if (error) {
      setSaveState("error");
      return;
    }
    setData((d) => ({ ...d, themes: d.themes.map((t) => (t.id === id ? { ...t, name: n } : t)) }));
    setSaveState("saved");
  };

  const deleteTheme = async (id) => {
    setSaveState("saving");
    // La contrainte "on delete cascade" côté base détache déjà les fiches de ce thème
    // (leurs autres appartenances, elles, restent intactes).
    const { error } = await sb.from("themes").delete().eq("id", id);
    if (error) {
      setSaveState("error");
      return;
    }
    setData((d) => ({
      themes: d.themes.filter((t) => t.id !== id),
      entries: d.entries.map((e) => ({ ...e, themeIds: e.themeIds.filter((tid) => tid !== id) })),
      importedBatches: d.importedBatches,
    }));
    setSaveState("saved");
  };

  const quickCapture = () => {
    const t = quickText.trim();
    if (!t) return;
    const firstLine = t.split("\n")[0];
    addEntry({
      title: firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine,
      notes: t === firstLine ? "" : t,
      themeIds: [],
    });
    setQuickText("");
    setQuickFlash(true);
    setTimeout(() => setQuickFlash(false), 1500);
  };

  /* ---------- dérivés ---------- */
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.entries;
    return data.entries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.notes.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q)
    );
  }, [data, search]);

  const byTheme = useMemo(() => {
    const map = { none: [] };
    if (!data) return map;
    data.themes.forEach((t) => (map[t.id] = []));
    filtered.forEach((e) => {
      const ids = (e.themeIds || []).filter((tid) => map[tid]);
      if (ids.length) ids.forEach((tid) => map[tid].push(e));
      else map.none.push(e);
    });
    return map;
  }, [data, filtered]);

  const visibleThemes = data ? data.themes.filter((t) => byTheme[t.id]?.length > 0) : [];
  const hiddenThemes = data ? data.themes.filter((t) => !byTheme[t.id]?.length) : [];

  const sources = useMemo(() => {
    if (!data) return [];
    const m = {};
    data.entries.forEach((e) => {
      const s = e.source || "Sans source";
      m[s] = (m[s] || 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [data]);

  /* ---------- rendu ---------- */
  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#EDEFEA", fontFamily: "'IBM Plex Sans', sans-serif", color: "#22303F" }}>
        Vérification de la connexion...
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  if (!data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", gap: 8, alignItems: "center", justifyContent: "center", background: "#EDEFEA", fontFamily: "'IBM Plex Sans', sans-serif", color: "#22303F", padding: 24, textAlign: "center" }}>
        {loadError ? (
          <>
            <div>Impossible de charger vos données.</div>
            {typeof loadError === "string" && (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#C25E5E", maxWidth: 480 }}>
                {loadError}
              </div>
            )}
          </>
        ) : (
          "Ouverture du catalogue..."
        )}
      </div>
    );
  }

  const editingEntry = editing ? data.entries.find((e) => e.id === editing) : null;
  const maxCount = Math.max(
    1,
    ...data.themes.map((t) => data.entries.filter((e) => e.themeIds.includes(t.id)).length),
    data.entries.filter((e) => e.themeIds.length === 0).length
  );

  return (
    <div className="syn-root">
      <style>{css}</style>

      {/* ===== En-tête ===== */}
      <header className="syn-header">
        <div>
          <div className="syn-eyebrow">Catalogue personnel des idées</div>
          <h1 className="syn-title">Syntopicon</h1>
        </div>
        <div className="syn-header-right">
          <div className="syn-save" data-state={saveState}>
            {saveState === "saving" && "Enregistrement..."}
            {saveState === "saved" && "Enregistré dans Supabase"}
            {saveState === "error" && "Erreur d'enregistrement, réessayez"}
          </div>
          <div className="syn-header-actions">
            <button className="syn-btn syn-btn-sm" onClick={() => sb.auth.signOut()}>
              Se déconnecter
            </button>
          </div>
        </div>
      </header>

      {/* ===== Capture ===== */}
      <section className="syn-capture-row">
        <div className="syn-panel">
          <div className="syn-panel-label">Ajouter une entrée au Syntopicon</div>
          <button className="syn-btn syn-btn-primary" onClick={() => setCreating(true)}>
            Nouvelle entrée
          </button>
        </div>
        <div className="syn-panel syn-quick">
          <div className="syn-panel-label">
            Pressé ? Notez vos idées éparses ici
            {quickFlash && <span className="syn-flash">ajouté sans thème</span>}
          </div>
          <textarea
            className="syn-textarea"
            rows={3}
            placeholder="Une idée, une citation, une intuition..."
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) quickCapture();
            }}
          />
          <button className="syn-btn" onClick={quickCapture} disabled={!quickText.trim()}>
            Capturer
          </button>
        </div>
      </section>

      {/* ===== Kanban ===== */}
      <section className="syn-board-section">
        <div className="syn-section-head">
          <h2>Votre Syntopicon</h2>
          <span className="syn-sub">Consultez et annotez vos idées par thème</span>
          <input
            className="syn-search"
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="syn-board">
          {visibleThemes.map((t) => (
            <Column
              key={t.id}
              theme={t}
              entries={byTheme[t.id]}
              unlimited={Boolean(search.trim())}
              onOpen={setEditing}
              onRename={renameTheme}
              onDelete={deleteTheme}
              dragOver={dragOver === t.id}
              onDragOver={(e) => { e.preventDefault(); setDragOver(t.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => {
                if (dragId) {
                  const dragged = data.entries.find((e) => e.id === dragId);
                  if (dragged && !dragged.themeIds.includes(t.id)) {
                    updateEntry(dragId, { themeIds: [...dragged.themeIds, t.id] });
                  }
                }
                setDragId(null); setDragOver(null);
              }}
              onDragStart={setDragId}
            />
          ))}

          {byTheme.none.length > 0 && (
            <Column
              theme={{ id: "none", name: "Sans thème" }}
              entries={byTheme.none}
              unlimited={Boolean(search.trim())}
              onOpen={setEditing}
              muted
              dragOver={dragOver === "none"}
              onDragOver={(e) => { e.preventDefault(); setDragOver("none"); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => {
                if (dragId) updateEntry(dragId, { themeIds: [] });
                setDragId(null); setDragOver(null);
              }}
              onDragStart={setDragId}
            />
          )}

          {/* Groupes masqués */}
          <div className="syn-hidden">
            <div className="syn-hidden-title">Groupes masqués</div>
            {hiddenThemes.length === 0 && (
              <div className="syn-hidden-empty">Tous vos thèmes contiennent des entrées.</div>
            )}
            {hiddenThemes.map((t) => (
              <div key={t.id} className="syn-hidden-row">
                <span className="syn-tag">{t.name}</span>
                <span className="syn-count">0</span>
                <button className="syn-x" title="Supprimer ce thème" onClick={() => deleteTheme(t.id)}>×</button>
              </div>
            ))}
            {addingTheme ? (
              <div className="syn-hidden-add">
                <input
                  autoFocus
                  className="syn-input"
                  placeholder="Nom du thème"
                  value={newTheme}
                  onChange={(e) => setNewTheme(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { addTheme(newTheme); setNewTheme(""); setAddingTheme(false); }
                    if (e.key === "Escape") { setNewTheme(""); setAddingTheme(false); }
                  }}
                />
                <button className="syn-btn" onClick={() => { addTheme(newTheme); setNewTheme(""); setAddingTheme(false); }}>
                  Ajouter
                </button>
              </div>
            ) : (
              <button className="syn-add-theme" onClick={() => setAddingTheme(true)}>+ Nouveau thème</button>
            )}
          </div>
        </div>
      </section>

      {/* ===== Analytique ===== */}
      <section className="syn-analytics">
        <div className="syn-section-head">
          <h2>L'analytique de votre esprit</h2>
          <span className="syn-sub">Décomposez l'origine de vos idées et repérez vos angles morts</span>
        </div>
        <div className="syn-ana-grid">
          <div className="syn-ana-block">
            <h3>Répartition par thème</h3>
            {data.themes.map((t) => {
              const n = data.entries.filter((e) => e.themeIds.includes(t.id)).length;
              return <Bar key={t.id} label={t.name} n={n} max={maxCount} />;
            })}
            <Bar label="Sans thème" n={data.entries.filter((e) => e.themeIds.length === 0).length} max={maxCount} muted />
          </div>
          <div className="syn-ana-block">
            <h3>Provenance des idées</h3>
            {data.entries.length === 0 ? (
              <p className="syn-empty-text">Aucune entrée pour l'instant.</p>
            ) : (
              sources.map(([s, n]) => <Bar key={s} label={s} n={n} max={sources[0][1]} />)
            )}
          </div>
          <div className="syn-ana-block">
            <h3>Angles morts possibles</h3>
            {hiddenThemes.length === 0 ? (
              <p className="syn-empty-text">Aucun thème vide : votre pensée couvre l'ensemble de vos catégories.</p>
            ) : (
              <>
                <p className="syn-empty-text">Ces thèmes ne contiennent encore aucune idée :</p>
                <div className="syn-blind-list">
                  {hiddenThemes.map((t) => (
                    <span key={t.id} className="syn-tag syn-tag-blind">{t.name}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ===== Modales ===== */}
      {creating && (
        <EntryModal
          themes={data.themes}
          onClose={() => setCreating(false)}
          onSave={(e) => { addEntry(e); setCreating(false); }}
        />
      )}
      {editingEntry && (
        <EntryModal
          themes={data.themes}
          entry={editingEntry}
          onClose={() => setEditing(null)}
          onSave={(patch) => { updateEntry(editingEntry.id, patch); setEditing(null); }}
          onDelete={() => deleteEntry(editingEntry.id)}
        />
      )}
    </div>
  );
}

/* ---------- Colonne Kanban ---------- */
const COLUMN_PAGE_SIZE = 20;

function Column({ theme, entries, unlimited, onOpen, onRename, onDelete, muted, dragOver, onDragOver, onDragLeave, onDrop, onDragStart }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(theme.name);
  const [visibleCount, setVisibleCount] = useState(COLUMN_PAGE_SIZE);

  const visibleEntries = unlimited ? entries : entries.slice(0, visibleCount);
  const remaining = entries.length - visibleEntries.length;

  return (
    <div
      className={"syn-col" + (dragOver ? " syn-col-over" : "")}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={"syn-col-head" + (muted ? " syn-col-head-muted" : "")}>
        {renaming ? (
          <input
            autoFocus
            className="syn-input syn-input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { onRename && onRename(theme.id, name); setRenaming(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onRename && onRename(theme.id, name); setRenaming(false); }
              if (e.key === "Escape") { setName(theme.name); setRenaming(false); }
            }}
          />
        ) : (
          <span
            className="syn-col-name"
            onDoubleClick={() => onRename && setRenaming(true)}
            title={onRename ? "Double-clic pour renommer" : undefined}
          >
            {theme.name}
          </span>
        )}
        <span className="syn-count">{entries.length}</span>
        {onDelete && (
          <button className="syn-x" title="Supprimer le thème (les fiches deviennent sans thème)" onClick={() => onDelete(theme.id)}>×</button>
        )}
      </div>
      {visibleEntries.map((e) => (
        <div
          key={e.id}
          className="syn-card"
          draggable
          onDragStart={() => onDragStart(e.id)}
          onClick={() => onOpen(e.id)}
        >
          <div className="syn-card-title">{e.title}</div>
          {e.source && <div className="syn-card-source">{e.source}</div>}
          {e.notes && <div className="syn-card-notes">{e.notes}</div>}
        </div>
      ))}
      {remaining > 0 && (
        <button className="syn-load-more" onClick={() => setVisibleCount(entries.length)}>
          Charger {remaining} de plus
        </button>
      )}
    </div>
  );
}

/* ---------- Barre analytique ---------- */
function Bar({ label, n, max, muted }) {
  return (
    <div className="syn-bar-row">
      <span className={"syn-bar-label" + (muted ? " syn-bar-label-muted" : "")}>{label}</span>
      <div className="syn-bar-track">
        <div className="syn-bar-fill" style={{ width: max ? Math.max(n / max * 100, n > 0 ? 4 : 0) + "%" : 0 }} />
      </div>
      <span className="syn-count">{n}</span>
    </div>
  );
}

/* ---------- Modale d'entrée ---------- */
function EntryModal({ themes, entry, onClose, onSave, onDelete }) {
  const [title, setTitle] = useState(entry ? entry.title : "");
  const [themeIds, setThemeIds] = useState(entry ? entry.themeIds || [] : []);
  const [source, setSource] = useState(entry ? entry.source : "");
  const [notes, setNotes] = useState(entry ? entry.notes : "");

  const toggleTheme = (id) => {
    setThemeIds((ids) => (ids.includes(id) ? ids.filter((tid) => tid !== id) : [...ids, id]));
  };

  const save = () => {
    if (!title.trim()) return;
    onSave({ title: title.trim(), themeIds, source, notes });
  };

  return (
    <div className="syn-overlay" onClick={onClose}>
      <div className="syn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="syn-modal-rule" />
        <h3 className="syn-modal-title">{entry ? "Modifier la fiche" : "Nouvelle fiche"}</h3>
        <label className="syn-field">
          <span>Titre</span>
          <input autoFocus className="syn-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="La lettre de Pascal sur l'art d'écrire court" />
        </label>
        <div className="syn-field">
          <span>Thèmes syntopiques (un ou plusieurs)</span>
          <div className="syn-theme-checks">
            {themes.length === 0 && <p className="syn-empty-text">Aucun thème créé pour l'instant.</p>}
            {themes.map((t) => (
              <label key={t.id} className="syn-theme-check">
                <input type="checkbox" checked={themeIds.includes(t.id)} onChange={() => toggleTheme(t.id)} />
                {t.name}
              </label>
            ))}
          </div>
        </div>
        <label className="syn-field">
          <span>Source (livre, article, cours...)</span>
          <input className="syn-input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Pascal, Lettres provinciales, XVI" />
        </label>
        <label className="syn-field">
          <span>Annotations</span>
          <textarea className="syn-textarea" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Votre lecture, vos objections, vos rapprochements..." />
        </label>
        <div className="syn-modal-actions">
          {onDelete && (
            <button className="syn-btn syn-btn-danger" onClick={onDelete}>Supprimer</button>
          )}
          <div className="syn-spacer" />
          <button className="syn-btn" onClick={onClose}>Annuler</button>
          <button className="syn-btn syn-btn-primary" onClick={save} disabled={!title.trim()}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

.syn-root {
  --encre: #22303F;
  --encre-2: #46586B;
  --papier: #EDEFEA;
  --fiche: #FFFFFF;
  --vert: #2F5D50;
  --vert-clair: #E3ECE8;
  --filet: #C25E5E;
  --ligne: #D6DAD2;
  min-height: 100vh;
  background: var(--papier);
  color: var(--encre);
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 14px;
  padding: 32px clamp(16px, 4vw, 56px) 64px;
}
.syn-root * { box-sizing: border-box; }

/* ----- en-tête ----- */
.syn-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
.syn-header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.syn-header-actions { display: flex; gap: 8px; }
.syn-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vert); margin-bottom: 4px; }
.syn-title { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: clamp(32px, 5vw, 44px); line-height: 1; margin: 0; }
.syn-save { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--encre-2); min-height: 16px; }
.syn-save[data-state="error"] { color: var(--filet); }

/* ----- capture ----- */
.syn-capture-row { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(280px, 1.6fr); gap: 16px; margin-bottom: 40px; }
@media (max-width: 720px) { .syn-capture-row { grid-template-columns: 1fr; } }
.syn-panel { background: var(--fiche); border: 1px solid var(--ligne); border-radius: 6px; padding: 18px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.syn-panel-label { font-weight: 600; font-size: 14px; display: flex; gap: 10px; align-items: baseline; }
.syn-flash { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--vert); font-weight: 400; }
.syn-quick .syn-textarea { width: 100%; }

/* ----- sections ----- */
.syn-section-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; border-bottom: 1px solid var(--encre); padding-bottom: 10px; margin-bottom: 20px; }
.syn-section-head h2 { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 26px; margin: 0; }
.syn-sub { color: var(--encre-2); font-size: 13px; }
.syn-search { margin-left: auto; border: 1px solid var(--ligne); border-radius: 4px; padding: 6px 10px; font: inherit; background: var(--fiche); min-width: 180px; }
.syn-search:focus { outline: 2px solid var(--vert); outline-offset: 1px; }

/* ----- kanban ----- */
.syn-board-section { margin-bottom: 48px; }
.syn-board { display: flex; gap: 16px; align-items: flex-start; overflow-x: auto; padding-bottom: 12px; }
.syn-col { min-width: 240px; width: 240px; flex-shrink: 0; border-radius: 6px; padding: 4px; transition: background 0.15s; }
.syn-col-over { background: var(--vert-clair); }
.syn-col-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 10px; }
.syn-col-name { background: var(--vert-clair); color: var(--vert); font-weight: 600; font-size: 13px; padding: 2px 10px; border-radius: 3px; cursor: default; }
.syn-col-head-muted .syn-col-name { background: #E4E6E0; color: var(--encre-2); }
.syn-count { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--encre-2); }
.syn-x { margin-left: auto; border: none; background: none; color: var(--encre-2); font-size: 16px; cursor: pointer; line-height: 1; padding: 2px 4px; border-radius: 3px; opacity: 0; transition: opacity 0.15s; }
.syn-col-head:hover .syn-x, .syn-hidden-row:hover .syn-x { opacity: 1; }
.syn-x:hover { color: var(--filet); }

/* fiches : le filet rouge sous le titre est la signature visuelle */
.syn-card { background: var(--fiche); border: 1px solid var(--ligne); border-radius: 4px; padding: 12px 14px 10px; margin-bottom: 10px; cursor: pointer; box-shadow: 0 1px 2px rgba(34,48,63,0.06); transition: transform 0.12s, box-shadow 0.12s; }
.syn-card:hover { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(34,48,63,0.10); }
.syn-card-title { font-weight: 500; padding-bottom: 7px; border-bottom: 1px solid var(--filet); margin-bottom: 7px; }
.syn-card-source { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--vert); margin-bottom: 4px; }
.syn-card-notes { font-size: 12.5px; color: var(--encre-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.syn-load-more { display: block; width: 100%; border: 1px dashed var(--ligne); background: none; color: var(--encre-2); font: inherit; font-size: 12.5px; padding: 8px; border-radius: 4px; cursor: pointer; margin-top: 2px; margin-bottom: 10px; transition: border-color 0.12s, color 0.12s; }
.syn-load-more:hover { border-color: var(--vert); color: var(--vert); }

/* ----- groupes masqués ----- */
.syn-hidden { min-width: 220px; width: 220px; flex-shrink: 0; padding: 6px 8px; }
.syn-hidden-title { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--encre-2); margin-bottom: 12px; }
.syn-hidden-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.syn-hidden-empty { font-size: 12px; color: var(--encre-2); margin-bottom: 10px; }
.syn-hidden-add { display: flex; gap: 6px; margin-top: 8px; }
.syn-tag { background: #E4E6E0; color: var(--encre-2); font-size: 12px; font-weight: 500; padding: 2px 9px; border-radius: 3px; }
.syn-tag-blind { background: #F3E4E4; color: var(--filet); }
.syn-add-theme { border: none; background: none; color: var(--encre-2); font: inherit; font-size: 13px; cursor: pointer; padding: 4px 0; }
.syn-add-theme:hover { color: var(--vert); }

/* ----- analytique ----- */
.syn-ana-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.syn-ana-block { background: var(--fiche); border: 1px solid var(--ligne); border-radius: 6px; padding: 18px; }
.syn-ana-block h3 { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 19px; margin: 0 0 14px; }
.syn-bar-row { display: grid; grid-template-columns: 110px 1fr 24px; align-items: center; gap: 10px; margin-bottom: 8px; }
.syn-bar-label { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.syn-bar-label-muted { color: var(--encre-2); font-style: italic; }
.syn-bar-track { height: 8px; background: var(--papier); border-radius: 4px; overflow: hidden; }
.syn-bar-fill { height: 100%; background: var(--vert); border-radius: 4px; transition: width 0.3s; }
.syn-empty-text { font-size: 13px; color: var(--encre-2); margin: 0 0 10px; }
.syn-blind-list { display: flex; flex-wrap: wrap; gap: 6px; }

/* ----- contrôles ----- */
.syn-btn { border: 1px solid var(--ligne); background: var(--fiche); color: var(--encre); font: inherit; font-weight: 500; padding: 7px 16px; border-radius: 4px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
.syn-btn:hover:not(:disabled) { border-color: var(--vert); }
.syn-btn:disabled { opacity: 0.45; cursor: default; }
.syn-btn-primary { background: var(--vert); border-color: var(--vert); color: #fff; }
.syn-btn-sm { padding: 5px 12px; font-size: 13px; }
.syn-btn-primary:hover:not(:disabled) { background: #264B41; }
.syn-btn-danger { border-color: var(--filet); color: var(--filet); background: none; }
.syn-btn-danger:hover { background: #F3E4E4; }
.syn-input, .syn-textarea { border: 1px solid var(--ligne); border-radius: 4px; padding: 8px 10px; font: inherit; background: var(--fiche); color: var(--encre); width: 100%; }
.syn-input:focus, .syn-textarea:focus, .syn-btn:focus-visible { outline: 2px solid var(--vert); outline-offset: 1px; }
.syn-input-sm { padding: 3px 8px; font-size: 13px; width: 130px; }
.syn-textarea { resize: vertical; }

/* ----- modale ----- */
.syn-overlay { position: fixed; inset: 0; background: rgba(34,48,63,0.42); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 50; }
.syn-modal { background: var(--fiche); border-radius: 8px; padding: 26px 28px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; box-shadow: 0 16px 48px rgba(34,48,63,0.25); }
.syn-modal-rule { height: 2px; background: var(--filet); margin: -26px -28px 20px; border-radius: 8px 8px 0 0; }
.syn-modal-title { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 24px; margin: 0 0 18px; }
.syn-field { display: block; margin-bottom: 14px; }
.syn-field > span { display: block; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: var(--encre-2); margin-bottom: 5px; }
.syn-theme-checks { display: flex; flex-wrap: wrap; gap: 6px 14px; max-height: 160px; overflow-y: auto; padding: 10px; border: 1px solid var(--ligne); border-radius: 4px; background: var(--papier); }
.syn-theme-check { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.syn-theme-check input { cursor: pointer; }
.syn-modal-actions { display: flex; gap: 10px; align-items: center; margin-top: 20px; }
.syn-spacer { flex: 1; }

@media (prefers-reduced-motion: reduce) {
  .syn-card, .syn-bar-fill, .syn-btn, .syn-col { transition: none; }
}
`;

/* Montage de l'application dans la page. */
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<Syntopicon />);

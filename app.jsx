const { useState, useEffect, useRef, useMemo } = React;

/*
  Persistance pour hébergement statique (GitHub Pages).
  Aucun serveur, aucun jeton : les saisies sont enregistrées en continu dans
  le stockage local du navigateur (localStorage). Les boutons Exporter et
  Importer permettent de produire et de recharger un fichier syntopicon.json,
  qui reste votre sauvegarde réelle, transportable et versionnable dans Git.
  Au tout premier chargement (stockage local vide), l'application tente de lire
  un syntopicon.json présent dans le dépôt pour servir de corpus de départ.
*/
const storage = {
  async get() {
    // 1. Copie de travail dans ce navigateur.
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) return { value: local };
    // 2. Corpus publié, versé dans le dépôt (premier chargement seulement).
    try {
      const r = await fetch("./syntopicon.json", { cache: "no-store" });
      if (r.ok) {
        const obj = await r.json();
        if (obj && Object.keys(obj).length > 0) return { value: JSON.stringify(obj) };
      }
    } catch (e) {
      // Pas de fichier publié : on partira du modèle de base.
    }
    return null;
  },
  async set(_key, value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
      return true;
    } catch (e) {
      return false;
    }
  },
};

/*
  SYNTOPICON : espace de travail personnel inspiré du Syntopicon d'Adler.
  Vue Kanban par thème (propriété de sélection unique), capture rapide,
  groupes masqués, analytique des idées. Données enregistrées en local et
  exportables en JSON. Esthétique : fiches de lecture / catalogue de bibliothèque.
*/

const STORAGE_KEY = "syntopicon:data";

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
      }
    }
    const existingIds = new Set(d.entries.map((e) => e.id));
    for (const e of batch.entries) {
      if (existingIds.has(e.id)) continue;
      d.entries.push({
        id: e.id,
        title: e.title,
        themeId: themeIdByName[e.theme.toLowerCase()] || null,
        source: e.source,
        notes: e.notes,
        createdAt: Date.now(),
      });
    }
    d.importedBatches.push(batch.id);
    changed = true;
  }
  return { data: d, changed };
}

function Syntopicon() {
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
  const saveTimer = useRef(null);
  const fileInputRef = useRef(null);

  /* ---------- chargement ---------- */
  useEffect(() => {
    (async () => {
      let base = SEED;
      try {
        const res = await storage.get();
        if (res && res.value) base = JSON.parse(res.value);
      } catch (e) {
        // clé inexistante lors de la première visite : on initialise
      }
      const { data: merged, changed } = mergeImports(base);
      setData(merged);
      if (changed) {
        try {
          await storage.set(STORAGE_KEY, JSON.stringify(merged));
          setSaveState("saved");
        } catch (e) {
          setSaveState("error");
        }
      }
    })();
  }, []);

  /* ---------- persistance ---------- */
  const persist = (next) => {
    setData(next);
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const ok = await storage.set(STORAGE_KEY, JSON.stringify(next));
        setSaveState(ok ? "saved" : "error");
      } catch (e) {
        setSaveState("error");
      }
    }, 400);
  };

  /* ---------- mutations ---------- */
  const addEntry = (entry) => {
    const e = {
      id: uid("en"),
      title: entry.title.trim(),
      themeId: entry.themeId || null,
      source: (entry.source || "").trim(),
      notes: (entry.notes || "").trim(),
      createdAt: Date.now(),
    };
    persist({ ...data, entries: [e, ...data.entries] });
  };

  const updateEntry = (id, patch) => {
    persist({
      ...data,
      entries: data.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  };

  const deleteEntry = (id) => {
    persist({ ...data, entries: data.entries.filter((e) => e.id !== id) });
    setEditing(null);
  };

  const addTheme = (name) => {
    const n = name.trim();
    if (!n) return;
    if (data.themes.some((t) => t.name.toLowerCase() === n.toLowerCase())) return;
    persist({ ...data, themes: [...data.themes, { id: uid("th"), name: n }] });
  };

  const renameTheme = (id, name) => {
    const n = name.trim();
    if (!n) return;
    persist({
      ...data,
      themes: data.themes.map((t) => (t.id === id ? { ...t, name: n } : t)),
    });
  };

  const deleteTheme = (id) => {
    persist({
      themes: data.themes.filter((t) => t.id !== id),
      entries: data.entries.map((e) =>
        e.themeId === id ? { ...e, themeId: null } : e
      ),
    });
  };

  const quickCapture = () => {
    const t = quickText.trim();
    if (!t) return;
    const firstLine = t.split("\n")[0];
    addEntry({
      title: firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine,
      notes: t === firstLine ? "" : t,
      themeId: null,
    });
    setQuickText("");
    setQuickFlash(true);
    setTimeout(() => setQuickFlash(false), 1500);
  };

  /* ---------- export / import ---------- */
  const exportData = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "syntopicon.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (!obj || !Array.isArray(obj.themes) || !Array.isArray(obj.entries)) {
          window.alert(
            "Fichier invalide : il doit contenir les champs « themes » et « entries »."
          );
          return;
        }
        persist({
          themes: obj.themes,
          entries: obj.entries,
          importedBatches: Array.isArray(obj.importedBatches)
            ? obj.importedBatches
            : [],
        });
      } catch (err) {
        window.alert("Impossible de lire ce fichier JSON.");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // autorise le réimport du même fichier
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
      if (e.themeId && map[e.themeId]) map[e.themeId].push(e);
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
  if (!data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#EDEFEA", fontFamily: "'IBM Plex Sans', sans-serif", color: "#22303F" }}>
        {loadError ? "Impossible de charger vos données." : "Ouverture du catalogue..."}
      </div>
    );
  }

  const editingEntry = editing ? data.entries.find((e) => e.id === editing) : null;
  const maxCount = Math.max(1, ...data.themes.map((t) => data.entries.filter((e) => e.themeId === t.id).length), data.entries.filter((e) => !e.themeId).length);

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
            {saveState === "saved" && "Enregistré dans ce navigateur"}
            {saveState === "error" && "Erreur d'enregistrement, réessayez"}
          </div>
          <div className="syn-header-actions">
            <button className="syn-btn syn-btn-sm" onClick={exportData}>
              Exporter le JSON
            </button>
            <button
              className="syn-btn syn-btn-sm"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
            >
              Importer
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={importData}
            />
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
              onOpen={setEditing}
              onRename={renameTheme}
              onDelete={deleteTheme}
              dragOver={dragOver === t.id}
              onDragOver={(e) => { e.preventDefault(); setDragOver(t.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => {
                if (dragId) updateEntry(dragId, { themeId: t.id });
                setDragId(null); setDragOver(null);
              }}
              onDragStart={setDragId}
            />
          ))}

          {byTheme.none.length > 0 && (
            <Column
              theme={{ id: "none", name: "Sans thème" }}
              entries={byTheme.none}
              onOpen={setEditing}
              muted
              dragOver={dragOver === "none"}
              onDragOver={(e) => { e.preventDefault(); setDragOver("none"); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => {
                if (dragId) updateEntry(dragId, { themeId: null });
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
              const n = data.entries.filter((e) => e.themeId === t.id).length;
              return <Bar key={t.id} label={t.name} n={n} max={maxCount} />;
            })}
            <Bar label="Sans thème" n={data.entries.filter((e) => !e.themeId).length} max={maxCount} muted />
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
function Column({ theme, entries, onOpen, onRename, onDelete, muted, dragOver, onDragOver, onDragLeave, onDrop, onDragStart }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(theme.name);

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
      {entries.map((e) => (
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
  const [themeId, setThemeId] = useState(entry ? entry.themeId || "" : "");
  const [source, setSource] = useState(entry ? entry.source : "");
  const [notes, setNotes] = useState(entry ? entry.notes : "");

  const save = () => {
    if (!title.trim()) return;
    onSave({ title: title.trim(), themeId: themeId || null, source, notes });
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
        <label className="syn-field">
          <span>Thème syntopique</span>
          <select className="syn-input" value={themeId} onChange={(e) => setThemeId(e.target.value)}>
            <option value="">Sans thème</option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
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
.syn-modal-actions { display: flex; gap: 10px; align-items: center; margin-top: 20px; }
.syn-spacer { flex: 1; }

@media (prefers-reduced-motion: reduce) {
  .syn-card, .syn-bar-fill, .syn-btn, .syn-col { transition: none; }
}
`;

/* Montage de l'application dans la page. */
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<Syntopicon />);

const { useState, useEffect, useMemo } = React;

/*
  Persistance via Supabase (base de données + authentification).
  Le site est privé : tant que vous n'êtes pas connecté, aucune donnée n'est
  chargée ni affichée. Une fois connecté, la session reste enregistrée dans ce
  navigateur (vous ne vous reconnectez plus sur cet appareil). SUPABASE_URL et
  SUPABASE_ANON_KEY viennent de supabase-config.js (voir README.md).
*/
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Correspondance champ JS (camelCase) <-> colonne Supabase (snake_case) pour la référence bibliographique. */
const REF_FIELD_COLUMNS = {
  refType: "ref_type",
  refAuthors: "ref_authors",
  refTitle: "ref_title",
  refContainer: "ref_container",
  refPublisher: "ref_publisher",
  refYear: "ref_year",
  refEdition: "ref_edition",
  refPages: "ref_pages",
  refIsbn: "ref_isbn",
  refDoi: "ref_doi",
};
const REF_COLUMNS = Object.values(REF_FIELD_COLUMNS);
const REF_SELECT = REF_COLUMNS.join(",");
const todayStr = () => new Date().toISOString().slice(0, 10);

/* Texte de recherche d'une fiche : titre, notes, réflexion et toute la référence bibliographique. */
function searchHaystack(e) {
  return [e.title, e.notes, e.reflection, ...Object.keys(REF_FIELD_COLUMNS).map((f) => e[f])]
    .join(" ")
    .toLowerCase();
}

/* Liens (entrants et sortants) d'une fiche, résolus avec le titre de l'autre fiche. */
function resolveEntryLinks(entryId, links, entries) {
  return (links || [])
    .filter((l) => l.fromId === entryId || l.toId === entryId)
    .map((l) => {
      const outgoing = l.fromId === entryId;
      const other = (entries || []).find((e) => e.id === (outgoing ? l.toId : l.fromId));
      return other ? { id: l.id, relation: l.relation, outgoing, other } : null;
    })
    .filter(Boolean);
}

/* Palette pastel pour distinguer les thèmes (fond clair + texte assorti, contraste
   ≥ 4,5:1 vérifié sur le fond pastel et sur le papier). Ordre fixe : chaque thème
   garde la même couleur tant que sa position dans la liste ne change pas. */
const THEME_COLORS = [
  { bg: "#F1E2DA", text: "#905537" }, // argile
  { bg: "#F1EFDA", text: "#6F692A" }, // ocre
  { bg: "#E4F1DA", text: "#49732B" }, // mousse
  { bg: "#DAEBF1", text: "#316D81" }, // sarcelle
  { bg: "#DADEF1", text: "#4659B9" }, // bleu
  { bg: "#E4DAF1", text: "#7646B9" }, // violet
  { bg: "#F1DAF1", text: "#983A98" }, // prune
  { bg: "#F1DAE4", text: "#A33E68" }, // mauve
];

/* Au-delà des 8 couleurs préréglées, une teinte est générée à la volée (angle d'or,
   une technique classique pour répartir un nombre quelconque de teintes aussi loin
   les unes des autres que possible sur le cercle chromatique), avec le même calcul
   de contraste texte/fond que pour les 8 premières. Ainsi, chaque thème garde une
   couleur qui lui est propre, quel que soit le nombre de thèmes créés. */
const THEME_SURFACE = "#EDEFEA"; // papier
const THEME_RESERVED_HUES = [163, 0]; // vert et filet, déjà utilisés ailleurs dans l'appli

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return ("#" + rgb.map(toHex).join("")).toUpperCase();
}

function relLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(hex1, hex2) {
  const l1 = relLuminance(hex1);
  const l2 = relLuminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function generateThemeColor(index) {
  const GOLDEN_ANGLE = 137.508;
  let hue = (40 + (index - THEME_COLORS.length) * GOLDEN_ANGLE) % 360;
  hue = ((hue % 360) + 360) % 360;
  THEME_RESERVED_HUES.forEach((reserved) => {
    const d = Math.min(Math.abs(hue - reserved), 360 - Math.abs(hue - reserved));
    if (d < 18) hue = (hue + 25) % 360;
  });
  const bg = hslToHex(hue, 0.45, 0.9);
  let l = 0.5;
  let text = hslToHex(hue, 0.45, l);
  while ((contrastRatio(text, bg) < 4.6 || contrastRatio(text, THEME_SURFACE) < 4.6) && l > 0.1) {
    l -= 0.01;
    text = hslToHex(hue, 0.45, l);
  }
  return { bg, text };
}

function themeColor(themeId, allThemes) {
  const idx = (allThemes || []).findIndex((t) => t.id === themeId);
  const i = idx < 0 ? 0 : idx;
  return i < THEME_COLORS.length ? THEME_COLORS[i] : generateThemeColor(i);
}

/* ---------- Suggestions de rapprochement (mots-clés communs, pondérés) ---------- */
/* Mots structurels/grammaticaux : connecteurs logiques, pronoms, formes très
   courantes des verbes être/avoir/faire/pouvoir/devoir, adverbes courants.
   Ne couvre pas le vocabulaire "banal mais spécifique au corpus" (ex : un mot
   qui revient dans la moitié de vos fiches) : ce cas est traité séparément,
   de façon adaptative, par la pondération par fréquence ci-dessous. */
const SUGGESTION_STOPWORDS = new Set([
  "dans", "avec", "pour", "sans", "sous", "vers", "chez", "entre", "depuis", "pendant",
  "selon", "avant", "après", "contre", "malgré", "sauf",
  "donc", "ainsi", "alors", "ensuite", "enfin", "cependant", "néanmoins", "toutefois",
  "pourtant", "lorsque", "tandis", "quoique", "puisque", "comme", "quand", "dont", "or",
  "car", "chaque", "quel", "quelle", "quels", "quelles", "même", "mêmes",
  "certain", "certains", "certaine", "certaines", "plusieurs", "aucun", "aucune",
  "chacun", "chacune", "celui", "celle", "ceux", "celles", "cela", "ceci",
  "elle", "elles", "nous", "vous", "ils", "leur", "leurs", "notre", "votre", "nos", "vos",
  "tout", "tous", "toute", "toutes", "autre", "autres",
  "être", "étais", "était", "étions", "étiez", "étaient", "serai", "seras", "sera",
  "serons", "serez", "seront", "avoir", "avais", "avait", "avions", "aviez", "avaient",
  "aurai", "auras", "aura", "aurons", "aurez", "auront",
  "fait", "faisait", "faisons", "faites", "font", "ferai", "feras", "fera", "ferons",
  "ferez", "feront",
  "peut", "peux", "peuvent", "pouvait", "pourra", "pourrait",
  "doit", "doivent", "devait", "devrait",
  "très", "bien", "aussi", "encore", "jamais", "toujours", "souvent", "parfois",
  "plutôt", "surtout", "seulement", "beaucoup", "assez", "trop", "moins", "plus",
]);

/* Mots significatifs (4+ lettres, hors mots vides) d'un texte, en minuscules. */
function extractKeywords(text) {
  const words = (text || "").toLowerCase().match(/[a-zà-öø-ÿ]{4,}/g) || [];
  return new Set(words.filter((w) => !SUGGESTION_STOPWORDS.has(w)));
}

/* Ordonne une paire d'identifiants de fiches de façon stable (pour la clé de dismissal). */
function pairKey(id1, id2) {
  return id1 < id2 ? [id1, id2] : [id2, id1];
}

/* Un mot-clé compte d'autant plus qu'il est rare dans l'ensemble du corpus
   (façon TF-IDF) ; un mot qui revient dans une grosse part de vos fiches
   (par ex. un terme récurrent de votre vocabulaire de recherche) est
   automatiquement écarté, même s'il n'est pas dans la liste de mots vides. */
const SUGGESTION_MAX_DOC_SHARE = 0.25; // au-delà de 25% des fiches, un mot est jugé trop commun
const SUGGESTION_MIN_SHARED = 2; // au moins 2 mots-clés distinctifs communs
const SUGGESTION_MIN_SCORE = 3; // score cumulé minimal (somme des poids des mots partagés)

/* Calcule des suggestions de liens entre fiches non déjà liées, à partir des
   mots-clés communs (pondérés par rareté) à leur titre et leurs notes. */
function computeSuggestions(entries, links, dismissedSuggestions, limit) {
  const withKeywords = entries
    .map((e) => ({ entry: e, keywords: new Set([...extractKeywords(e.title), ...extractKeywords(e.notes)]) }))
    .filter((x) => x.keywords.size > 0);

  const n = withKeywords.length;
  if (n < 2) return [];

  const docFrequency = {};
  withKeywords.forEach((x) => {
    x.keywords.forEach((k) => { docFrequency[k] = (docFrequency[k] || 0) + 1; });
  });
  const maxDocCount = Math.max(3, Math.ceil(n * SUGGESTION_MAX_DOC_SHARE));
  const weight = {};
  Object.keys(docFrequency).forEach((k) => {
    if (docFrequency[k] > maxDocCount) return; // trop commun dans ce corpus précis : ignoré
    weight[k] = Math.log(n / docFrequency[k]);
  });

  const linkedPairs = new Set();
  links.forEach((l) => {
    linkedPairs.add(l.fromId + "|" + l.toId);
    linkedPairs.add(l.toId + "|" + l.fromId);
  });
  const dismissedPairs = new Set(dismissedSuggestions.map((d) => d.aId + "|" + d.bId));

  const results = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = withKeywords[i];
      const b = withKeywords[j];
      if (linkedPairs.has(a.entry.id + "|" + b.entry.id)) continue;
      const [x, y] = pairKey(a.entry.id, b.entry.id);
      if (dismissedPairs.has(x + "|" + y)) continue;
      const shared = [...a.keywords].filter((k) => b.keywords.has(k) && weight[k] !== undefined);
      if (shared.length < SUGGESTION_MIN_SHARED) continue;
      const score = shared.reduce((s, k) => s + weight[k], 0);
      if (score < SUGGESTION_MIN_SCORE) continue;
      shared.sort((k1, k2) => weight[k2] - weight[k1]);
      results.push({ a: a.entry, b: b.entry, shared, score });
    }
  }
  results.sort((r1, r2) => r2.score - r1.score);
  return results.slice(0, limit);
}

/* Charge themes/entries (+ leurs thèmes N-N et leurs liens)/imported_batches de l'utilisateur connecté. */
async function fetchRemoteData(userId) {
  const [
    { data: themes, error: te },
    { data: entries, error: ee },
    { data: themeLinks, error: tle },
    { data: entryLinks, error: ele },
    { data: batches, error: be },
    { data: dismissed, error: de },
  ] = await Promise.all([
    sb.from("themes").select("id,name").eq("owner_id", userId).order("name"),
    sb
      .from("entries")
      .select(`id,title,notes,reflection,captured_at,${REF_SELECT},deleted_at,created_at`)
      .eq("owner_id", userId)
      .order("created_at", { ascending: false }),
    sb.from("entry_themes").select("entry_id,theme_id").eq("owner_id", userId),
    sb.from("entry_links").select("id,from_entry_id,to_entry_id,relation").eq("owner_id", userId),
    sb.from("imported_batches").select("id").eq("owner_id", userId),
    sb.from("dismissed_suggestions").select("entry_a_id,entry_b_id").eq("owner_id", userId),
  ]);
  if (te || ee || tle || ele || be || de) throw te || ee || tle || ele || be || de;
  const themeIdsByEntry = {};
  (themeLinks || []).forEach((l) => {
    if (!themeIdsByEntry[l.entry_id]) themeIdsByEntry[l.entry_id] = [];
    themeIdsByEntry[l.entry_id].push(l.theme_id);
  });
  return {
    themes: themes || [],
    entries: (entries || []).map((e) => {
      const entry = {
        id: e.id,
        title: e.title,
        themeIds: themeIdsByEntry[e.id] || [],
        notes: e.notes || "",
        reflection: e.reflection || "",
        capturedAt: e.captured_at || todayStr(),
        deletedAt: e.deleted_at ? new Date(e.deleted_at).getTime() : null,
        createdAt: new Date(e.created_at).getTime(),
      };
      Object.entries(REF_FIELD_COLUMNS).forEach(([jsField, column]) => {
        entry[jsField] = e[column] || "";
      });
      return entry;
    }),
    links: (entryLinks || []).map((l) => ({ id: l.id, fromId: l.from_entry_id, toId: l.to_entry_id, relation: l.relation })),
    dismissedSuggestions: (dismissed || []).map((d) => ({ aId: d.entry_a_id, bId: d.entry_b_id })),
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
      entries.map((e) => {
        const row = {
          id: e.id,
          title: e.title,
          notes: e.notes,
          reflection: e.reflection || "",
          captured_at: e.capturedAt || todayStr(),
          owner_id: userId,
        };
        Object.entries(REF_FIELD_COLUMNS).forEach(([jsField, column]) => {
          row[column] = e[jsField] || "";
        });
        return row;
      })
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
  links: [],
  dismissedSuggestions: [],
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
        notes: "L'ouverture du livre juxtapose le supplice de Damiens (1757) et le règlement de la maison des jeunes détenus de Paris (1838). En moins d'un siècle, le châtiment-spectacle disparaît au profit d'une pénalité sourde de l'emploi du temps. Ce n'est pas un adoucissement mais un changement d'économie punitive.",
      },
      {
        id: "en_fsp_ame",
        title: "La punition vise l'âme et non plus le corps",
        theme: "Punition",
        notes: "Déplacement de l'objet punitif : on ne châtie plus le corps, on corrige l'âme (penchants, volonté, dispositions). D'où le renversement de la formule chrétienne : l'âme devient la prison du corps.",
      },
      {
        id: "en_fsp_panoptique",
        title: "Le panoptique de Bentham",
        theme: "Pouvoir et discipline",
        notes: "Architecture induisant un état conscient et permanent de visibilité. Le détenu, ne sachant jamais s'il est observé, devient le principe de son propre assujettissement. Le pouvoir s'automatise et se désindividualise : il tient au dispositif, non à une personne.",
      },
      {
        id: "en_fsp_pouvoirsavoir",
        title: "Pouvoir-savoir",
        theme: "Connaissance",
        notes: "Pouvoir et savoir s'impliquent directement l'un l'autre : il n'y a pas de relation de pouvoir sans constitution corrélative d'un champ de savoir, ni de savoir qui ne suppose et ne constitue en même temps des relations de pouvoir.",
      },
      {
        id: "en_fsp_corpsdociles",
        title: "Les corps dociles",
        theme: "Pouvoir et discipline",
        notes: "La discipline fabrique des corps soumis et exercés. Techniques de répartition des individus dans l'espace : clôture, quadrillage, emplacements fonctionnels, rang. Le corps devient objet et cible d'un pouvoir qui le travaille dans le détail.",
      },
      {
        id: "en_fsp_examen",
        title: "L'examen : surveiller et normaliser",
        theme: "Pouvoir et discipline",
        notes: "L'examen combine la surveillance hiérarchique et la sanction normalisatrice. Il fait de chaque individu un cas : descriptible, mesurable, comparable. L'individu entre dans un champ documentaire (registres, dossiers) qui le constitue comme objet de savoir.",
      },
      {
        id: "en_fsp_delinquance",
        title: "La prison fabrique la délinquance",
        theme: "Punition",
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
    links: [...(base.links || [])],
    dismissedSuggestions: [...(base.dismissedSuggestions || [])],
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
        notes: e.notes,
        reflection: "",
        capturedAt: todayStr(),
        refType: "",
        refAuthors: "",
        refTitle: "",
        refContainer: "",
        refPublisher: "",
        refYear: "",
        refEdition: "",
        refPages: "",
        refIsbn: "",
        refDoi: "",
        deletedAt: null,
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
  const [viewing, setViewing] = useState(null); // entry id, visualisation en lecture seule
  const [creating, setCreating] = useState(false);
  const [newTheme, setNewTheme] = useState("");
  const [addingTheme, setAddingTheme] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [search, setSearch] = useState("");
  const [reflectionFilter, setReflectionFilter] = useState("all"); // all | with | without
  const [showTrash, setShowTrash] = useState(false);

  /* ---------- authentification ---------- */
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = sb.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  /* Échap ferme la fenêtre actuellement ouverte, sans avoir à cliquer manuellement. */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (viewing) setViewing(null);
      else if (editing) setEditing(null);
      else if (creating) setCreating(false);
      else if (showTrash) setShowTrash(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [viewing, editing, creating, showTrash]);

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
      notes: (entry.notes || "").trim(),
      reflection: (entry.reflection || "").trim(),
      capturedAt: entry.capturedAt || todayStr(),
      deletedAt: null,
      createdAt: Date.now(),
    };
    Object.keys(REF_FIELD_COLUMNS).forEach((jsField) => {
      e[jsField] = (entry[jsField] || "").trim();
    });
    setSaveState("saving");
    const row = {
      id: e.id,
      title: e.title,
      notes: e.notes,
      reflection: e.reflection,
      captured_at: e.capturedAt,
      owner_id: session.user.id,
    };
    Object.entries(REF_FIELD_COLUMNS).forEach(([jsField, column]) => {
      row[column] = e[jsField];
    });
    const { error } = await sb.from("entries").insert(row);
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
    if ("notes" in patch) dbPatch.notes = patch.notes;
    if ("reflection" in patch) dbPatch.reflection = patch.reflection;
    if ("capturedAt" in patch) dbPatch.captured_at = patch.capturedAt;
    Object.entries(REF_FIELD_COLUMNS).forEach(([jsField, column]) => {
      if (jsField in patch) dbPatch[column] = patch[jsField];
    });
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

  /* Suppression douce : la fiche part à la corbeille, récupérable tant qu'on ne la vide pas. */
  const deleteEntry = async (id) => {
    setSaveState("saving");
    const deletedAtIso = new Date().toISOString();
    const { error } = await sb.from("entries").update({ deleted_at: deletedAtIso }).eq("id", id);
    if (error) {
      setSaveState("error");
      return;
    }
    setData((d) => ({
      ...d,
      entries: d.entries.map((e) => (e.id === id ? { ...e, deletedAt: new Date(deletedAtIso).getTime() } : e)),
    }));
    setSaveState("saved");
    setEditing(null);
  };

  const restoreEntry = async (id) => {
    setSaveState("saving");
    const { error } = await sb.from("entries").update({ deleted_at: null }).eq("id", id);
    if (error) {
      setSaveState("error");
      return;
    }
    setData((d) => ({ ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, deletedAt: null } : e)) }));
    setSaveState("saved");
  };

  /* Suppression définitive : irréversible, seulement possible depuis la corbeille. */
  const purgeEntry = async (id) => {
    setSaveState("saving");
    const { error } = await sb.from("entries").delete().eq("id", id);
    if (error) {
      setSaveState("error");
      return;
    }
    setData((d) => ({
      ...d,
      entries: d.entries.filter((e) => e.id !== id),
      links: d.links.filter((l) => l.fromId !== id && l.toId !== id),
    }));
    setSaveState("saved");
  };

  /* Lie une fiche à plusieurs autres en une seule fois, avec la même relation. */
  const addLinks = async (fromId, toIds, relation) => {
    const existing = new Set(
      data.links.filter((l) => l.fromId === fromId && l.relation === relation).map((l) => l.toId)
    );
    const newLinks = toIds.filter((toId) => !existing.has(toId)).map((toId) => ({ id: uid("lk"), fromId, toId, relation }));
    if (!newLinks.length) return;
    setSaveState("saving");
    const { error } = await sb.from("entry_links").insert(
      newLinks.map((l) => ({ id: l.id, from_entry_id: l.fromId, to_entry_id: l.toId, relation: l.relation, owner_id: session.user.id }))
    );
    if (error) {
      setSaveState("error");
      return;
    }
    setData((d) => ({ ...d, links: [...d.links, ...newLinks] }));
    setSaveState("saved");
  };

  const deleteLink = async (id) => {
    setSaveState("saving");
    const { error } = await sb.from("entry_links").delete().eq("id", id);
    if (error) {
      setSaveState("error");
      return;
    }
    setData((d) => ({ ...d, links: d.links.filter((l) => l.id !== id) }));
    setSaveState("saved");
  };

  /* Accepter une suggestion crée un lien générique "en lien avec" entre les deux fiches. */
  const acceptSuggestion = (aId, bId) => addLinks(aId, [bId], "lien");

  const dismissSuggestion = async (aId, bId) => {
    const [x, y] = pairKey(aId, bId);
    setSaveState("saving");
    const { error } = await sb.from("dismissed_suggestions").insert({ entry_a_id: x, entry_b_id: y, owner_id: session.user.id });
    if (error) {
      setSaveState("error");
      return;
    }
    setData((d) => ({ ...d, dismissedSuggestions: [...d.dismissedSuggestions, { aId: x, bId: y }] }));
    setSaveState("saved");
  };

  /* Retourne le thème (existant ou nouvellement créé) pour permettre de le sélectionner aussitôt. */
  const addTheme = async (name) => {
    const n = name.trim();
    if (!n) return null;
    const existing = data.themes.find((t) => t.name.toLowerCase() === n.toLowerCase());
    if (existing) return existing;
    const t = { id: uid("th"), name: n };
    setSaveState("saving");
    const { error } = await sb.from("themes").insert({ id: t.id, name: t.name, owner_id: session.user.id });
    if (error) {
      setSaveState("error");
      return null;
    }
    setData((d) => ({ ...d, themes: [...d.themes, t] }));
    setSaveState("saved");
    return t;
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

  const exportRis = () => {
    const ris = buildRis(activeEntries);
    if (!ris.trim()) {
      window.alert("Aucune fiche avec une référence à exporter pour l'instant.");
      return;
    }
    const blob = new Blob([ris], { type: "application/x-research-info-systems" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "syntopicon.ris";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ---------- dérivés ---------- */
  const linkCounts = useMemo(() => {
    const m = {};
    if (!data) return m;
    data.links.forEach((l) => {
      m[l.fromId] = (m[l.fromId] || 0) + 1;
      m[l.toId] = (m[l.toId] || 0) + 1;
    });
    return m;
  }, [data]);

  const activeEntries = useMemo(() => (data ? data.entries.filter((e) => !e.deletedAt) : []), [data]);
  const trashEntries = useMemo(() => (data ? data.entries.filter((e) => e.deletedAt) : []), [data]);

  /* Une fiche différente mise en avant toutes les 4 heures, pour la relire sans la chercher.
     Choix déterministe (par id trié, indexé par la période courante) : stable pendant
     4 heures, identique sur tous vos appareils, et parcourt l'ensemble de vos fiches
     au fil du temps plutôt que de retomber au hasard toujours sur les mêmes. */
  const entryOfDay = useMemo(() => {
    if (!activeEntries.length) return null;
    const sorted = [...activeEntries].sort((a, b) => a.id.localeCompare(b.id));
    const rotationPeriodMs = 4 * 60 * 60 * 1000;
    const periodIndex = Math.floor(Date.now() / rotationPeriodMs) % sorted.length;
    return sorted[periodIndex];
  }, [activeEntries]);

  const suggestions = useMemo(() => {
    if (!data) return [];
    return computeSuggestions(activeEntries, data.links, data.dismissedSuggestions, 12);
  }, [activeEntries, data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeEntries.filter((e) => {
      if (reflectionFilter === "with" && !e.reflection.trim()) return false;
      if (reflectionFilter === "without" && e.reflection.trim()) return false;
      return !q || searchHaystack(e).includes(q);
    });
  }, [activeEntries, search, reflectionFilter]);

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

  /* Regroupe par auteur(s)+titre (la page est volontairement exclue : sinon chaque
     page d'un même livre compterait comme une provenance différente). */
  const provenances = useMemo(() => {
    const byWork = new Map();
    activeEntries.forEach((e) => {
      const authors = e.refAuthors.trim();
      const title = e.refTitle.trim();
      const hasWork = authors || title;
      const sig = hasWork ? (authors + "|" + title).toLowerCase() : "__sans_reference__";
      const label = hasWork ? [e.refAuthors, e.refTitle].filter(Boolean).join(" — ") : "Sans référence";
      const cur = byWork.get(sig);
      if (cur) cur.count += 1;
      else byWork.set(sig, { label, count: 1 });
    });
    return Array.from(byWork.values()).sort((a, b) => b.count - a.count);
  }, [activeEntries]);

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

  const editingEntry = editing ? activeEntries.find((e) => e.id === editing) : null;
  const viewingEntry = viewing ? activeEntries.find((e) => e.id === viewing) : null;
  const maxCount = Math.max(
    1,
    ...data.themes.map((t) => activeEntries.filter((e) => e.themeIds.includes(t.id)).length),
    activeEntries.filter((e) => e.themeIds.length === 0).length
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
            <button className="syn-btn syn-btn-sm" onClick={exportRis} title="Génère un fichier .ris importable dans Zotero, EndNote, etc.">
              Exporter en RIS
            </button>
            <button className="syn-btn syn-btn-sm" onClick={() => setShowTrash(true)}>
              Corbeille{trashEntries.length > 0 ? ` (${trashEntries.length})` : ""}
            </button>
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
        <div className="syn-panel syn-daily">
          <div className="syn-panel-label">📖 Fiche du jour</div>
          {entryOfDay ? (
            <button type="button" className="syn-daily-card" onClick={() => setViewing(entryOfDay.id)}>
              <div className="syn-daily-title">{entryOfDay.title}</div>
              {entryOfDay.notes && <div className="syn-daily-notes">{entryOfDay.notes}</div>}
            </button>
          ) : (
            <p className="syn-empty-text">Aucune fiche à relire pour l'instant.</p>
          )}
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
          <select
            className="syn-search syn-reflection-filter"
            value={reflectionFilter}
            onChange={(e) => setReflectionFilter(e.target.value)}
            title="Filtrer selon la présence d'une réflexion personnelle"
          >
            <option value="all">Toutes les fiches</option>
            <option value="with">Avec réflexion</option>
            <option value="without">Sans réflexion</option>
          </select>
        </div>

        <div className="syn-board">
          {visibleThemes.map((t) => (
            <Column
              key={t.id}
              theme={t}
              entries={byTheme[t.id]}
              allThemes={data.themes}
              allEntries={activeEntries}
              links={data.links}
              linkCounts={linkCounts}
              unlimited={Boolean(search.trim())}
              onOpen={setEditing}
              onView={setViewing}
              onRename={renameTheme}
              onDelete={deleteTheme}
              dragOver={dragOver === t.id}
              onDragOver={(e) => { e.preventDefault(); setDragOver(t.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => {
                if (dragId) {
                  const dragged = activeEntries.find((e) => e.id === dragId);
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
              allThemes={data.themes}
              allEntries={activeEntries}
              links={data.links}
              linkCounts={linkCounts}
              unlimited={Boolean(search.trim())}
              onOpen={setEditing}
              onView={setViewing}
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
            {hiddenThemes.map((t) => {
              const tc = themeColor(t.id, data.themes);
              return (
                <div key={t.id} className="syn-hidden-row">
                  <span className="syn-tag" style={{ background: tc.bg, color: tc.text }}>{t.name}</span>
                  <span className="syn-count">0</span>
                  <button className="syn-x" title="Supprimer ce thème" onClick={() => deleteTheme(t.id)}>×</button>
                </div>
              );
            })}
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

      {/* ===== Suggestions de liens ===== */}
      <section className="syn-suggestions">
        <div className="syn-section-head">
          <h2>Rapprochements suggérés</h2>
          <span className="syn-sub">Fiches partageant des mots-clés, que vous n'avez peut-être pas remarquées</span>
        </div>
        {suggestions.length === 0 ? (
          <p className="syn-empty-text">Aucun rapprochement évident pour l'instant.</p>
        ) : (
          <div className="syn-suggestion-grid">
            {suggestions.map((s) => (
              <div key={s.a.id + "|" + s.b.id} className="syn-suggestion-card">
                <div className="syn-suggestion-pair">
                  <button type="button" className="syn-link-title" onClick={() => setViewing(s.a.id)}>{s.a.title}</button>
                  <span className="syn-suggestion-arrow">↔</span>
                  <button type="button" className="syn-link-title" onClick={() => setViewing(s.b.id)}>{s.b.title}</button>
                </div>
                <div className="syn-suggestion-keywords">Mots-clés communs : {s.shared.join(", ")}</div>
                <div className="syn-suggestion-actions">
                  <button className="syn-btn syn-btn-sm syn-btn-primary" onClick={() => acceptSuggestion(s.a.id, s.b.id)}>
                    Accepter
                  </button>
                  <button className="syn-btn syn-btn-sm" onClick={() => dismissSuggestion(s.a.id, s.b.id)}>
                    Décliner
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
              const n = activeEntries.filter((e) => e.themeIds.includes(t.id)).length;
              return <Bar key={t.id} label={t.name} n={n} max={maxCount} color={themeColor(t.id, data.themes).text} />;
            })}
            <Bar label="Sans thème" n={activeEntries.filter((e) => e.themeIds.length === 0).length} max={maxCount} muted />
          </div>
          <div className="syn-ana-block">
            <h3>Provenance des idées</h3>
            {activeEntries.length === 0 ? (
              <p className="syn-empty-text">Aucune entrée pour l'instant.</p>
            ) : (
              provenances.map((p) => <Bar key={p.label} label={p.label} n={p.count} max={provenances[0].count} wide />)
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
          entries={activeEntries}
          onClose={() => setCreating(false)}
          onSave={(e) => { addEntry(e); setCreating(false); }}
          onAddTheme={addTheme}
        />
      )}
      {editingEntry && (
        <EntryModal
          key={editingEntry.id}
          themes={data.themes}
          entries={activeEntries}
          links={data.links}
          entry={editingEntry}
          onClose={() => setEditing(null)}
          onSave={(patch) => { updateEntry(editingEntry.id, patch); setEditing(null); }}
          onDelete={() => deleteEntry(editingEntry.id)}
          onAddLinks={addLinks}
          onDeleteLink={deleteLink}
          onOpenEntry={(id) => { setEditing(null); setViewing(id); }}
          onAddTheme={addTheme}
        />
      )}
      {viewingEntry && (
        <ViewModal
          entry={viewingEntry}
          allThemes={data.themes}
          allEntries={activeEntries}
          links={data.links}
          onClose={() => setViewing(null)}
          onOpenEntry={setViewing}
          onEdit={() => { setViewing(null); setEditing(viewingEntry.id); }}
        />
      )}
      {showTrash && (
        <TrashModal
          entries={trashEntries}
          onClose={() => setShowTrash(false)}
          onRestore={restoreEntry}
          onPurge={purgeEntry}
        />
      )}
    </div>
  );
}

/* ---------- Colonne Kanban ---------- */
const COLUMN_PAGE_SIZE = 20;

function Column({ theme, entries, allThemes, allEntries, links, linkCounts, unlimited, onOpen, onView, onRename, onDelete, muted, dragOver, onDragOver, onDragLeave, onDrop, onDragStart }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(theme.name);
  const [visibleCount, setVisibleCount] = useState(COLUMN_PAGE_SIZE);
  const [expandedId, setExpandedId] = useState(null); // fiche dépliée, propre à cette colonne
  const toggleExpand = (id) => setExpandedId((cur) => (cur === id ? null : id));

  const visibleEntries = unlimited ? entries : entries.slice(0, visibleCount);
  const remaining = entries.length - visibleEntries.length;
  const tc = muted ? null : themeColor(theme.id, allThemes);

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
            style={tc ? { background: tc.bg, color: tc.text } : undefined}
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
      {visibleEntries.map((e) => {
        const expanded = expandedId === e.id;
        const entryThemeTags = expanded
          ? e.themeIds.map((tid) => allThemes.find((t) => t.id === tid)).filter(Boolean)
          : [];
        const entryCardLinks = expanded ? resolveEntryLinks(e.id, links, allEntries) : [];
        return (
          <div
            key={e.id}
            className={"syn-card" + (expanded ? " syn-card-expanded" : "")}
            draggable
            onDragStart={() => onDragStart(e.id)}
            onClick={() => toggleExpand(e.id)}
          >
            <div className="syn-card-title">
              {e.title}
              <span className="syn-card-badges">
                {e.reflection.trim() && (
                  <span className="syn-card-reflectioncount" title="Réflexion personnelle jointe">💭</span>
                )}
                {linkCounts[e.id] > 0 && (
                  <span className="syn-card-linkcount" title="Fiches liées">🔗 {linkCounts[e.id]}</span>
                )}
              </span>
            </div>
            {hasReference(e) && (
              <div className={"syn-card-reference" + (expanded ? "" : " syn-card-reference-clamp")}>
                {formatReference(e)}
              </div>
            )}
            {e.notes && (
              <div className={"syn-card-notes" + (expanded ? " syn-card-notes-full" : "")}>{e.notes}</div>
            )}
            {expanded && e.reflection.trim() && (
              <div className="syn-reflection-box syn-card-reflection-box">
                <span className="syn-reflection-label">💭 Réflexion personnelle</span>
                <p className="syn-reflection-text">{e.reflection}</p>
              </div>
            )}
            {expanded && (
              <>
                {entryThemeTags.length > 0 && (
                  <div className="syn-card-tags">
                    {entryThemeTags.map((t) => {
                      const tc = themeColor(t.id, allThemes);
                      return (
                        <span key={t.id} className="syn-tag" style={{ background: tc.bg, color: tc.text }}>
                          {t.name}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="syn-card-meta">Idée du {formatCapturedDate(e.capturedAt)}</div>
                {entryCardLinks.length > 0 && (
                  <div className="syn-card-links">
                    <span className="syn-card-links-label">Fiches liées</span>
                    <div className="syn-card-links-list">
                      {entryCardLinks.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          className="syn-card-link-btn"
                          title={RELATION_LABELS[l.relation] || l.relation}
                          onClick={(ev) => { ev.stopPropagation(); onView(l.other.id); }}
                        >
                          {l.outgoing ? "→" : "←"} {l.other.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  className="syn-card-edit-btn"
                  onClick={(ev) => { ev.stopPropagation(); onOpen(e.id); }}
                >
                  Modifier
                </button>
              </>
            )}
          </div>
        );
      })}
      {remaining > 0 && (
        <button className="syn-load-more" onClick={() => setVisibleCount(entries.length)}>
          Charger {remaining} de plus
        </button>
      )}
    </div>
  );
}

/* ---------- Barre analytique ---------- */
function Bar({ label, n, max, muted, wide, color }) {
  return (
    <div className={"syn-bar-row" + (wide ? " syn-bar-row-wide" : "")}>
      <span className={"syn-bar-label" + (muted ? " syn-bar-label-muted" : "")} title={label}>{label}</span>
      <div className="syn-bar-track">
        <div
          className="syn-bar-fill"
          style={{ width: (max ? Math.max(n / max * 100, n > 0 ? 4 : 0) + "%" : 0), background: color || undefined }}
        />
      </div>
      <span className="syn-count">{n}</span>
    </div>
  );
}

/* ---------- Modale d'entrée ---------- */
const RELATION_TYPES = [
  { value: "repond_a", label: "répond à" },
  { value: "prolonge", label: "prolonge" },
  { value: "contredit", label: "contredit" },
  { value: "lien", label: "est en lien avec" },
];
const RELATION_LABELS = Object.fromEntries(RELATION_TYPES.map((r) => [r.value, r.label]));

const REF_TYPES = [
  { value: "", label: "Non précisé" },
  { value: "livre", label: "Livre" },
  { value: "article", label: "Article" },
  { value: "chapitre", label: "Chapitre d'ouvrage collectif" },
  { value: "site_web", label: "Site web" },
  { value: "autre", label: "Autre" },
];
const REF_FORM_FIELDS = [
  { key: "authors", label: "Auteur(s)", placeholder: "Foucault, Michel" },
  { key: "title", label: "Titre complet", placeholder: "Surveiller et Punir : Naissance de la prison" },
  { key: "container", label: "Revue / ouvrage collectif", placeholder: "" },
  { key: "publisher", label: "Éditeur", placeholder: "Gallimard" },
  { key: "year", label: "Année", placeholder: "1975" },
  { key: "edition", label: "Édition", placeholder: "2e éd." },
  { key: "pages", label: "Page(s)", placeholder: "45-52" },
  { key: "isbn", label: "ISBN", placeholder: "" },
  { key: "doi", label: "DOI", placeholder: "" },
];

function formatCapturedDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function hasReference(e) {
  return Boolean(
    e.refAuthors || e.refTitle || e.refContainer || e.refPublisher || e.refYear || e.refEdition || e.refPages || e.refIsbn || e.refDoi
  );
}

function formatReference(e) {
  const parts = [];
  if (e.refAuthors) parts.push(e.refAuthors);
  if (e.refTitle) parts.push(e.refTitle);
  if (e.refContainer) parts.push(e.refContainer);
  if (e.refPublisher) parts.push(e.refPublisher);
  if (e.refEdition) parts.push(e.refEdition);
  if (e.refYear) parts.push(e.refYear);
  if (e.refPages) parts.push("p. " + e.refPages);
  if (e.refIsbn) parts.push("ISBN " + e.refIsbn);
  if (e.refDoi) parts.push("DOI " + e.refDoi);
  return parts.join(", ");
}

/* ---------- Export RIS (Zotero, EndNote, etc.) ---------- */
const RIS_TYPE_BY_REF_TYPE = {
  livre: "BOOK",
  article: "JOUR",
  chapitre: "CHAP",
  site_web: "ELEC",
  autre: "GEN",
};

function buildRis(entries) {
  const records = [];
  entries.forEach((e) => {
    if (!hasReference(e)) return;
    const title = e.refTitle || e.title;
    const lines = [`TY  - ${RIS_TYPE_BY_REF_TYPE[e.refType] || "GEN"}`];
    (e.refAuthors || "")
      .split(";")
      .map((a) => a.trim())
      .filter(Boolean)
      .forEach((a) => lines.push(`AU  - ${a}`));
    if (title) lines.push(`TI  - ${title}`);
    if (e.refContainer) lines.push(`T2  - ${e.refContainer}`);
    if (e.refPublisher) lines.push(`PB  - ${e.refPublisher}`);
    if (e.refYear) lines.push(`PY  - ${e.refYear}`);
    if (e.refEdition) lines.push(`ET  - ${e.refEdition}`);
    if (e.refPages) {
      const [sp, ep] = e.refPages.split("-").map((p) => p.trim());
      if (sp) lines.push(`SP  - ${sp}`);
      if (ep) lines.push(`EP  - ${ep}`);
    }
    if (e.refIsbn) lines.push(`SN  - ${e.refIsbn}`);
    if (e.refDoi) lines.push(`DO  - ${e.refDoi}`);
    const noteParts = [];
    if (e.title && e.title !== title) noteParts.push(`Idée Syntopicon : ${e.title}.`);
    if (e.notes) noteParts.push(e.notes.replace(/\r?\n/g, " "));
    if (noteParts.length) lines.push(`N1  - ${noteParts.join(" ")}`);
    lines.push("ER  - ");
    records.push(lines.join("\n"));
  });
  return records.join("\n\n");
}

function EntryModal({ themes, entries, links, entry, onClose, onSave, onDelete, onAddLinks, onDeleteLink, onOpenEntry, onAddTheme }) {
  const [title, setTitle] = useState(entry ? entry.title : "");
  const [themeIds, setThemeIds] = useState(entry ? entry.themeIds || [] : []);
  const [newThemeName, setNewThemeName] = useState("");
  const [notes, setNotes] = useState(entry ? entry.notes : "");
  const [reflection, setReflection] = useState(entry ? entry.reflection : "");
  const [capturedAt, setCapturedAt] = useState(entry ? entry.capturedAt : todayStr());
  const [ref, setRef] = useState({
    type: entry ? entry.refType : "",
    authors: entry ? entry.refAuthors : "",
    title: entry ? entry.refTitle : "",
    container: entry ? entry.refContainer : "",
    publisher: entry ? entry.refPublisher : "",
    year: entry ? entry.refYear : "",
    edition: entry ? entry.refEdition : "",
    pages: entry ? entry.refPages : "",
    isbn: entry ? entry.refIsbn : "",
    doi: entry ? entry.refDoi : "",
  });
  const [showBiblio, setShowBiblio] = useState(entry ? Object.values(ref).some(Boolean) : false);
  const [linkRelation, setLinkRelation] = useState(RELATION_TYPES[0].value);
  const [linkFilter, setLinkFilter] = useState("");
  const [linkThemeFilter, setLinkThemeFilter] = useState("");
  const [selectedLinkIds, setSelectedLinkIds] = useState([]);

  const toggleTheme = (id) => {
    setThemeIds((ids) => (ids.includes(id) ? ids.filter((tid) => tid !== id) : [...ids, id]));
  };

  const addNewTheme = async () => {
    const n = newThemeName.trim();
    if (!n) return;
    const t = await onAddTheme(n);
    if (t) {
      setThemeIds((ids) => (ids.includes(t.id) ? ids : [...ids, t.id]));
      setNewThemeName("");
    }
  };

  const updateRef = (key, value) => setRef((r) => ({ ...r, [key]: value }));

  /* Références bibliographiques déjà saisies ailleurs, dédupliquées par auteur(s)+titre,
     pour les reprendre sans ressaisie. Les pages, elles, changent d'une fiche à l'autre
     dans un même ouvrage : volontairement exclues de la reprise. */
  const savedReferences = [];
  const seenRefs = new Set();
  (entries || []).forEach((e) => {
    if (!e.refAuthors.trim() && !e.refTitle.trim()) return;
    const sig = e.refAuthors.trim().toLowerCase() + "|" + e.refTitle.trim().toLowerCase();
    if (seenRefs.has(sig)) return;
    seenRefs.add(sig);
    savedReferences.push({
      sig,
      label: [e.refAuthors, e.refTitle].filter(Boolean).join(" — "),
      values: {
        type: e.refType,
        authors: e.refAuthors,
        title: e.refTitle,
        container: e.refContainer,
        publisher: e.refPublisher,
        year: e.refYear,
        edition: e.refEdition,
        isbn: e.refIsbn,
        doi: e.refDoi,
      },
    });
  });

  const applyReferenceProfile = (sig) => {
    const profile = savedReferences.find((p) => p.sig === sig);
    if (!profile) return;
    setRef((r) => ({ ...r, ...profile.values }));
    setShowBiblio(true);
  };

  const save = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      themeIds,
      notes,
      reflection: reflection.trim(),
      capturedAt,
      refType: ref.type,
      refAuthors: ref.authors,
      refTitle: ref.title,
      refContainer: ref.container,
      refPublisher: ref.publisher,
      refYear: ref.year,
      refEdition: ref.edition,
      refPages: ref.pages,
      refIsbn: ref.isbn,
      refDoi: ref.doi,
    });
  };

  const entryLinks = entry ? resolveEntryLinks(entry.id, links, entries) : [];

  const otherEntries = entry ? (entries || []).filter((e) => e.id !== entry.id) : [];
  const linkCandidates = otherEntries.filter((e) => {
    if (linkThemeFilter && !e.themeIds.includes(linkThemeFilter)) return false;
    const q = linkFilter.trim().toLowerCase();
    return !q || searchHaystack(e).includes(q);
  });

  const toggleLinkSelect = (id) => {
    setSelectedLinkIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const addSelectedLinks = () => {
    if (!selectedLinkIds.length) return;
    onAddLinks(entry.id, selectedLinkIds, linkRelation);
    setSelectedLinkIds([]);
    setLinkFilter("");
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
          <span>Date de capture (l'idée, pas la saisie)</span>
          <input type="date" className="syn-input" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />
        </label>
        <div className="syn-field">
          <span>Thèmes syntopiques (un ou plusieurs)</span>
          <div className="syn-theme-checks">
            {themes.length === 0 && <p className="syn-empty-text">Aucun thème créé pour l'instant.</p>}
            {themes.map((t) => (
              <label key={t.id} className="syn-theme-check">
                <input type="checkbox" checked={themeIds.includes(t.id)} onChange={() => toggleTheme(t.id)} />
                <span className="syn-theme-swatch" style={{ background: themeColor(t.id, themes).text }} />
                {t.name}
              </label>
            ))}
          </div>
          <div className="syn-theme-add">
            <input
              className="syn-input syn-input-sm"
              placeholder="Nouveau thème..."
              value={newThemeName}
              onChange={(e) => setNewThemeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addNewTheme(); }
              }}
            />
            <button type="button" className="syn-btn syn-btn-sm" disabled={!newThemeName.trim()} onClick={addNewTheme}>
              + Créer et sélectionner
            </button>
          </div>
        </div>
        <div className="syn-field">
          {savedReferences.length > 0 && (
            <select
              className="syn-input syn-input-sm syn-ref-reuse"
              value=""
              onChange={(e) => e.target.value && applyReferenceProfile(e.target.value)}
            >
              <option value="">↺ Reprendre une référence déjà utilisée...</option>
              {savedReferences.map((p) => (
                <option key={p.sig} value={p.sig}>{p.label}</option>
              ))}
            </select>
          )}
          <button type="button" className="syn-biblio-toggle" onClick={() => setShowBiblio((s) => !s)}>
            {showBiblio ? "▾" : "▸"} Référence bibliographique complète (pour export futur, Zotero...)
          </button>
          {showBiblio && (
            <div className="syn-biblio-grid">
              <label className="syn-biblio-field">
                <span>Type</span>
                <select className="syn-input syn-input-sm" value={ref.type} onChange={(e) => updateRef("type", e.target.value)}>
                  {REF_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              {REF_FORM_FIELDS.map((f) => (
                <label key={f.key} className="syn-biblio-field">
                  <span>{f.label}</span>
                  <input
                    className="syn-input syn-input-sm"
                    value={ref[f.key]}
                    onChange={(e) => updateRef(f.key, e.target.value)}
                    placeholder={f.placeholder}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
        <label className="syn-field">
          <span>Annotations</span>
          <textarea className="syn-textarea" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ce que vous retenez de la lecture : ce que dit l'auteur, le résumé de l'idée..." />
        </label>
        <label className="syn-field syn-field-reflection">
          <span>💭 Réflexion personnelle</span>
          <textarea
            className="syn-textarea syn-textarea-reflection"
            rows={4}
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            placeholder="Vos questionnements, objections, commentaires — ce qui est à vous, distinct de ce que dit l'auteur..."
          />
        </label>
        {entry && (
          <div className="syn-field">
            <span>Fiches liées</span>
            <div className="syn-links-list">
              {entryLinks.length === 0 && <p className="syn-empty-text">Aucun lien pour l'instant.</p>}
              {entryLinks.map((l) => (
                <div key={l.id} className="syn-link-row">
                  <span
                    className="syn-link-arrow"
                    title={l.outgoing ? "Cette fiche → l'autre fiche" : "L'autre fiche → cette fiche"}
                  >
                    {l.outgoing ? "→" : "←"}
                  </span>
                  <span className="syn-link-relation">{RELATION_LABELS[l.relation] || l.relation}</span>
                  <button type="button" className="syn-link-title" onClick={() => onOpenEntry(l.other.id)}>
                    {l.other.title}
                  </button>
                  <button type="button" className="syn-x" title="Retirer ce lien" onClick={() => onDeleteLink(l.id)}>×</button>
                </div>
              ))}
            </div>
            <div className="syn-link-add">
              <div className="syn-link-picker-controls">
                <select className="syn-input syn-input-sm" value={linkRelation} onChange={(e) => setLinkRelation(e.target.value)}>
                  {RELATION_TYPES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <select className="syn-input syn-input-sm" value={linkThemeFilter} onChange={(e) => setLinkThemeFilter(e.target.value)}>
                  <option value="">Tous les thèmes</option>
                  {themes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <input
                  className="syn-input syn-input-sm"
                  placeholder="Mot-clé..."
                  value={linkFilter}
                  onChange={(e) => setLinkFilter(e.target.value)}
                />
              </div>
              <div className="syn-link-picker">
                {otherEntries.length === 0 && <p className="syn-empty-text">Aucune autre fiche disponible.</p>}
                {otherEntries.length > 0 && linkCandidates.length === 0 && (
                  <p className="syn-empty-text">Aucune fiche ne correspond au filtre.</p>
                )}
                {linkCandidates.map((e) => (
                  <label key={e.id} className="syn-theme-check">
                    <input type="checkbox" checked={selectedLinkIds.includes(e.id)} onChange={() => toggleLinkSelect(e.id)} />
                    {e.title}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="syn-btn syn-btn-sm"
                disabled={selectedLinkIds.length === 0}
                onClick={addSelectedLinks}
              >
                Lier {selectedLinkIds.length > 0 ? `(${selectedLinkIds.length})` : "la sélection"}
              </button>
            </div>
          </div>
        )}
        <div className="syn-modal-actions">
          {onDelete && (
            <button className="syn-btn syn-btn-danger" onClick={onDelete} title="Récupérable ensuite dans la corbeille">
              Mettre à la corbeille
            </button>
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

/* ---------- Visualisation (lecture seule) ---------- */
function ViewModal({ entry, allThemes, allEntries, links, onClose, onOpenEntry, onEdit }) {
  const themeTags = entry.themeIds.map((tid) => allThemes.find((t) => t.id === tid)).filter(Boolean);
  const entryLinks = resolveEntryLinks(entry.id, links, allEntries);

  return (
    <div className="syn-overlay" onClick={onClose}>
      <div className="syn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="syn-modal-rule" />
        <h3 className="syn-modal-title">{entry.title}</h3>
        {themeTags.length > 0 && (
          <div className="syn-card-tags syn-view-tags">
            {themeTags.map((t) => {
              const tc = themeColor(t.id, allThemes);
              return (
                <span key={t.id} className="syn-tag" style={{ background: tc.bg, color: tc.text }}>
                  {t.name}
                </span>
              );
            })}
          </div>
        )}
        {entry.notes && <p className="syn-view-notes">{entry.notes}</p>}
        {entry.reflection.trim() && (
          <div className="syn-reflection-box">
            <span className="syn-reflection-label">💭 Réflexion personnelle</span>
            <p className="syn-reflection-text">{entry.reflection}</p>
          </div>
        )}
        <div className="syn-card-meta">Idée du {formatCapturedDate(entry.capturedAt)}</div>
        {hasReference(entry) && <div className="syn-card-reference">{formatReference(entry)}</div>}
        {entryLinks.length > 0 && (
          <div className="syn-card-links syn-view-links">
            <span className="syn-card-links-label">Fiches liées</span>
            <div className="syn-card-links-list">
              {entryLinks.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="syn-card-link-btn"
                  title={RELATION_LABELS[l.relation] || l.relation}
                  onClick={() => onOpenEntry(l.other.id)}
                >
                  {l.outgoing ? "→" : "←"} {l.other.title}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="syn-modal-actions">
          <div className="syn-spacer" />
          <button className="syn-btn" onClick={onClose}>Fermer</button>
          <button className="syn-btn syn-btn-primary" onClick={onEdit}>Modifier</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Corbeille ---------- */
function TrashModal({ entries, onClose, onRestore, onPurge }) {
  const purge = (e) => {
    if (window.confirm(`Supprimer définitivement « ${e.title} » ? Cette action est irréversible.`)) {
      onPurge(e.id);
    }
  };

  return (
    <div className="syn-overlay" onClick={onClose}>
      <div className="syn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="syn-modal-rule" />
        <h3 className="syn-modal-title">Corbeille</h3>
        {entries.length === 0 ? (
          <p className="syn-empty-text">La corbeille est vide.</p>
        ) : (
          <div className="syn-trash-list">
            {entries.map((e) => (
              <div key={e.id} className="syn-trash-row">
                <div className="syn-trash-info">
                  <div className="syn-trash-title">{e.title}</div>
                </div>
                <div className="syn-trash-actions">
                  <button className="syn-btn syn-btn-sm" onClick={() => onRestore(e.id)}>Restaurer</button>
                  <button className="syn-btn syn-btn-sm syn-btn-danger" onClick={() => purge(e)}>
                    Supprimer définitivement
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="syn-modal-actions">
          <div className="syn-spacer" />
          <button className="syn-btn" onClick={onClose}>Fermer</button>
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
  --reflexion: #9C7626;
  --reflexion-clair: #F4ECD8;
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
.syn-capture-row { display: grid; grid-template-columns: minmax(200px, 0.9fr) minmax(220px, 1fr) minmax(240px, 1.1fr); gap: 16px; margin-bottom: 40px; }
@media (max-width: 900px) { .syn-capture-row { grid-template-columns: 1fr 1fr; } }
@media (max-width: 600px) { .syn-capture-row { grid-template-columns: 1fr; } }
.syn-panel { background: var(--fiche); border: 1px solid var(--ligne); border-radius: 6px; padding: 18px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.syn-panel-label { font-weight: 600; font-size: 14px; display: flex; gap: 10px; align-items: baseline; }
.syn-flash { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--vert); font-weight: 400; }
.syn-quick .syn-textarea { width: 100%; }
.syn-daily { width: 100%; }
.syn-daily-card { display: block; width: 100%; text-align: left; border: 1px solid var(--ligne); border-radius: 4px; padding: 10px 12px; background: var(--papier); cursor: pointer; font: inherit; color: inherit; transition: border-color 0.12s; }
.syn-daily-card:hover { border-color: var(--vert); }
.syn-daily-title { font-weight: 500; padding-bottom: 6px; border-bottom: 1px solid var(--filet); margin-bottom: 6px; }
.syn-daily-notes { font-size: 12.5px; color: var(--encre-2); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }

/* ----- sections ----- */
.syn-section-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; border-bottom: 1px solid var(--encre); padding-bottom: 10px; margin-bottom: 20px; }
.syn-section-head h2 { font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 26px; margin: 0; }
.syn-sub { color: var(--encre-2); font-size: 13px; }
.syn-search { margin-left: auto; border: 1px solid var(--ligne); border-radius: 4px; padding: 6px 10px; font: inherit; background: var(--fiche); min-width: 180px; }
.syn-search:focus { outline: 2px solid var(--vert); outline-offset: 1px; }
.syn-reflection-filter { margin-left: 0; min-width: 0; cursor: pointer; }

/* ----- kanban ----- */
.syn-board-section { margin-bottom: 48px; }

/* ----- suggestions de liens ----- */
.syn-suggestions { margin-bottom: 48px; }
.syn-suggestion-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.syn-suggestion-card { background: var(--fiche); border: 1px solid var(--ligne); border-radius: 6px; padding: 16px; }
.syn-suggestion-pair { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.syn-suggestion-arrow { color: var(--encre-2); flex-shrink: 0; }
.syn-suggestion-keywords { font-size: 12px; color: var(--encre-2); font-style: italic; margin-bottom: 12px; }
.syn-suggestion-actions { display: flex; gap: 8px; }
.syn-board { display: flex; gap: 16px; align-items: flex-start; overflow-x: auto; padding-bottom: 12px; }
.syn-col { min-width: 240px; width: 240px; flex-shrink: 0; border-radius: 6px; padding: 4px; transition: background 0.15s; }
.syn-col-over { background: var(--vert-clair); }
.syn-col-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 10px; }
.syn-col-name { background: var(--vert-clair); color: var(--vert); font-weight: 600; font-size: 13px; padding: 2px 10px; border-radius: 3px; cursor: default; }
.syn-col-head-muted .syn-col-name { background: #E4E6E0; color: var(--encre-2); }
.syn-count { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--encre-2); }
.syn-x { margin-left: auto; border: none; background: none; color: var(--encre-2); font-size: 16px; cursor: pointer; line-height: 1; padding: 2px 4px; border-radius: 3px; opacity: 0; transition: opacity 0.15s; }
.syn-col-head:hover .syn-x, .syn-hidden-row:hover .syn-x { opacity: 1; }
.syn-link-row .syn-x { opacity: 1; }
.syn-x:hover { color: var(--filet); }

/* fiches : le filet rouge sous le titre est la signature visuelle */
.syn-card { background: var(--fiche); border: 1px solid var(--ligne); border-radius: 4px; padding: 12px 14px 10px; margin-bottom: 10px; cursor: pointer; box-shadow: 0 1px 2px rgba(34,48,63,0.06); transition: transform 0.12s, box-shadow 0.12s; }
.syn-card:hover { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(34,48,63,0.10); }
.syn-card-expanded, .syn-card-expanded:hover { border-color: var(--vert); }
.syn-card-title { font-weight: 500; padding-bottom: 7px; border-bottom: 1px solid var(--filet); margin-bottom: 7px; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.syn-card-badges { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.syn-card-linkcount { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--encre-2); font-weight: 400; white-space: nowrap; }
.syn-card-reflectioncount { font-size: 12px; }
.syn-reflection-box { background: var(--reflexion-clair); border-left: 3px solid var(--reflexion); border-radius: 0 4px 4px 0; padding: 10px 12px; margin: 10px 0; }
.syn-reflection-label { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--reflexion); margin-bottom: 4px; }
.syn-reflection-text { font-size: 13px; color: var(--encre); white-space: pre-wrap; margin: 0; line-height: 1.5; }
.syn-card-reflection-box { margin-top: 10px; }
.syn-card-notes { font-size: 12.5px; color: var(--encre-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.syn-card-notes-full { display: block; -webkit-line-clamp: unset; white-space: pre-wrap; }
.syn-card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.syn-card-meta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--encre-2); margin-top: 8px; }
.syn-card-reference { font-size: 11.5px; color: var(--encre-2); font-style: italic; margin-bottom: 4px; }
.syn-card-reference-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.syn-card-links { margin-top: 10px; }
.syn-card-links-label { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--encre-2); margin-bottom: 4px; }
.syn-card-links-list { display: flex; flex-direction: column; gap: 2px; }
.syn-card-link-btn { display: block; width: 100%; text-align: left; border: none; background: none; color: var(--vert); font: inherit; font-size: 12px; cursor: pointer; padding: 2px 0; text-decoration: underline; text-decoration-color: transparent; }
.syn-card-link-btn:hover { text-decoration-color: var(--vert); }
.syn-view-tags { margin-top: 0; margin-bottom: 14px; }
.syn-view-notes { font-size: 13.5px; color: var(--encre); white-space: pre-wrap; line-height: 1.55; margin: 0 0 16px; }
.syn-view-links { margin-top: 16px; margin-bottom: 4px; }
.syn-card-edit-btn { display: block; border: none; background: none; color: var(--vert); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; padding: 10px 0 0; }
.syn-card-edit-btn:hover { text-decoration: underline; }
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
.syn-bar-row-wide { grid-template-columns: 1fr 24px; grid-template-areas: "label label" "track count"; row-gap: 4px; margin-bottom: 12px; }
.syn-bar-row-wide .syn-bar-label { grid-area: label; white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.3; }
.syn-bar-row-wide .syn-bar-track { grid-area: track; }
.syn-bar-row-wide .syn-count { grid-area: count; justify-self: end; }
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
.syn-field-reflection > span { color: var(--reflexion); }
.syn-textarea-reflection { background: var(--reflexion-clair); border-color: var(--reflexion); }
.syn-textarea-reflection:focus { outline-color: var(--reflexion); }
.syn-theme-checks { display: flex; flex-wrap: wrap; gap: 6px 14px; max-height: 160px; overflow-y: auto; padding: 10px; border: 1px solid var(--ligne); border-radius: 4px; background: var(--papier); }
.syn-theme-check { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.syn-theme-check input { cursor: pointer; }
.syn-theme-swatch { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.syn-theme-add { display: flex; gap: 6px; margin-top: 8px; }
.syn-theme-add .syn-input { flex: 1; }
.syn-ref-reuse { display: block; width: 100%; margin-bottom: 8px; cursor: pointer; }
.syn-biblio-toggle { display: block; width: 100%; text-align: left; border: none; background: none; color: var(--vert); font: inherit; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; cursor: pointer; padding: 0 0 5px; }
.syn-biblio-toggle:hover { text-decoration: underline; }
.syn-biblio-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; padding: 10px; border: 1px solid var(--ligne); border-radius: 4px; background: var(--papier); }
.syn-biblio-field { display: block; }
.syn-biblio-field > span { display: block; font-size: 11px; font-weight: 600; color: var(--encre-2); margin-bottom: 3px; }
.syn-links-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.syn-link-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.syn-link-arrow { color: var(--vert); font-weight: 600; cursor: help; }
.syn-link-relation { color: var(--encre-2); font-size: 12px; white-space: nowrap; }
.syn-link-title { flex: 1; text-align: left; border: none; background: none; color: var(--encre); font: inherit; font-weight: 500; cursor: pointer; padding: 2px 0; text-decoration: underline; text-decoration-color: var(--ligne); }
.syn-link-title:hover { text-decoration-color: var(--vert); color: var(--vert); }
.syn-link-add { display: flex; flex-direction: column; gap: 8px; }
.syn-link-picker-controls { display: flex; gap: 6px; }
.syn-link-picker-controls .syn-input { flex: 1; }
.syn-link-picker { display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow-y: auto; padding: 10px; border: 1px solid var(--ligne); border-radius: 4px; background: var(--papier); }
.syn-trash-list { display: flex; flex-direction: column; gap: 10px; max-height: 50vh; overflow-y: auto; }
.syn-trash-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--ligne); border-radius: 4px; }
.syn-trash-title { font-weight: 500; }
.syn-trash-actions { display: flex; gap: 8px; flex-shrink: 0; }
.syn-modal-actions { display: flex; gap: 10px; align-items: center; margin-top: 20px; }
.syn-spacer { flex: 1; }

@media (prefers-reduced-motion: reduce) {
  .syn-card, .syn-bar-fill, .syn-btn, .syn-col { transition: none; }
}
`;

/* Montage de l'application dans la page. */
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<Syntopicon />);

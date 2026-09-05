const BASE_URL = '/api';
const PAGE_SIZE = 24;

let allResults = [];
let filteredResults = [];
let currentPage = 1;
let activeFilter = 'all';
let currentSort = 'bandgap_asc';

const apiStatus = document.getElementById('api-status');

// --- Element name → symbol lookup ---
const ELEMENT_NAMES = {
  hydrogen:'H',helium:'He',lithium:'Li',beryllium:'Be',boron:'B',
  carbon:'C',nitrogen:'N',oxygen:'O',fluorine:'F',neon:'Ne',
  sodium:'Na',magnesium:'Mg',aluminum:'Al',aluminium:'Al',silicon:'Si',
  phosphorus:'P',sulfur:'S',sulphur:'S',chlorine:'Cl',argon:'Ar',
  potassium:'K',calcium:'Ca',scandium:'Sc',titanium:'Ti',vanadium:'V',
  chromium:'Cr',manganese:'Mn',iron:'Fe',cobalt:'Co',nickel:'Ni',
  copper:'Cu',zinc:'Zn',gallium:'Ga',germanium:'Ge',arsenic:'As',
  selenium:'Se',bromine:'Br',krypton:'Kr',rubidium:'Rb',strontium:'Sr',
  yttrium:'Y',zirconium:'Zr',niobium:'Nb',molybdenum:'Mo',technetium:'Tc',
  ruthenium:'Ru',rhodium:'Rh',palladium:'Pd',silver:'Ag',cadmium:'Cd',
  indium:'In',tin:'Sn',antimony:'Sb',tellurium:'Te',iodine:'I',
  xenon:'Xe',cesium:'Cs',barium:'Ba',lanthanum:'La',cerium:'Ce',
  praseodymium:'Pr',neodymium:'Nd',promethium:'Pm',samarium:'Sm',
  europium:'Eu',gadolinium:'Gd',terbium:'Tb',dysprosium:'Dy',
  holmium:'Ho',erbium:'Er',thulium:'Tm',ytterbium:'Yb',lutetium:'Lu',
  hafnium:'Hf',tantalum:'Ta',tungsten:'W',rhenium:'Re',osmium:'Os',
  iridium:'Ir',platinum:'Pt',gold:'Au',mercury:'Hg',thallium:'Tl',
  lead:'Pb',bismuth:'Bi',polonium:'Po',astatine:'At',radon:'Rn',
  francium:'Fr',radium:'Ra',actinium:'Ac',thorium:'Th',protactinium:'Pa',
  uranium:'U',neptunium:'Np',plutonium:'Pu'
};

const VALID_SYMBOLS = new Set(Object.values(ELEMENT_NAMES));

function resolveElement(raw) {
  const byName = ELEMENT_NAMES[raw.toLowerCase()];
  if (byName) return byName;
  // Normalize symbol casing: Fe, Si, C, etc.
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

// Turns a formula typed in any casing (ch4, Fe2O3, nacl) into proper
// element-symbol casing (CH4, Fe2O3, NaCl) by greedily matching the
// longest valid element symbol at each position.
function normalizeFormula(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (/[0-9.]/.test(ch)) { out += ch; i++; continue; }
    const two = raw.slice(i, i + 2);
    const twoCap = /^[A-Za-z]{2}$/.test(two) ? two[0].toUpperCase() + two[1].toLowerCase() : null;
    if (twoCap && VALID_SYMBOLS.has(twoCap)) { out += twoCap; i += 2; continue; }
    const oneCap = ch.toUpperCase();
    if (VALID_SYMBOLS.has(oneCap)) { out += oneCap; i += 1; continue; }
    out += ch; i++; // unrecognized char — pass through as-is
  }
  return out;
}

// --- Search ---
let debounceTimer = null;

const inputEl = document.getElementById('element-input');

inputEl.addEventListener('input', () => {
  const val = inputEl.value.trim();
  clearTimeout(debounceTimer);
  if (!val) { resetState(); return; }
  debounceTimer = setTimeout(() => doSearch(), 600);
});

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { clearTimeout(debounceTimer); doSearch(); }
});

function resetState() {
  allResults = [];
  filteredResults = [];
  currentPage = 1;
  document.getElementById('stat-total').textContent = '—';
  document.getElementById('stat-metals').textContent = '—';
  document.getElementById('stat-sc').textContent = '—';
  document.getElementById('stat-ins').textContent = '—';
  document.getElementById('stat-avg-bg').textContent = '—';
  document.getElementById('results-count').textContent = '';
  document.getElementById('pagination').innerHTML = '';
  const grid = document.getElementById('results-grid');
  grid.innerHTML = '';
  grid.style.display = 'none';
  document.getElementById('periodic-table-section').style.display = '';
  renderActionPanels();
}

// ─── Hero / nav helpers ────────────────────────────────────
function scrollToApp() {
  document.getElementById('app').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => document.getElementById('element-input')?.focus(), 400);
}

function copyCodeSnippet(btn) {
  const code = document.getElementById('api-code-snippet').textContent;
  const done = () => {
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(code).then(done).catch(done);
  } else {
    done();
  }
}

// ─── "See It In Action" tabs — mirrors live app state ──────
function switchActionTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['search', 'compare', 'export'].forEach(n => {
    const panel = document.getElementById('action-' + n);
    if (panel) panel.hidden = n !== name;
  });
  renderActionPanels();
}

function renderActionPanels() {
  const totalEl = document.getElementById('action-total');
  if (!totalEl) return; // panels not on this page

  const has = allResults.length > 0;
  totalEl.textContent = has ? allResults.length : '—';
  document.getElementById('action-metals').textContent = has ? allResults.filter(m => m._type === 'metal').length : '—';
  document.getElementById('action-sc').textContent = has ? allResults.filter(m => m._type === 'semiconductor').length : '—';
  document.getElementById('action-ins').textContent = has ? allResults.filter(m => m._type === 'insulator').length : '—';

  const searchHint = document.getElementById('action-search-hint');
  if (searchHint) {
    searchHint.textContent = has
      ? `Showing ${filteredResults.length} of ${allResults.length} materials below.`
      : 'Search an element above to populate live results, then scroll down to browse them.';
  }

  const list = document.getElementById('action-compare-list');
  if (list) {
    if (compareSet.size === 0) {
      list.innerHTML = `<p class="action-hint">Select materials with the Compare checkbox on any card to see them here.</p>`;
    } else {
      const items = [...compareSet].map(mid => allResults.find(r => r.material_id === mid) || favoriteData[mid]).filter(Boolean);
      list.innerHTML = items.map(m => `<span class="action-chip">${escHtml(m.formula_pretty || m.material_id)}</span>`).join('');
    }
  }

  const exportHint = document.getElementById('action-export-hint');
  if (exportHint) {
    exportHint.textContent = `${filteredResults.length} material${filteredResults.length !== 1 ? 's' : ''} ready to export.`;
  }
}

async function doSearch() {
  const rawInput = document.getElementById('element-input').value.trim();
  if (!rawInput) { resetState(); return; }

  // Dash-separated input (e.g. "Fe-O", "Iron-Oxygen") → use chemsys for exact system
  // Comma/space-separated → use elements (contains)
  // Single token that isn't itself a known element (e.g. "CH4", "Fe2O3", "NaCl") → formula match
  const isDashSystem = /^[A-Za-z]+-[A-Za-z]/.test(rawInput) && !rawInput.includes(',');
  const isMultiToken = /[,\s]/.test(rawInput.trim());

  let queryParam, queryValue;
  if (isDashSystem) {
    const parts = rawInput.split('-').map(t => resolveElement(t.trim())).filter(Boolean);
    queryParam = 'chemsys';
    queryValue = parts.join('-');
  } else if (isMultiToken) {
    const parts = rawInput.split(/[,\s]+/).map(t => resolveElement(t.trim())).filter(Boolean);
    queryParam = 'elements';
    queryValue = parts.join(',');
  } else {
    const resolved = resolveElement(rawInput);
    if (VALID_SYMBOLS.has(resolved)) {
      queryParam = 'elements';
      queryValue = resolved;
    } else {
      queryParam = 'formula';
      queryValue = normalizeFormula(rawInput);
    }
  }

  showLoading();
  document.getElementById('search-btn').disabled = true;

  try {
    const fields = 'material_id,formula_pretty,elements,nsites,band_gap,formation_energy_per_atom,is_stable,symmetry,density,volume,e_above_hull,efermi,theoretical,is_magnetic';
    const url = `${BASE_URL}/materials/summary/?${queryParam}=${encodeURIComponent(queryValue)}&_fields=${encodeURIComponent(fields)}&_limit=200`;

    const res = await fetch(url);

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`HTTP ${res.status} — ${errBody.slice(0, 300)}`);
    }

    const data = await res.json();
    allResults = (data.data || data || []).map(normalise);

    if (allResults.length === 0) {
      showError(`No materials found for <strong>${escHtml(queryValue)}</strong>. Try a valid element symbol like <strong>Fe</strong>, <strong>Si</strong>, or a system like <strong>Fe-O</strong>.`);
      return;
    }

    apiStatus.className = 'api-status active';
    updateStats(allResults);
    currentPage = 1;
    applyFiltersAndSort();

  } catch (err) {
    console.error(err);
    apiStatus.className = 'api-status error';
    showError(`Could not fetch data.<br><br><code>${err.message}</code>`);
  } finally {
    document.getElementById('search-btn').disabled = false;
  }
}

function normalise(m) {
  // Determine type
  const bg = m.band_gap ?? null;
  let type = 'unknown';
  if (bg !== null) {
    if (bg === 0) type = 'metal';
    else if (bg < 3.0) type = 'semiconductor';
    else type = 'insulator';
  }
  return { ...m, _type: type };
}

function toggleSortMenu(e) {
  e.stopPropagation();
  document.getElementById('sort-select-wrap').classList.toggle('open');
}

function selectSortOpt(value, label, btn) {
  currentSort = value;
  document.getElementById('sort-label').textContent = label;
  document.querySelectorAll('#sort-dropdown button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sort-select-wrap').classList.remove('open');
  currentPage = 1;
  applyFiltersAndSort();
}

document.addEventListener('click', () => {
  document.getElementById('sort-select-wrap')?.classList.remove('open');
});

// --- Filters & Sort ---
function setFilter(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  currentPage = 1;
  applyFiltersAndSort();
}

function applyFiltersAndSort() {
  let data = [...allResults];

  // Type filter
  if (activeFilter !== 'all') data = data.filter(m => m._type === activeFilter);

  // Range filters
  const bgMin = parseFloat(document.getElementById('bg-min').value);
  const bgMax = parseFloat(document.getElementById('bg-max').value);
  const efMin = parseFloat(document.getElementById('ef-min').value);
  const efMax = parseFloat(document.getElementById('ef-max').value);
  const nsMin = parseInt(document.getElementById('ns-min').value);
  const nsMax = parseInt(document.getElementById('ns-max').value);

  if (!isNaN(bgMin)) data = data.filter(m => (m.band_gap ?? 0) >= bgMin);
  if (!isNaN(bgMax)) data = data.filter(m => (m.band_gap ?? 0) <= bgMax);
  if (!isNaN(efMin)) data = data.filter(m => (m.formation_energy_per_atom ?? 0) >= efMin);
  if (!isNaN(efMax)) data = data.filter(m => (m.formation_energy_per_atom ?? 0) <= efMax);
  if (!isNaN(nsMin)) data = data.filter(m => (m.nsites ?? 0) >= nsMin);
  if (!isNaN(nsMax)) data = data.filter(m => (m.nsites ?? 0) <= nsMax);

  // Sort
  const sort = currentSort;
  if (sort === 'bandgap_asc') data.sort((a,b) => (a.band_gap??99) - (b.band_gap??99));
  if (sort === 'bandgap_desc') data.sort((a,b) => (b.band_gap??-1) - (a.band_gap??-1));
  if (sort === 'eform_asc') data.sort((a,b) => (a.formation_energy_per_atom??99) - (b.formation_energy_per_atom??99));
  if (sort === 'eform_desc') data.sort((a,b) => (b.formation_energy_per_atom??99) - (a.formation_energy_per_atom??99));
  if (sort === 'nsites_asc') data.sort((a,b) => (a.nsites??0) - (b.nsites??0));

  filteredResults = data;
  renderPage();
  renderPagination();
  document.getElementById('results-count').textContent = `Showing ${filteredResults.length} of ${allResults.length} materials`;
  renderActionPanels();
}

// Register range/filter inputs
['bg-min','bg-max','ef-min','ef-max','ns-min','ns-max'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => { currentPage = 1; applyFiltersAndSort(); });
});

// --- Render ---
function renderPage() {
  const grid = document.getElementById('results-grid');
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filteredResults.slice(start, start + PAGE_SIZE);

  if (filteredResults.length === 0) {
    grid.innerHTML = `<div class="state-msg"><div class="icon">🔬</div><p>No materials match your current filters.</p></div>`;
    return;
  }

  grid.innerHTML = page.map((m, i) => cardHTML(m, i)).join('');
}

function cardHTML(m, i) {
  const bg = m.band_gap !== null && m.band_gap !== undefined ? m.band_gap.toFixed(3) + ' eV' : 'N/A';
  const ef = m.formation_energy_per_atom !== null && m.formation_energy_per_atom !== undefined
    ? m.formation_energy_per_atom.toFixed(3) + ' eV/atom' : 'N/A';
  const dens = m.density !== null && m.density !== undefined ? m.density.toFixed(2) + ' g/cm³' : 'N/A';
  const ns = m.nsites ?? 'N/A';
  const typeClass = `type-${m._type}`;
  const typeLabel = m._type.charAt(0).toUpperCase() + m._type.slice(1);

  const isFav = favorites.has(m.material_id);
  const isCmp = compareSet.has(m.material_id);

  return `
  <div class="card${isCmp ? ' compare-selected' : ''}" data-mid="${m.material_id}" style="animation-delay:${i * 0.03}s;--sweep-delay:${(-(Math.random()*12)).toFixed(2)}s;--sweep-dur:${(20+Math.random()*12).toFixed(1)}s" onclick="openModal('${m.material_id}')">
    <div class="card-header">
      <span class="formula">${escHtml(m.formula_pretty || m.material_id)}</span>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <button class="card-star${isFav ? ' fav-active' : ''}" onclick="toggleFavorite(event,'${m.material_id}')" title="Favorite">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <span class="material-type ${typeClass}">${typeLabel}</span>
      </div>
    </div>
    <div class="mp-id">${m.material_id}</div>
    <div class="props-grid">
      <div class="prop">
        <div class="prop-label">Bandgap</div>
        <div class="prop-val highlight">${bg}</div>
      </div>
      <div class="prop">
        <div class="prop-label">Formation E</div>
        <div class="prop-val">${ef}</div>
      </div>
      <div class="prop">
        <div class="prop-label">Density</div>
        <div class="prop-val">${dens}</div>
      </div>
      <div class="prop">
        <div class="prop-label">N Sites</div>
        <div class="prop-val">${ns}</div>
      </div>
    </div>
    <div class="card-compare-row" onclick="event.stopPropagation()">
      <label class="compare-cb-wrap">
        <input type="checkbox" class="compare-cb" ${isCmp ? 'checked' : ''} onchange="toggleCompare(event,'${m.material_id}')">
        <span class="compare-cb-lbl">Compare</span>
      </label>
    </div>
  </div>`;
}

// --- Stats ---
function updateStats(data) {
  const metals = data.filter(m => m._type === 'metal').length;
  const sc = data.filter(m => m._type === 'semiconductor').length;
  const ins = data.filter(m => m._type === 'insulator').length;
  const bgs = data.map(m => m.band_gap).filter(v => v !== null && v !== undefined && v > 0);
  const avgBg = bgs.length ? (bgs.reduce((a,b)=>a+b,0)/bgs.length).toFixed(2) + ' eV' : '—';

  document.getElementById('stat-total').textContent = data.length;
  document.getElementById('stat-metals').textContent = metals;
  document.getElementById('stat-sc').textContent = sc;
  document.getElementById('stat-ins').textContent = ins;
  document.getElementById('stat-avg-bg').textContent = avgBg;
}

// --- Pagination ---
function renderPagination() {
  const total = Math.ceil(filteredResults.length / PAGE_SIZE);
  const pg = document.getElementById('pagination');
  if (total <= 1) { pg.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>← Prev</button>`;
  for (let i = 1; i <= total; i++) {
    if (total > 10 && i > 3 && i < total - 2 && Math.abs(i - currentPage) > 1) {
      if (i === 4 || i === total - 3) html += `<span style="color:var(--muted);padding:0 4px">…</span>`;
      continue;
    }
    html += `<button class="page-btn ${i===currentPage?'active':''}" onclick="goPage(${i})">${i}</button>`;
  }
  html += `<button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage===total?'disabled':''}>Next →</button>`;
  pg.innerHTML = html;
}

function goPage(n) {
  const total = Math.ceil(filteredResults.length / PAGE_SIZE);
  if (n < 1 || n > total) return;
  currentPage = n;
  renderPage();
  renderPagination();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Modal ---
function openModal(mid) {
  const m = allResults.find(r => r.material_id === mid) || favoriteData[mid];
  if (!m) return;

  const bg = m.band_gap !== null && m.band_gap !== undefined ? m.band_gap.toFixed(4) + ' eV' : 'N/A';
  const ef = m.formation_energy_per_atom !== null && m.formation_energy_per_atom !== undefined
    ? m.formation_energy_per_atom.toFixed(4) + ' eV/atom' : 'N/A';
  const dens = m.density !== null && m.density !== undefined ? m.density.toFixed(3) + ' g/cm³' : 'N/A';
  const vol = m.volume !== null && m.volume !== undefined ? m.volume.toFixed(2) + ' Å³' : 'N/A';
  const eah = m.e_above_hull !== null && m.e_above_hull !== undefined ? m.e_above_hull.toFixed(4) + ' eV/atom' : 'N/A';
  const ef2 = m.efermi !== null && m.efermi !== undefined ? m.efermi.toFixed(3) + ' eV' : 'N/A';
  const spacegroup = m.symmetry?.symbol ?? m.symmetry?.number ?? 'N/A';
  const typeClass = `type-${m._type}`;
  const typeLabel = m._type.charAt(0).toUpperCase() + m._type.slice(1);
  const elemTags = (m.elements||[]).map(e => `<span class="element-tag">${escHtml(e)}</span>`).join('');
  const mpUrl = `https://materialsproject.org/materials/${m.material_id}`;

  const isFav = favorites.has(m.material_id);
  const isCmp = compareSet.has(m.material_id);

  document.getElementById('modal-content').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:6px;">
      <h2>${escHtml(m.formula_pretty || m.material_id)}</h2>
      <span class="material-type ${typeClass}">${typeLabel}</span>
    </div>
    <div class="mp-id">${m.material_id} · <a href="${mpUrl}" target="_blank" style="color:var(--accent);text-decoration:none;">View on Materials Project ↗</a></div>
    <div class="modal-actions">
      <button class="modal-action-btn${isFav ? ' fav-active' : ''}" id="modal-fav-btn" onclick="toggleFavoriteFromModal('${m.material_id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        <span id="modal-fav-label">${isFav ? 'Unfavorite' : 'Favorite'}</span>
      </button>
      <button class="modal-action-btn${isCmp ? ' cmp-active' : ''}" id="modal-cmp-btn" onclick="toggleCompareFromModal('${m.material_id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="9" height="18" rx="2"/><rect x="13" y="3" width="9" height="18" rx="2"/>
        </svg>
        <span id="modal-cmp-label">${isCmp ? 'Remove from Compare' : 'Add to Compare'}</span>
      </button>
    </div>

    <div class="modal-section">
      <h3>Elements</h3>
      <div class="elements-list">${elemTags || '<span style="color:var(--muted)">N/A</span>'}</div>
    </div>

    <div class="modal-section">
      <h3>Electronic Properties</h3>
      <div class="modal-props">
        <div class="modal-prop"><div class="prop-label">Band Gap</div><div class="prop-val highlight">${bg}</div></div>
        <div class="modal-prop"><div class="prop-label">Fermi Energy</div><div class="prop-val">${ef2}</div></div>
      </div>
    </div>

    <div class="modal-section">
      <h3>Thermodynamic Properties</h3>
      <div class="modal-props">
        <div class="modal-prop"><div class="prop-label">Formation Energy</div><div class="prop-val">${ef}</div></div>
        <div class="modal-prop"><div class="prop-label">E Above Hull</div><div class="prop-val">${eah}</div></div>
        <div class="modal-prop"><div class="prop-label">Is Stable</div><div class="prop-val">${m.is_stable ? '✓ Yes' : '✗ No'}</div></div>
        <div class="modal-prop"><div class="prop-label">Theoretical</div><div class="prop-val">${m.theoretical ? 'Yes' : 'No'}</div></div>
      </div>
    </div>

    <div class="modal-section">
      <h3>Structure</h3>
      <div class="modal-props">
        <div class="modal-prop"><div class="prop-label">N Sites</div><div class="prop-val">${m.nsites ?? 'N/A'}</div></div>
        <div class="modal-prop"><div class="prop-label">Density</div><div class="prop-val">${dens}</div></div>
        <div class="modal-prop"><div class="prop-label">Volume</div><div class="prop-val">${vol}</div></div>
        <div class="modal-prop"><div class="prop-label">Space Group</div><div class="prop-val">${escHtml(String(spacegroup))}</div></div>
      </div>
    </div>

    <div class="modal-section">
      <h3>Other</h3>
      <div class="modal-props">
        <div class="modal-prop"><div class="prop-label">Magnetic</div><div class="prop-val">${m.is_magnetic ? 'Yes' : 'No'}</div></div>
      </div>
    </div>
  `;

  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModalBtn();
}

function closeModalBtn() {
  document.getElementById('modal-overlay').classList.remove('open');
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModalBtn(); });

// --- Periodic Table ---
const PT_CATEGORIES = {
  'alkali':           { label: 'Alkali',         color: '#f72585' },
  'alkaline-earth':   { label: 'Alkaline Earth', color: '#ff9a3c' },
  'transition':       { label: 'Transition',     color: '#4cc9f0' },
  'post-transition':  { label: 'Post-Transition',color: '#06d6a0' },
  'metalloid':        { label: 'Metalloid',      color: '#c77dff' },
  'nonmetal':         { label: 'Nonmetal',       color: '#7bc67e' },
  'halogen':          { label: 'Halogen',        color: '#48cae4' },
  'noble-gas':        { label: 'Noble Gas',      color: '#94a3b8' },
  'lanthanide':       { label: 'Lanthanide',     color: '#ffd166' },
  'actinide':         { label: 'Actinide',       color: '#f4a261' },
};

// [symbol, atomicNum, name, category, gridRow, gridCol]
const PT_DATA = [
  ['H',1,'Hydrogen','nonmetal',1,1],['He',2,'Helium','noble-gas',1,18],
  ['Li',3,'Lithium','alkali',2,1],['Be',4,'Beryllium','alkaline-earth',2,2],
  ['B',5,'Boron','metalloid',2,13],['C',6,'Carbon','nonmetal',2,14],
  ['N',7,'Nitrogen','nonmetal',2,15],['O',8,'Oxygen','nonmetal',2,16],
  ['F',9,'Fluorine','halogen',2,17],['Ne',10,'Neon','noble-gas',2,18],
  ['Na',11,'Sodium','alkali',3,1],['Mg',12,'Magnesium','alkaline-earth',3,2],
  ['Al',13,'Aluminum','post-transition',3,13],['Si',14,'Silicon','metalloid',3,14],
  ['P',15,'Phosphorus','nonmetal',3,15],['S',16,'Sulfur','nonmetal',3,16],
  ['Cl',17,'Chlorine','halogen',3,17],['Ar',18,'Argon','noble-gas',3,18],
  ['K',19,'Potassium','alkali',4,1],['Ca',20,'Calcium','alkaline-earth',4,2],
  ['Sc',21,'Scandium','transition',4,3],['Ti',22,'Titanium','transition',4,4],
  ['V',23,'Vanadium','transition',4,5],['Cr',24,'Chromium','transition',4,6],
  ['Mn',25,'Manganese','transition',4,7],['Fe',26,'Iron','transition',4,8],
  ['Co',27,'Cobalt','transition',4,9],['Ni',28,'Nickel','transition',4,10],
  ['Cu',29,'Copper','transition',4,11],['Zn',30,'Zinc','transition',4,12],
  ['Ga',31,'Gallium','post-transition',4,13],['Ge',32,'Germanium','metalloid',4,14],
  ['As',33,'Arsenic','metalloid',4,15],['Se',34,'Selenium','nonmetal',4,16],
  ['Br',35,'Bromine','halogen',4,17],['Kr',36,'Krypton','noble-gas',4,18],
  ['Rb',37,'Rubidium','alkali',5,1],['Sr',38,'Strontium','alkaline-earth',5,2],
  ['Y',39,'Yttrium','transition',5,3],['Zr',40,'Zirconium','transition',5,4],
  ['Nb',41,'Niobium','transition',5,5],['Mo',42,'Molybdenum','transition',5,6],
  ['Tc',43,'Technetium','transition',5,7],['Ru',44,'Ruthenium','transition',5,8],
  ['Rh',45,'Rhodium','transition',5,9],['Pd',46,'Palladium','transition',5,10],
  ['Ag',47,'Silver','transition',5,11],['Cd',48,'Cadmium','transition',5,12],
  ['In',49,'Indium','post-transition',5,13],['Sn',50,'Tin','post-transition',5,14],
  ['Sb',51,'Antimony','metalloid',5,15],['Te',52,'Tellurium','metalloid',5,16],
  ['I',53,'Iodine','halogen',5,17],['Xe',54,'Xenon','noble-gas',5,18],
  ['Cs',55,'Cesium','alkali',6,1],['Ba',56,'Barium','alkaline-earth',6,2],
  ['*',0,'57–71','lanthanide',6,3],
  ['Hf',72,'Hafnium','transition',6,4],['Ta',73,'Tantalum','transition',6,5],
  ['W',74,'Tungsten','transition',6,6],['Re',75,'Rhenium','transition',6,7],
  ['Os',76,'Osmium','transition',6,8],['Ir',77,'Iridium','transition',6,9],
  ['Pt',78,'Platinum','transition',6,10],['Au',79,'Gold','transition',6,11],
  ['Hg',80,'Mercury','transition',6,12],['Tl',81,'Thallium','post-transition',6,13],
  ['Pb',82,'Lead','post-transition',6,14],['Bi',83,'Bismuth','post-transition',6,15],
  ['Po',84,'Polonium','metalloid',6,16],['At',85,'Astatine','halogen',6,17],
  ['Rn',86,'Radon','noble-gas',6,18],
  ['Fr',87,'Francium','alkali',7,1],['Ra',88,'Radium','alkaline-earth',7,2],
  ['**',0,'89–103','actinide',7,3],
  ['Rf',104,'Rutherfordium','transition',7,4],['Db',105,'Dubnium','transition',7,5],
  ['Sg',106,'Seaborgium','transition',7,6],['Bh',107,'Bohrium','transition',7,7],
  ['Hs',108,'Hassium','transition',7,8],['Mt',109,'Meitnerium','transition',7,9],
  ['Ds',110,'Darmstadtium','transition',7,10],['Rg',111,'Roentgenium','transition',7,11],
  ['Cn',112,'Copernicium','transition',7,12],['Nh',113,'Nihonium','post-transition',7,13],
  ['Fl',114,'Flerovium','post-transition',7,14],['Mc',115,'Moscovium','post-transition',7,15],
  ['Lv',116,'Livermorium','post-transition',7,16],['Ts',117,'Tennessine','halogen',7,17],
  ['Og',118,'Oganesson','noble-gas',7,18],
  // Lanthanides (row 9 = main row 7 + spacer row 8 + 1)
  ['La',57,'Lanthanum','lanthanide',9,3],['Ce',58,'Cerium','lanthanide',9,4],
  ['Pr',59,'Praseodymium','lanthanide',9,5],['Nd',60,'Neodymium','lanthanide',9,6],
  ['Pm',61,'Promethium','lanthanide',9,7],['Sm',62,'Samarium','lanthanide',9,8],
  ['Eu',63,'Europium','lanthanide',9,9],['Gd',64,'Gadolinium','lanthanide',9,10],
  ['Tb',65,'Terbium','lanthanide',9,11],['Dy',66,'Dysprosium','lanthanide',9,12],
  ['Ho',67,'Holmium','lanthanide',9,13],['Er',68,'Erbium','lanthanide',9,14],
  ['Tm',69,'Thulium','lanthanide',9,15],['Yb',70,'Ytterbium','lanthanide',9,16],
  ['Lu',71,'Lutetium','lanthanide',9,17],
  // Actinides (row 10)
  ['Ac',89,'Actinium','actinide',10,3],['Th',90,'Thorium','actinide',10,4],
  ['Pa',91,'Protactinium','actinide',10,5],['U',92,'Uranium','actinide',10,6],
  ['Np',93,'Neptunium','actinide',10,7],['Pu',94,'Plutonium','actinide',10,8],
  ['Am',95,'Americium','actinide',10,9],['Cm',96,'Curium','actinide',10,10],
  ['Bk',97,'Berkelium','actinide',10,11],['Cf',98,'Californium','actinide',10,12],
  ['Es',99,'Einsteinium','actinide',10,13],['Fm',100,'Fermium','actinide',10,14],
  ['Md',101,'Mendelevium','actinide',10,15],['No',102,'Nobelium','actinide',10,16],
  ['Lr',103,'Lawrencium','actinide',10,17],
];

function buildPeriodicTable() {
  const legend = document.getElementById('pt-legend');
  legend.innerHTML = Object.entries(PT_CATEGORIES).map(([, v]) =>
    `<div class="pt-legend-item">
      <div class="pt-legend-dot" style="background:${v.color}"></div>
      <span>${v.label}</span>
    </div>`
  ).join('');

  const table = document.getElementById('periodic-table');
  table.innerHTML = PT_DATA.map(([sym, num, name, cat, row, col]) => {
    const isPlaceholder = num === 0;
    if (isPlaceholder) {
      return `<div class="pt-cell pt-${cat} pt-placeholder" style="grid-column:${col};grid-row:${row};">
        <span>${name}</span>
      </div>`;
    }
    return `<div class="pt-cell pt-${cat}" style="grid-column:${col};grid-row:${row};"
        onclick="clickElement('${sym}')" title="${name} (${sym}, Z=${num})">
      <span class="pt-num">${num}</span>
      <span class="pt-sym">${sym}</span>
      <span class="pt-name">${name}</span>
    </div>`;
  }).join('');
}

function clickElement(symbol) {
  clearTimeout(debounceTimer);
  document.getElementById('element-input').value = symbol;
  doSearch();
}

function goRandomMaterial() {
  const common = PT_DATA.filter(([, num]) => num > 0 && num <= 86);
  const count = Math.random() < 0.55 ? 2 : 3;
  const shuffled = [...common].sort(() => Math.random() - 0.5);
  const syms = shuffled.slice(0, count).map(([sym]) => sym).sort();
  const chemsys = syms.join('-');
  document.getElementById('element-input').value = chemsys;
  doSearch();
}

buildPeriodicTable();

// --- Helpers ---
function showLoading() {
  document.getElementById('periodic-table-section').style.display = 'none';
  const grid = document.getElementById('results-grid');
  grid.style.display = '';
  grid.innerHTML = `
    <div class="loader active">
      <div class="spinner"></div>
      <div class="loader-text">Querying Materials Project…</div>
    </div>`;
  document.getElementById('pagination').innerHTML = '';
  document.getElementById('results-count').textContent = '';
}

function showError(msg) {
  document.getElementById('periodic-table-section').style.display = 'none';
  const grid = document.getElementById('results-grid');
  grid.style.display = '';
  grid.innerHTML = `
    <div class="state-msg">
      <div class="icon">⚠</div>
      <p>${msg}</p>
    </div>`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Favorites ────────────────────────────────────────────
let favorites = new Set(JSON.parse(localStorage.getItem('mp_fav_ids') || '[]'));
let favoriteData = JSON.parse(localStorage.getItem('mp_fav_data') || '{}');

function saveFavorites() {
  localStorage.setItem('mp_fav_ids', JSON.stringify([...favorites]));
  localStorage.setItem('mp_fav_data', JSON.stringify(favoriteData));
  updateFavBadge();
}

function updateFavBadge() {
  const badge = document.getElementById('fav-badge');
  const n = favorites.size;
  badge.textContent = n;
  badge.style.display = n > 0 ? 'flex' : 'none';
}

function toggleFavorite(e, mid) {
  e.stopPropagation();
  if (favorites.has(mid)) {
    favorites.delete(mid);
    delete favoriteData[mid];
  } else {
    favorites.add(mid);
    const m = allResults.find(r => r.material_id === mid) || favoriteData[mid];
    if (m) favoriteData[mid] = m;
  }
  saveFavorites();
  const isFav = favorites.has(mid);
  document.querySelectorAll(`.card[data-mid="${mid}"] .card-star`).forEach(btn => {
    btn.classList.toggle('fav-active', isFav);
    btn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
  });
}

function openFavoritesModal() {
  const items = Object.values(favoriteData);
  const body = document.getElementById('fav-modal-body');
  if (items.length === 0) {
    body.innerHTML = `<div class="state-msg" style="padding:40px 0">
      <div class="icon">⭐</div>
      <p>No favorites yet. Click the star on any material card to save it here.</p>
    </div>`;
  } else {
    body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
      ${items.map((m, i) => cardHTML(m, i)).join('')}
    </div>`;
  }
  document.getElementById('fav-modal').classList.add('open');
}

function closeFavModal() {
  document.getElementById('fav-modal').classList.remove('open');
}

// ─── Export CSV ───────────────────────────────────────────
function exportCSV() {
  if (filteredResults.length === 0) return;
  if (!confirm(`Export ${filteredResults.length} material${filteredResults.length !== 1 ? 's' : ''} as CSV?`)) return;
  const headers = ['material_id','formula','type','band_gap_eV','formation_energy_eV_atom','density_g_cm3','nsites','is_stable','elements'];
  const rows = filteredResults.map(m => [
    m.material_id,
    m.formula_pretty || '',
    m._type,
    m.band_gap ?? '',
    m.formation_energy_per_atom ?? '',
    m.density ?? '',
    m.nsites ?? '',
    m.is_stable ? 'true' : 'false',
    (m.elements || []).join(';')
  ]);
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `materials_export_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV downloaded');
}

function showToast(msg) {
  const t = document.getElementById('export-toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── Compare ─────────────────────────────────────────────
let compareSet = new Set();

function toggleCompare(e, mid) {
  e.stopPropagation();
  if (compareSet.has(mid)) {
    compareSet.delete(mid);
  } else {
    if (compareSet.size >= 3) {
      showToast('Max 3 materials for compare');
      e.currentTarget.checked = false;
      return;
    }
    compareSet.add(mid);
  }
  const card = document.querySelector(`.card[data-mid="${mid}"]`);
  if (card) card.classList.toggle('compare-selected', compareSet.has(mid));
  updateCompareBadge();
  renderActionPanels();
}

function updateCompareBadge() {
  const badge = document.getElementById('compare-badge');
  const n = compareSet.size;
  badge.textContent = n;
  badge.style.display = n > 0 ? 'flex' : 'none';
  document.getElementById('compare-sb-btn').classList.toggle('sb-active', n > 0);
}

function clearCompare() {
  compareSet.clear();
  document.querySelectorAll('.card.compare-selected').forEach(c => {
    c.classList.remove('compare-selected');
    const cb = c.querySelector('.compare-cb');
    if (cb) cb.checked = false;
  });
  updateCompareBadge();
  document.getElementById('compare-modal').classList.remove('open');
  renderActionPanels();
}

function openCompareModal() {
  const body = document.getElementById('compare-modal-body');
  if (compareSet.size < 2) {
    body.innerHTML = `<div class="compare-hint">Select 2 or 3 materials using the <strong>Compare</strong> checkbox on each card, then click Compare again.</div>`;
    document.getElementById('compare-modal').classList.add('open');
    return;
  }
  const items = [...compareSet]
    .map(mid => allResults.find(r => r.material_id === mid) || favoriteData[mid])
    .filter(Boolean);

  const fmt = (v, suffix='') => (v !== null && v !== undefined) ? v + suffix : '—';

  const rows = [
    ['Formula',        m => escHtml(m.formula_pretty || m.material_id)],
    ['ID',             m => m.material_id],
    ['Type',           m => `<span class="material-type type-${m._type}" style="font-size:10px;padding:3px 10px">${m._type}</span>`],
    ['Band Gap',       m => fmt(m.band_gap?.toFixed(3), ' eV'), true],
    ['Formation E',    m => fmt(m.formation_energy_per_atom?.toFixed(3), ' eV/atom')],
    ['E Above Hull',   m => fmt(m.e_above_hull?.toFixed(4), ' eV/atom')],
    ['Density',        m => fmt(m.density?.toFixed(2), ' g/cm³')],
    ['N Sites',        m => fmt(m.nsites)],
    ['Space Group',    m => escHtml(String(m.symmetry?.symbol ?? m.symmetry?.number ?? '—'))],
    ['Stable',         m => m.is_stable ? '✓ Yes' : '✗ No'],
    ['Magnetic',       m => m.is_magnetic ? 'Yes' : 'No'],
    ['Elements',       m => (m.elements || []).join(', ')],
  ];

  const headerCells = items.map(m =>
    `<th>${escHtml(m.formula_pretty || m.material_id)}<br>
     <span style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);font-weight:400">${m.material_id}</span></th>`
  ).join('');

  const bodyRows = rows.map(([label, fn, highlight]) =>
    `<tr>
      <th class="prop-col">${label}</th>
      ${items.map(m => `<td class="${highlight ? 'val-hi' : ''}">${fn(m)}</td>`).join('')}
    </tr>`
  ).join('');

  body.innerHTML = `
    <div class="compare-wrap">
      <table class="compare-tbl">
        <thead><tr><th class="prop-col"></th>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  document.getElementById('compare-modal').classList.add('open');
}

// ─── Modal favorite / compare toggles ────────────────────
function toggleFavoriteFromModal(mid) {
  if (favorites.has(mid)) {
    favorites.delete(mid);
    delete favoriteData[mid];
  } else {
    favorites.add(mid);
    const m = allResults.find(r => r.material_id === mid) || favoriteData[mid];
    if (m) favoriteData[mid] = m;
  }
  saveFavorites();
  const isFav = favorites.has(mid);
  const btn = document.getElementById('modal-fav-btn');
  if (btn) {
    btn.classList.toggle('fav-active', isFav);
    btn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
    document.getElementById('modal-fav-label').textContent = isFav ? 'Unfavorite' : 'Favorite';
  }
  document.querySelectorAll(`.card[data-mid="${mid}"] .card-star`).forEach(s => {
    s.classList.toggle('fav-active', isFav);
    s.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
  });
}

function toggleCompareFromModal(mid) {
  const btn = document.getElementById('modal-cmp-btn');
  if (compareSet.has(mid)) {
    compareSet.delete(mid);
  } else {
    if (compareSet.size >= 3) { showToast('Max 3 materials for compare'); return; }
    compareSet.add(mid);
  }
  updateCompareBadge();
  renderActionPanels();
  const isCmp = compareSet.has(mid);
  if (btn) {
    btn.classList.toggle('cmp-active', isCmp);
    document.getElementById('modal-cmp-label').textContent = isCmp ? 'Remove from Compare' : 'Add to Compare';
  }
  const card = document.querySelector(`.card[data-mid="${mid}"]`);
  if (card) {
    card.classList.toggle('compare-selected', isCmp);
    const cb = card.querySelector('.compare-cb');
    if (cb) cb.checked = isCmp;
  }
}

// ─── Shared panel close on backdrop click ─────────────────
function closePanelModal(id, e) {
  if (e.target === document.getElementById(id)) {
    document.getElementById(id).classList.remove('open');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['fav-modal','compare-modal'].forEach(id => document.getElementById(id).classList.remove('open'));
  }
});

updateFavBadge();
renderActionPanels();

// ─── Scroll progress bar ──────────────────────────────────
const scrollProgress = document.getElementById('scroll-progress');
window.addEventListener('scroll', () => {
  const total = document.body.scrollHeight - window.innerHeight;
  scrollProgress.style.width = total > 0 ? (window.scrollY / total * 100) + '%' : '0%';
}, { passive: true });

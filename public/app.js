// --- State ---
let authToken = localStorage.getItem('authToken') || null;
let currentPlan = null;
let selectedDay = -1;
let currentTip = '';
let recipeFilter = 'all';
let recipeSearch = '';

// --- API helper ---
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (authToken) opts.headers['x-auth-token'] = authToken;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`/api${path}`, opts);
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      authToken = null;
      localStorage.removeItem('authToken');
      showPage('login');
    }
    throw new Error(data.error || 'Fehler');
  }
  return data;
}

// --- Page management ---
function showPage(page) {
  document.getElementById('page-login').style.display = 'none';
  document.getElementById('page-setup').style.display = 'none';
  document.getElementById('page-main').style.display = 'none';

  if (page === 'login') {
    document.getElementById('page-login').style.display = '';
  } else if (page === 'setup') {
    document.getElementById('page-setup').style.display = '';
  } else if (page === 'main') {
    document.getElementById('page-main').style.display = '';
  }
}

// --- Router ---
function getHash() {
  return window.location.hash.slice(1) || 'plan';
}

function navigate(hash) {
  window.location.hash = hash;
}

async function route() {
  if (!authToken) return;

  const hash = getHash();
  const content = document.getElementById('content');
  const header = document.getElementById('header-title');
  const navItems = document.querySelectorAll('.nav-item');

  // Update nav
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.page === hash.split('/')[0]);
  });

  if (hash === 'plan') {
    header.textContent = 'Wochenplan';
    await renderPlan(content);
  } else if (hash.startsWith('recipe/')) {
    const id = hash.split('/')[1];
    header.textContent = 'Rezept';
    await renderRecipeDetail(content, id);
  } else if (hash === 'recipes') {
    header.textContent = 'Alle Rezepte';
    await renderRecipeList(content);
  } else if (hash === 'shopping') {
    header.textContent = 'Einkaufsliste';
    await renderShoppingList(content);
  } else if (hash === 'learn') {
    header.textContent = 'Lernen';
    await renderLearn(content);
  } else {
    navigate('plan');
  }
}

// --- Plan Page ---
async function renderPlan(container) {
  container.innerHTML = '<div class="loading">Laden...</div>';

  try {
    const [plan, tipData] = await Promise.all([
      api('GET', '/weekplan'),
      api('GET', '/tip'),
    ]);
    currentPlan = plan;
    currentTip = tipData.tip;

    if (selectedDay < 0) {
      const today = new Date().getDay();
      selectedDay = today === 0 ? 6 : today - 1;
    }

    renderPlanContent(container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Fehler beim Laden: ${e.message}</p></div>`;
  }
}

function renderPlanContent(container) {
  const plan = currentPlan;
  const day = plan.days[selectedDay];
  const dayShort = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const today = new Date().getDay();
  const todayIdx = today === 0 ? 6 : today - 1;

  let html = '';

  // Tip of the day
  html += `<div class="tip-card">
    <div class="tip-label">Tipp des Tages</div>
    <div>${currentTip}</div>
  </div>`;

  // Day tabs
  html += '<div class="day-tabs">';
  for (let i = 0; i < 7; i++) {
    const active = i === selectedDay ? 'active' : '';
    const isToday = i === todayIdx ? 'today' : '';
    html += `<div class="day-tab ${active} ${isToday}" data-day="${i}">
      <span>${dayShort[i]}</span>
      ${i === todayIdx ? '<span class="day-tab-label">Heute</span>' : ''}
    </div>`;
  }
  html += '</div>';

  // Breakfast
  html += '<div class="meal-section">';
  html += '<div class="meal-label">Fruehstueck</div>';
  if (day.breakfastRecipe) {
    html += renderMealCard(day.breakfastRecipe, selectedDay, 'breakfast');
  } else {
    html += '<div class="recipe-card"><em>Kein Rezept</em></div>';
  }
  html += '</div>';

  // Dinner
  html += '<div class="meal-section">';
  html += '<div class="meal-label">Abendessen</div>';
  if (day.dinnerRecipe) {
    html += renderMealCard(day.dinnerRecipe, selectedDay, 'dinner');
  } else {
    html += '<div class="recipe-card"><em>Kein Rezept</em></div>';
  }
  html += '</div>';

  // Generate new plan button
  html += `<div class="generate-section">
    <button class="btn btn-outline" id="generate-btn">Neuen Wochenplan erstellen</button>
  </div>`;

  container.innerHTML = html;

  // Event listeners
  container.querySelectorAll('.day-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      selectedDay = parseInt(tab.dataset.day);
      renderPlanContent(container);
    });
  });

  container.querySelectorAll('.recipe-card[data-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.swap-btn') || e.target.closest('.icon-btn')) return;
      navigate('recipe/' + card.dataset.id);
    });
  });

  container.querySelectorAll('.swap-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dayIdx = parseInt(btn.dataset.day);
      const type = btn.dataset.type;
      btn.textContent = '...';
      btn.disabled = true;
      try {
        const result = await api('POST', '/weekplan/swap', { dayIndex: dayIdx, mealType: type });
        currentPlan.days[dayIdx] = result.day;
        renderPlanContent(container);
      } catch (e) {
        alert('Fehler: ' + e.message);
        btn.textContent = 'Tauschen';
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      try {
        const result = await api('POST', `/recipes/${id}/favorite`);
        btn.classList.toggle('active', result.isFavorite);
        btn.textContent = result.isFavorite ? '\u2605' : '\u2606';
      } catch (e) {
        alert('Fehler: ' + e.message);
      }
    });
  });

  const genBtn = document.getElementById('generate-btn');
  if (genBtn) {
    genBtn.addEventListener('click', async () => {
      if (!confirm('Neuen Wochenplan erstellen? Der aktuelle Plan wird ersetzt.')) return;
      genBtn.textContent = 'Erstelle...';
      genBtn.disabled = true;
      try {
        currentPlan = await api('POST', '/weekplan/generate');
        renderPlanContent(container);
      } catch (e) {
        alert('Fehler: ' + e.message);
        genBtn.textContent = 'Neuen Wochenplan erstellen';
        genBtn.disabled = false;
      }
    });
  }
}

function renderMealCard(recipe, dayIdx, mealType) {
  const isFav = currentPlan.days.some(() => false); // determined from recipe data
  return `<div class="recipe-card" data-id="${recipe.id}">
    <div class="recipe-card-header">
      <div class="recipe-card-name">${recipe.name}</div>
      <div class="recipe-card-actions">
        <button class="icon-btn fav-btn ${recipe.isFavorite ? 'active' : ''}" data-id="${recipe.id}"
          title="Favorit">${recipe.isFavorite ? '\u2605' : '\u2606'}</button>
        <button class="swap-btn" data-day="${dayIdx}" data-type="${mealType}">Tauschen</button>
      </div>
    </div>
    <div class="recipe-card-meta">
      <span>${recipe.prepTime} Min.</span>
      ${recipe.cuisine ? '<span>' + recipe.cuisine + '</span>' : ''}
      ${recipe.category ? '<span>' + recipe.category + '</span>' : ''}
    </div>
  </div>`;
}

// --- Recipe Detail ---
async function renderRecipeDetail(container, id) {
  container.innerHTML = '<div class="loading">Laden...</div>';

  try {
    const recipe = await api('GET', `/recipes/${id}`);
    const typeLabel = recipe.type === 'breakfast' ? 'Fruehstueck' : 'Abendessen';

    let html = '<div class="recipe-detail">';

    // Back link
    html += `<button id="detail-back" class="btn btn-small btn-outline mb-16">&larr; Zurueck</button>`;

    html += `<h2>${recipe.name}</h2>`;

    // Badges
    html += '<div class="recipe-badges">';
    html += `<span class="badge badge-time">${recipe.prepTime} Min.</span>`;
    html += `<span class="badge badge-type">${typeLabel}</span>`;
    if (recipe.cuisine) html += `<span class="badge badge-cuisine">${recipe.cuisine}</span>`;
    html += '</div>';

    // Ingredients
    html += '<div class="detail-section"><h3>Zutaten (3 Portionen)</h3><ul class="ingredients-list">';
    for (const ing of recipe.ingredients) {
      html += `<li>${ing.text}</li>`;
    }
    html += '</ul></div>';

    // Instructions
    if (recipe.instructions.length > 0) {
      html += '<div class="detail-section"><h3>Zubereitung</h3><ol class="instructions-list">';
      for (const step of recipe.instructions) {
        html += `<li>${step}</li>`;
      }
      html += '</ol></div>';
    }

    // Skin benefits
    if (recipe.skinBenefits) {
      html += `<div class="detail-section"><h3>Gut fuer die Haut</h3>
        <div class="skin-benefits">${recipe.skinBenefits}</div></div>`;
    }

    // Action buttons
    html += '<div class="detail-actions">';
    html += `<button class="btn btn-small btn-outline ${recipe.isFavorite ? 'fav-active' : ''}" id="detail-fav" data-id="${recipe.id}">
      ${recipe.isFavorite ? '\u2605 Favorit' : '\u2606 Favorit'}</button>`;
    html += `<button class="btn btn-small btn-outline ${recipe.isExcluded ? 'excl-active' : ''}" id="detail-excl" data-id="${recipe.id}">
      ${recipe.isExcluded ? 'Wieder anzeigen' : 'Ausschliessen'}</button>`;
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;

    // Back button
    document.getElementById('detail-back').addEventListener('click', () => {
      history.back();
    });

    // Favorite button
    document.getElementById('detail-fav').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try {
        const result = await api('POST', `/recipes/${recipe.id}/favorite`);
        recipe.isFavorite = result.isFavorite;
        btn.classList.toggle('fav-active', result.isFavorite);
        btn.innerHTML = result.isFavorite ? '\u2605 Favorit' : '\u2606 Favorit';
      } catch (err) {
        alert('Fehler: ' + err.message);
      }
    });

    // Exclude button
    document.getElementById('detail-excl').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try {
        const result = await api('POST', `/recipes/${recipe.id}/exclude`);
        recipe.isExcluded = result.isExcluded;
        btn.classList.toggle('excl-active', result.isExcluded);
        btn.textContent = result.isExcluded ? 'Wieder anzeigen' : 'Ausschliessen';
      } catch (err) {
        alert('Fehler: ' + err.message);
      }
    });

  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Rezept nicht gefunden</p>
      <button class="btn btn-small btn-outline" onclick="history.back()">Zurueck</button></div>`;
  }
}

// --- Recipe List ---
async function renderRecipeList(container) {
  container.innerHTML = '<div class="loading">Laden...</div>';

  try {
    const params = new URLSearchParams();
    if (recipeFilter !== 'all') params.set('type', recipeFilter);
    if (recipeSearch) params.set('search', recipeSearch);

    const recipes = await api('GET', `/recipes?${params.toString()}`);

    let html = '';

    // Search
    html += `<input type="search" class="search-input" placeholder="Rezept suchen..." value="${recipeSearch}" id="recipe-search">`;

    // Filters
    html += '<div class="filter-bar">';
    for (const [val, label] of [['all', 'Alle'], ['breakfast', 'Fruehstueck'], ['dinner', 'Abendessen']]) {
      html += `<button class="filter-btn ${recipeFilter === val ? 'active' : ''}" data-filter="${val}">${label}</button>`;
    }
    html += '</div>';

    // Recipe count
    html += `<p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px">${recipes.length} Rezepte</p>`;

    // List
    if (recipes.length === 0) {
      html += '<div class="empty-state"><p>Keine Rezepte gefunden</p></div>';
    } else {
      for (const r of recipes) {
        const typeLabel = r.type === 'breakfast' ? 'Fruehstueck' : 'Abendessen';
        html += `<div class="recipe-list-item ${r.isExcluded ? 'excluded' : ''}" data-id="${r.id}">
          <div class="recipe-list-info">
            <div class="recipe-list-name">${r.name}</div>
            <div class="recipe-list-meta">${typeLabel} &middot; ${r.prepTime} Min.${r.cuisine ? ' &middot; ' + r.cuisine : ''}</div>
          </div>
          <div class="recipe-list-fav">${r.isFavorite ? '\u2605' : ''}</div>
        </div>`;
      }
    }

    container.innerHTML = html;

    // Event listeners
    container.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        recipeFilter = btn.dataset.filter;
        renderRecipeList(container);
      });
    });

    const searchInput = document.getElementById('recipe-search');
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        recipeSearch = searchInput.value;
        renderRecipeList(container);
      }, 300);
    });

    container.querySelectorAll('.recipe-list-item').forEach(item => {
      item.addEventListener('click', () => {
        navigate('recipe/' + item.dataset.id);
      });
    });

  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Fehler: ${e.message}</p></div>`;
  }
}

// --- Shopping List ---
async function renderShoppingList(container) {
  container.innerHTML = '<div class="loading">Laden...</div>';

  try {
    const data = await api('GET', '/shopping-list');
    const categoryNames = {
      'obst & gemuese': 'Obst & Gemuese',
      'kuehlregal': 'Kuehlregal',
      'vorratskammer': 'Vorratskammer',
      'nuesse & samen': 'Nuesse & Samen',
      'gewuerze': 'Gewuerze',
      'tiefkuehl': 'Tiefkuehl',
      'sonstiges': 'Sonstiges',
    };

    const categoryOrder = ['obst & gemuese', 'kuehlregal', 'vorratskammer', 'nuesse & samen', 'gewuerze', 'tiefkuehl', 'sonstiges'];

    let html = '';
    let totalItems = 0;

    if (!data.categories || Object.keys(data.categories).length === 0) {
      html += '<div class="empty-state"><p>Kein Wochenplan vorhanden. Erstelle zuerst einen Wochenplan.</p></div>';
    } else {
      for (const cat of categoryOrder) {
        const items = data.categories[cat];
        if (!items || items.length === 0) continue;

        totalItems += items.length;
        html += `<div class="shopping-category">
          <div class="shopping-category-title">${categoryNames[cat] || cat}</div>`;

        for (const item of items) {
          html += `<div class="shopping-item ${item.checked ? 'checked' : ''}" data-key="${item.key}">
            <input type="checkbox" class="shopping-checkbox" ${item.checked ? 'checked' : ''}>
            <span class="shopping-item-text">${item.name}</span>
            <span class="shopping-item-amount">${item.displayAmount}</span>
          </div>`;
        }
        html += '</div>';
      }

      if (totalItems > 0) {
        html += `<p class="text-center mt-16" style="font-size:0.8rem;color:var(--text-secondary)">${totalItems} Zutaten fuer 14 Mahlzeiten</p>`;
      }
    }

    container.innerHTML = html;

    // Checkbox handlers
    container.querySelectorAll('.shopping-item').forEach(item => {
      const checkbox = item.querySelector('.shopping-checkbox');
      const handler = async () => {
        const checked = checkbox.checked;
        item.classList.toggle('checked', checked);
        try {
          await api('POST', '/shopping-list/check', { key: item.dataset.key, checked });
        } catch (e) {
          // revert on error
          checkbox.checked = !checked;
          item.classList.toggle('checked', !checked);
        }
      };
      checkbox.addEventListener('change', handler);
    });

  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Fehler: ${e.message}</p></div>`;
  }
}

// --- Learn Page ---
function evidenceClass(ev) {
  if (!ev) return '';
  return 'evidence-' + ev.replace(/\s+/g, '-').toLowerCase();
}

function evidenceLabel(ev) {
  if (!ev) return '';
  const map = {
    'sehr stark': 'Sehr starke Evidenz',
    'stark': 'Starke Evidenz',
    'mittel-stark': 'Mittlere-starke Evidenz',
    'mittel': 'Mittlere Evidenz',
    'schwach-mittel': 'Schwache-mittlere Evidenz',
    'schwach': 'Schwache Evidenz',
  };
  return map[ev.toLowerCase()] || ev;
}

function renderActionPlanSection(section) {
  let html = '';
  for (const item of section.items) {
    html += `<div class="learn-card">
      <div class="learn-card-title">${item.title}</div>
      <div class="learn-card-summary">${item.subtitle}</div>
      <ul class="action-list" style="margin-top:8px">`;
    for (const entry of item.content) {
      html += `<li class="action-item">
        ${entry.action}
        <div class="action-badges">
          ${entry.evidence ? `<span class="evidence-badge ${evidenceClass(entry.evidence)}">${evidenceLabel(entry.evidence)}</span>` : ''}
          <span class="badge badge-time">Aufwand: ${entry.effort}</span>
        </div>
      </li>`;
    }
    html += '</ul></div>';
  }
  return html;
}

function renderStandardSection(section) {
  let html = '';
  for (const item of section.items) {
    html += `<div class="learn-card" data-expandable>
      <div class="learn-card-header">
        <div class="learn-card-title">${item.title}</div>
        ${item.evidence ? `<span class="evidence-badge ${evidenceClass(item.evidence)}">${evidenceLabel(item.evidence)}</span>` : ''}
      </div>
      <div class="learn-card-summary">${item.summary}</div>`;

    // Meta badges (dosage, timing)
    if (item.dosage || item.timing) {
      html += '<div class="learn-card-meta">';
      if (item.dosage) html += `<span class="badge badge-type">${item.dosage}</span>`;
      if (item.timing) html += `<span class="badge badge-time">${item.timing}</span>`;
      html += '</div>';
    }

    // Expandable details
    if (item.details || (item.sources && item.sources.length > 0)) {
      html += '<div class="learn-card-details">';
      if (item.details) {
        html += `<div class="learn-detail-row"><div class="learn-detail-value">${item.details}</div></div>`;
      }
      if (item.sources && item.sources.length > 0) {
        html += `<div class="learn-sources"><span class="learn-detail-label">Quellen:</span> ${item.sources.join(', ')}</div>`;
      }
      html += '</div>';
    }

    html += '</div>';
  }
  return html;
}

async function renderLearn(container) {
  container.innerHTML = '<div class="loading">Laden...</div>';

  try {
    const data = await api('GET', '/learn');

    let html = '';

    // Disclaimer
    html += `<div class="learn-disclaimer">${data.disclaimer}</div>`;

    // Sections
    for (const section of data.sections) {
      const isActionPlan = section.id === 'actionplan';

      html += `<div class="learn-section" data-section="${section.id}">
        <div class="learn-section-header">
          <div class="learn-section-title">
            ${section.title}
            <span class="learn-section-arrow">&#x25B6;</span>
          </div>
          <div class="learn-section-subtitle">${section.subtitle}</div>
        </div>
        <div class="learn-section-body">
          ${isActionPlan ? renderActionPlanSection(section) : renderStandardSection(section)}
        </div>
      </div>`;
    }

    container.innerHTML = html;

    // Section toggle
    container.querySelectorAll('.learn-section-header').forEach(header => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('open');
      });
    });

    // Card expand/collapse
    container.querySelectorAll('.learn-card[data-expandable]').forEach(card => {
      card.addEventListener('click', () => {
        card.classList.toggle('open');
      });
    });

    // Auto-open first section
    const first = container.querySelector('.learn-section');
    if (first) first.classList.add('open');

  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Fehler: ${e.message}</p></div>`;
  }
}

// --- Init ---
async function init() {
  try {
    const status = await api('GET', '/status');

    if (!status.hasPassword) {
      showPage('setup');
    } else if (!status.loggedIn) {
      showPage('login');
    } else {
      showPage('main');
      await route();
    }
  } catch (e) {
    showPage('login');
  }
}

// --- Logout ---
document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await api('POST', '/logout'); } catch (e) { /* ignore */ }
  authToken = null;
  localStorage.removeItem('authToken');
  showPage('login');
});

// --- Login form ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  btn.disabled = true;
  btn.textContent = '...';
  errEl.style.display = 'none';

  try {
    const data = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    }).then(r => r.json());

    if (data.error) throw new Error(data.error);

    authToken = data.token;
    localStorage.setItem('authToken', authToken);
    showPage('main');
    navigate('plan');
    await route();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Einloggen';
  }
});

// --- Setup form ---
document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw1 = document.getElementById('setup-password').value;
  const pw2 = document.getElementById('setup-password2').value;
  const errEl = document.getElementById('setup-error');

  if (pw1 !== pw2) {
    errEl.textContent = 'Passwoerter stimmen nicht ueberein';
    errEl.style.display = '';
    return;
  }

  errEl.style.display = 'none';

  try {
    const data = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw1 }),
    }).then(r => r.json());

    if (data.error) throw new Error(data.error);

    authToken = data.token;
    localStorage.setItem('authToken', authToken);
    showPage('main');
    navigate('plan');
    await route();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
});

// --- Hash change ---
window.addEventListener('hashchange', () => {
  if (authToken) route();
});

// --- Start ---
init();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Data loading ---
const recipes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'recipes.json'), 'utf-8'));
const tips = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tips.json'), 'utf-8'));
const learnData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'learn.json'), 'utf-8'));

const USERDATA_PATH = path.join(__dirname, 'data', 'userdata.json');

function loadUserData() {
  if (fs.existsSync(USERDATA_PATH)) {
    return JSON.parse(fs.readFileSync(USERDATA_PATH, 'utf-8'));
  }
  return {
    passwordHash: null,
    sessions: {},
    currentPlan: null,
    history: {},
    favorites: [],
    excluded: [],
    shoppingChecked: [],
  };
}

function saveUserData(data) {
  fs.writeFileSync(USERDATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Auth middleware ---
function auth(req, res, next) {
  const token = req.headers['x-auth-token'];
  const userData = loadUserData();
  if (!token || !userData.sessions[token]) {
    return res.status(401).json({ error: 'Nicht eingeloggt' });
  }
  req.userData = userData;
  req.saveUserData = () => saveUserData(userData);
  next();
}

// --- Auth endpoints ---
app.get('/api/status', (req, res) => {
  const userData = loadUserData();
  const token = req.headers['x-auth-token'];
  const loggedIn = token && userData.sessions[token];
  res.json({
    hasPassword: !!userData.passwordHash,
    loggedIn: !!loggedIn,
  });
});

app.post('/api/setup', async (req, res) => {
  const userData = loadUserData();
  if (userData.passwordHash) {
    return res.status(400).json({ error: 'Passwort bereits gesetzt' });
  }
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Passwort muss mindestens 4 Zeichen lang sein' });
  }
  userData.passwordHash = await bcrypt.hash(password, 10);
  const token = crypto.randomBytes(32).toString('hex');
  userData.sessions[token] = { created: new Date().toISOString() };
  saveUserData(userData);
  res.json({ token });
});

app.post('/api/login', async (req, res) => {
  const userData = loadUserData();
  if (!userData.passwordHash) {
    return res.status(400).json({ error: 'Kein Passwort gesetzt' });
  }
  const { password } = req.body;
  const valid = await bcrypt.compare(password, userData.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Falsches Passwort' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  userData.sessions[token] = { created: new Date().toISOString() };
  saveUserData(userData);
  res.json({ token });
});

app.post('/api/logout', auth, (req, res) => {
  const token = req.headers['x-auth-token'];
  delete req.userData.sessions[token];
  req.saveUserData();
  res.json({ ok: true });
});

// --- Week calculation ---
function getWeekStart(date) {
  const d = date ? new Date(date) : new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// --- Ingredient helpers ---
// Plural → singular for common German ingredient words
const PLURAL_MAP = {
  'tomaten': 'tomate', 'karotten': 'karotte', 'kartoffeln': 'kartoffel',
  'suesskartoffeln': 'suesskartoffel', 'zwiebeln': 'zwiebel',
  'auberginen': 'aubergine', 'bohnen': 'bohne', 'linsen': 'linse',
  'erbsen': 'erbse', 'gurken': 'gurke', 'bananen': 'banane',
  'paprikaschoten': 'paprika', 'champignons': 'champignon',
  'fruehlingszwiebeln': 'fruehlingszwiebel', 'radieschen': 'radieschen',
  'scheiben': 'scheibe', 'stangen': 'stange', 'zehen': 'zehe',
  'aepfel': 'apfel', 'nuesse': 'nuss', 'walnuesse': 'walnuss',
  'mandeln': 'mandel', 'cashews': 'cashew', 'erdnuesse': 'erdnuss',
  'haselnuesse': 'haselnuss', 'kirschen': 'kirsche', 'beeren': 'beere',
  'blaubeeren': 'blaubeere', 'himbeeren': 'himbeere', 'erdbeeren': 'erdbeere',
  'pflaumen': 'pflaume', 'datteln': 'dattel', 'aprikosen': 'aprikose',
  'oliven': 'olive', 'kapern': 'kaper', 'pilze': 'pilz',
  'zucchini': 'zucchini', 'brokkoli': 'brokkoli',
};

function normalizeIngredientName(name) {
  let n = name.toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')           // Remove (parenthetical) info
    .replace(/,\s+.*$/, '')                  // Remove after comma
    .replace(/^\d+\/\d+\s+/, '')             // Strip leading fractions "1/2 "
    .replace(/\b(mittelgrosse?r?s?|kleine?r?s?|grosse?r?s?|grosser)\b/g, '')
    .replace(/\b(frische?r?s?|getrocknete?r?s?|geschaelte?r?s?)\b/g, '')
    .replace(/\b(fein|grob|duenn|dick)\b/g, '')
    .replace(/\bzum garnieren\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Apply plural mapping per word
  const words = n.split(' ');
  const mapped = words.map(w => PLURAL_MAP[w] || w);
  n = mapped.join(' ');

  return n;
}

// --- Ingredient overlap optimization ---
// Pre-compute normalized ingredient sets for each recipe
const recipeIngredientSets = {};
for (const recipe of recipes) {
  recipeIngredientSets[recipe.id] = new Set(
    recipe.ingredients.map(ing => normalizeIngredientName(ing.name))
  );
}

function getSelectedIngredientPool(selectedIds) {
  const pool = new Set();
  for (const id of selectedIds) {
    const ings = recipeIngredientSets[id];
    if (ings) for (const ing of ings) pool.add(ing);
  }
  return pool;
}

function countSharedIngredients(recipeId, selectedIngredientPool) {
  const candidateIngs = recipeIngredientSets[recipeId];
  if (!candidateIngs || selectedIngredientPool.size === 0) return 0;
  let shared = 0;
  for (const ing of candidateIngs) {
    if (selectedIngredientPool.has(ing)) shared++;
  }
  return shared;
}

function weightedRandomPick(items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return null;
  let rand = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return i;
  }
  return items.length - 1;
}

// --- Weighted random selection ---
function getWeight(recipeId, history, favorites, excluded) {
  if (excluded.includes(recipeId)) return 0;

  let weight = 1.0;
  const entry = history[recipeId];
  if (entry && entry.lastUsed) {
    const daysSince = (Date.now() - new Date(entry.lastUsed).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) weight *= 0.02;
    else if (daysSince < 14) weight *= 0.08;
    else if (daysSince < 21) weight *= 0.2;
    else if (daysSince < 28) weight *= 0.4;
    else if (daysSince < 56) weight *= 0.7;
  } else {
    weight *= 1.3;
  }

  if (favorites.includes(recipeId)) weight *= 1.5;
  return weight;
}

function weightedRandomSelect(pool, count, history, favorites, excluded) {
  const items = pool.filter(r => !excluded.includes(r.id));
  if (items.length === 0) return [];

  const weights = items.map(r => getWeight(r.id, history, favorites, excluded));
  const selected = [];
  const used = new Set();

  for (let i = 0; i < count && used.size < items.length; i++) {
    let totalWeight = 0;
    for (let j = 0; j < items.length; j++) {
      if (!used.has(j)) totalWeight += weights[j];
    }
    if (totalWeight <= 0) break;

    let rand = Math.random() * totalWeight;
    for (let j = 0; j < items.length; j++) {
      if (used.has(j)) continue;
      rand -= weights[j];
      if (rand <= 0) {
        selected.push(items[j].id);
        used.add(j);
        break;
      }
    }
  }
  return selected;
}

function generateWeekPlan(userData) {
  const breakfastPool = recipes.filter(r => r.type === 'breakfast' && !userData.excluded.includes(r.id));
  const dinnerPool = recipes.filter(r => r.type === 'dinner' && !userData.excluded.includes(r.id));
  const { history, favorites, excluded } = userData;

  const weekStart = getWeekStart();

  // Sequential selection with ingredient overlap bonus.
  // After each pick, recipes sharing ingredients with already-selected
  // ones get a weight boost, resulting in shorter shopping lists.
  const OVERLAP_BONUS = 0.18; // 18% boost per shared ingredient

  const breakfastIds = [];
  const dinnerIds = [];
  const allSelectedIds = [];
  const usedBreakfast = new Set();
  const usedDinner = new Set();

  for (let day = 0; day < 7; day++) {
    const ingredientPool = getSelectedIngredientPool(allSelectedIds);

    // Pick breakfast
    const bfWeights = breakfastPool.map((r, i) => {
      if (usedBreakfast.has(i)) return 0;
      let w = getWeight(r.id, history, favorites, excluded);
      const overlap = countSharedIngredients(r.id, ingredientPool);
      w *= (1 + overlap * OVERLAP_BONUS);
      return w;
    });
    const bfIdx = weightedRandomPick(breakfastPool, bfWeights);
    if (bfIdx !== null) {
      breakfastIds.push(breakfastPool[bfIdx].id);
      allSelectedIds.push(breakfastPool[bfIdx].id);
      usedBreakfast.add(bfIdx);
    }

    // Recalculate ingredient pool with the new breakfast
    const ingredientPool2 = getSelectedIngredientPool(allSelectedIds);

    // Pick dinner
    const dWeights = dinnerPool.map((r, i) => {
      if (usedDinner.has(i)) return 0;
      let w = getWeight(r.id, history, favorites, excluded);
      const overlap = countSharedIngredients(r.id, ingredientPool2);
      w *= (1 + overlap * OVERLAP_BONUS);
      return w;
    });
    const dIdx = weightedRandomPick(dinnerPool, dWeights);
    if (dIdx !== null) {
      dinnerIds.push(dinnerPool[dIdx].id);
      allSelectedIds.push(dinnerPool[dIdx].id);
      usedDinner.add(dIdx);
    }
  }

  const now = new Date().toISOString();
  for (const id of [...breakfastIds, ...dinnerIds]) {
    if (!userData.history[id]) userData.history[id] = { useCount: 0 };
    userData.history[id].lastUsed = now;
    userData.history[id].useCount = (userData.history[id].useCount || 0) + 1;
  }

  userData.currentPlan = {
    weekStart,
    days: DAY_NAMES.map((name, i) => ({
      name,
      breakfast: breakfastIds[i] || null,
      dinner: dinnerIds[i] || null,
    })),
  };
  userData.shoppingChecked = [];
  return userData.currentPlan;
}

function enrichRecipe(recipe, userData) {
  if (!recipe) return null;
  return {
    ...recipe,
    isFavorite: userData.favorites.includes(recipe.id),
    isExcluded: userData.excluded.includes(recipe.id),
  };
}

function enrichPlan(plan, userData) {
  return {
    ...plan,
    days: plan.days.map(day => ({
      ...day,
      breakfastRecipe: enrichRecipe(recipes.find(r => r.id === day.breakfast), userData),
      dinnerRecipe: enrichRecipe(recipes.find(r => r.id === day.dinner), userData),
    })),
  };
}

// --- API endpoints ---
app.get('/api/weekplan', auth, (req, res) => {
  const { userData } = req;
  const currentWeekStart = getWeekStart();

  if (!userData.currentPlan || userData.currentPlan.weekStart !== currentWeekStart) {
    generateWeekPlan(userData);
    req.saveUserData();
  }

  res.json(enrichPlan(userData.currentPlan, userData));
});

app.post('/api/weekplan/generate', auth, (req, res) => {
  const { userData } = req;
  generateWeekPlan(userData);
  req.saveUserData();

  res.json(enrichPlan(userData.currentPlan, userData));
});

app.post('/api/weekplan/swap', auth, (req, res) => {
  const { dayIndex, mealType } = req.body;
  const { userData } = req;

  if (!userData.currentPlan) {
    return res.status(400).json({ error: 'Kein Wochenplan vorhanden' });
  }
  if (dayIndex < 0 || dayIndex > 6 || !['breakfast', 'dinner'].includes(mealType)) {
    return res.status(400).json({ error: 'Ungueltige Parameter' });
  }

  const pool = recipes.filter(r => r.type === mealType);
  const currentIds = userData.currentPlan.days.map(d => d[mealType]);
  const available = pool.filter(r => !currentIds.includes(r.id) && !userData.excluded.includes(r.id));

  if (available.length === 0) {
    return res.status(400).json({ error: 'Keine alternativen Rezepte verfuegbar' });
  }

  const [newId] = weightedRandomSelect(available, 1, userData.history, userData.favorites, userData.excluded);
  const oldId = userData.currentPlan.days[dayIndex][mealType];

  userData.currentPlan.days[dayIndex][mealType] = newId;

  const now = new Date().toISOString();
  if (!userData.history[newId]) userData.history[newId] = { useCount: 0 };
  userData.history[newId].lastUsed = now;
  userData.history[newId].useCount = (userData.history[newId].useCount || 0) + 1;

  req.saveUserData();

  const day = userData.currentPlan.days[dayIndex];
  res.json({
    day: {
      ...day,
      breakfastRecipe: enrichRecipe(recipes.find(r => r.id === day.breakfast), userData),
      dinnerRecipe: enrichRecipe(recipes.find(r => r.id === day.dinner), userData),
    },
  });
});

app.get('/api/recipes', auth, (req, res) => {
  const { userData } = req;
  const { type, search } = req.query;

  let filtered = recipes;
  if (type && type !== 'all') {
    filtered = filtered.filter(r => r.type === type);
  }
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(r =>
      r.name.toLowerCase().includes(s) ||
      r.category.toLowerCase().includes(s) ||
      r.cuisine.toLowerCase().includes(s)
    );
  }

  const result = filtered.map(r => ({
    id: r.id,
    type: r.type,
    name: r.name,
    category: r.category,
    cuisine: r.cuisine,
    prepTime: r.prepTime,
    isFavorite: userData.favorites.includes(r.id),
    isExcluded: userData.excluded.includes(r.id),
  }));

  res.json(result);
});

app.get('/api/recipes/:id', auth, (req, res) => {
  const recipe = recipes.find(r => r.id === req.params.id);
  if (!recipe) return res.status(404).json({ error: 'Rezept nicht gefunden' });
  const { userData } = req;
  res.json({
    ...recipe,
    isFavorite: userData.favorites.includes(recipe.id),
    isExcluded: userData.excluded.includes(recipe.id),
  });
});

app.post('/api/recipes/:id/favorite', auth, (req, res) => {
  const { userData } = req;
  const id = req.params.id;
  if (!recipes.find(r => r.id === id)) return res.status(404).json({ error: 'Rezept nicht gefunden' });

  const idx = userData.favorites.indexOf(id);
  if (idx >= 0) {
    userData.favorites.splice(idx, 1);
  } else {
    userData.favorites.push(id);
  }
  req.saveUserData();
  res.json({ isFavorite: userData.favorites.includes(id) });
});

app.post('/api/recipes/:id/exclude', auth, (req, res) => {
  const { userData } = req;
  const id = req.params.id;
  if (!recipes.find(r => r.id === id)) return res.status(404).json({ error: 'Rezept nicht gefunden' });

  const idx = userData.excluded.indexOf(id);
  if (idx >= 0) {
    userData.excluded.splice(idx, 1);
  } else {
    userData.excluded.push(id);
    const favIdx = userData.favorites.indexOf(id);
    if (favIdx >= 0) userData.favorites.splice(favIdx, 1);
  }
  req.saveUserData();
  res.json({ isExcluded: userData.excluded.includes(id) });
});

// --- Shopping list ---
const INGREDIENT_CATEGORIES = {
  'obst & gemuese': [
    'zwiebel', 'knoblauch', 'ingwer', 'karotte', 'kartoffel', 'suesskartoffel',
    'brokkoli', 'paprika', 'tomate', 'spinat', 'gruenkohl', 'blumenkohl',
    'zucchini', 'aubergine', 'kuerbis', 'avocado', 'banane', 'apfel', 'zitrone',
    'limette', 'orange', 'mango', 'beeren', 'blaubeeren', 'himbeeren', 'erdbeeren',
    'sellerie', 'lauch', 'fruehlingszwiebel', 'champignon', 'pilz', 'portobello',
    'rosenkohl', 'wirsing', 'rotkohl', 'kohl', 'mangold', 'rucola', 'salat',
    'gurke', 'radieschen', 'fenchel', 'erbsen', 'bohnen', 'mais', 'spargel',
    'rote bete', 'petersilie', 'koriander', 'basilikum', 'minze', 'dill',
    'schnittlauch', 'rosmarin', 'thymian', 'kirschen', 'granatapfel', 'birne',
  ],
  'kuehlregal': [
    'tofu', 'tempeh', 'hafermilch', 'mandelmilch', 'kokosmilch', 'sojamilch',
    'kokosjoghurt', 'joghurt', 'kefir', 'miso', 'kimchi', 'sauerkraut',
    'haehnchen', 'haehnchenbrustfilet', 'haehnchenfilet', 'ei', 'eier',
    'butter', 'parmesan', 'hummus',
  ],
  'vorratskammer': [
    'haferflocken', 'quinoa', 'reis', 'linsen', 'kichererbsen', 'bohnen',
    'nudeln', 'pasta', 'vollkornnudeln', 'buchweizenmehl', 'kichererbsenmehl',
    'mandelmehl', 'hafermehl', 'mehl', 'backpulver', 'tomatenmark',
    'kokosmilch', 'dose', 'gemusebruehe', 'sojasauce', 'tamari', 'essig',
    'ahornsirup', 'honig', 'kokosoel', 'olivenoel', 'avocadooel', 'sesamoel',
    'tahini', 'erdnussbutter', 'mandelmus', 'kokosraspeln', 'kakao',
    'vanilleextrakt', 'hefe', 'polenta', 'graupen', 'hirse', 'amaranth',
    'buchweizen', 'dinkelmehl',
  ],
  'nuesse & samen': [
    'walnuesse', 'mandeln', 'cashew', 'paranueesse', 'haselnuesse', 'erdnuesse',
    'kuerbiskerne', 'sonnenblumenkerne', 'chiasamen', 'leinsamen', 'hanfsamen',
    'sesam', 'pinienkerne',
  ],
  'gewuerze': [
    'kurkuma', 'zimt', 'ingwerpulver', 'pfeffer', 'salz', 'kreuzkuemmel',
    'paprikapulver', 'currypulver', 'chili', 'oregano', 'muskatnuss',
    'koriander gemahlen', 'nelken', 'kardamom', 'fenchelsamen', 'garam masala',
    'harissa', 'berbere', 'za\'atar', 'rauchpaprika',
  ],
  'tiefkuehl': [
    'tiefkuehl', 'tk ', 'gefroren',
  ],
};

function categorizeIngredient(name) {
  const lower = normalizeIngredientName(name);
  for (const [category, keywords] of Object.entries(INGREDIENT_CATEGORIES)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return category;
    }
  }
  return 'sonstiges';
}

app.get('/api/shopping-list', auth, (req, res) => {
  const { userData } = req;
  if (!userData.currentPlan) {
    return res.json({ items: [], categories: {} });
  }

  const planRecipeIds = [];
  for (const day of userData.currentPlan.days) {
    if (day.breakfast) planRecipeIds.push(day.breakfast);
    if (day.dinner) planRecipeIds.push(day.dinner);
  }

  const ingredientMap = {};

  for (const id of planRecipeIds) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) continue;

    for (const ing of recipe.ingredients) {
      const key = normalizeIngredientName(ing.name);
      if (!ingredientMap[key]) {
        ingredientMap[key] = {
          name: ing.name,
          amounts: [],
          category: categorizeIngredient(ing.name),
        };
      }
      if (ing.amount > 0) {
        const existing = ingredientMap[key].amounts.find(a => a.unit === ing.unit);
        if (existing) {
          existing.amount += ing.amount;
        } else {
          ingredientMap[key].amounts.push({ amount: ing.amount, unit: ing.unit });
        }
      }
    }
  }

  const items = Object.entries(ingredientMap).map(([key, data]) => {
    let displayAmount = '';
    if (data.amounts.length > 0) {
      displayAmount = data.amounts
        .map(a => `${Math.round(a.amount * 10) / 10} ${a.unit}`)
        .join(' + ');
    }
    return {
      key,
      name: data.name,
      displayAmount,
      category: data.category,
      checked: userData.shoppingChecked.includes(key),
    };
  });

  items.sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const categories = {};
  for (const item of items) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  }

  res.json({ categories });
});

app.post('/api/shopping-list/check', auth, (req, res) => {
  const { key, checked } = req.body;
  const { userData } = req;

  if (checked) {
    if (!userData.shoppingChecked.includes(key)) {
      userData.shoppingChecked.push(key);
    }
  } else {
    userData.shoppingChecked = userData.shoppingChecked.filter(k => k !== key);
  }
  req.saveUserData();
  res.json({ ok: true });
});

// --- Tip of the day ---
app.get('/api/tip', auth, (req, res) => {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
  const tip = tips[dayOfYear % tips.length];
  res.json({ tip });
});

// --- Learn ---
app.get('/api/learn', auth, (req, res) => {
  res.json(learnData);
});

// --- Stats ---
app.get('/api/stats', auth, (req, res) => {
  const { userData } = req;
  const totalRecipes = recipes.length;
  const breakfastCount = recipes.filter(r => r.type === 'breakfast').length;
  const dinnerCount = recipes.filter(r => r.type === 'dinner').length;
  res.json({
    totalRecipes,
    breakfastCount,
    dinnerCount,
    favorites: userData.favorites.length,
    excluded: userData.excluded.length,
  });
});

// --- Fallback to index.html ---
app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server laeuft auf http://localhost:${PORT}`);
  console.log(`${recipes.length} Rezepte geladen (${recipes.filter(r => r.type === 'breakfast').length} Fruehstueck, ${recipes.filter(r => r.type === 'dinner').length} Abendessen)`);
});

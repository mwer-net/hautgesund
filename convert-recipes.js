const fs = require('fs');
const path = require('path');

const FILES = [
  { path: 'fruehstuecksrezepte-antientzuendlich.md', type: 'breakfast', prefix: 'b' },
  { path: 'fruehstuecksrezepte-teil2-weitere.md', type: 'breakfast', prefix: 'b2' },
  { path: 'abendessen-teil1-suppen-eintoepfe-currys-bowls.md', type: 'dinner', prefix: 'd1' },
  { path: 'rezepte_teil2_abendessen.md', type: 'dinner', prefix: 'd2' },
  { path: 'abendessen-teil3-internationale-kueche.md', type: 'dinner', prefix: 'd3' },
  { path: 'abendessen-teil3-kreative-internationale-rezepte.md', type: 'dinner', prefix: 'd4' },
];

const UNITS = [
  'kg', 'g', 'ml', 'l', 'EL', 'TL', 'Stueck', 'Stk', 'Prise', 'Prisen',
  'Dose', 'Dosen', 'Tasse', 'Tassen', 'Bund', 'Scheibe', 'Scheiben',
  'Handvoll', 'cm', 'Zehe', 'Zehen', 'Stange', 'Stangen', 'Packung',
];

const UNIT_REGEX = UNITS.join('|');

function parseIngredient(line) {
  let text = line.replace(/^[-*]\s+/, '').trim();
  if (!text || text.startsWith('**') || text.startsWith('#')) return null;

  // Try: "180 g Haferflocken (kernig)"
  let m = text.match(new RegExp(`^(\\d+(?:[,.]\\d+)?)\\s*(${UNIT_REGEX})\\s+(.+)$`, 'i'));
  if (m) {
    let amount = parseFloat(m[1].replace(',', '.'));
    let unit = m[2];
    let rest = m[3];
    let name = rest.replace(/\s*\([^)]*\)\s*$/, '').replace(/,\s+.*$/, '').trim();
    return { text, amount, unit, name };
  }

  // Try: "1/2 TL Kurkuma"
  m = text.match(new RegExp(`^(\\d+)\\/(\\d+)\\s*(${UNIT_REGEX})\\s+(.+)$`, 'i'));
  if (m) {
    let amount = parseInt(m[1]) / parseInt(m[2]);
    let unit = m[3];
    let rest = m[4];
    let name = rest.replace(/\s*\([^)]*\)\s*$/, '').replace(/,\s+.*$/, '').trim();
    return { text, amount: Math.round(amount * 100) / 100, unit, name };
  }

  // Try: "3 mittelgrosse Tomaten" (number without unit)
  m = text.match(/^(\d+(?:[,.]\d+)?)\s+(.+)$/);
  if (m) {
    let amount = parseFloat(m[1].replace(',', '.'));
    let name = m[2].replace(/\s*\([^)]*\)\s*$/, '').replace(/,\s+.*$/, '').trim();
    return { text, amount, unit: 'Stueck', name };
  }

  // No amount - ingredient text only (e.g. "Frische Minzblaetter zum Garnieren")
  let name = text.replace(/\s*\([^)]*\)\s*$/, '').replace(/,\s+.*$/, '').trim();
  return { text, amount: 0, unit: '', name };
}

function extractPrepTime(text) {
  // Try "Gesamt: Z Minuten" or "Gesamt: Z Min."
  let m = text.match(/Gesamt:\s*(?:\*\*)?(\d+)/i);
  if (m) return parseInt(m[1]);

  // Try "= Z Min."
  m = text.match(/=\s*(\d+)\s*Min/i);
  if (m) return parseInt(m[1]);

  // Try just a number followed by Min
  m = text.match(/(\d+)\s*Min/i);
  if (m) return parseInt(m[1]);

  return 0;
}

function extractCategory(text) {
  // Try "## KATEGORIE: ..." or section headers
  let m = text.match(/##\s*(?:KATEGORIE\s*\d*:?\s*)?([A-ZÄÖÜ][A-ZÄÖÜ &()\-]+)/);
  if (m) return m[1].trim();
  return '';
}

function extractCuisine(block) {
  let m = block.match(/\*\*Kueche(?:\/Region)?:\*\*\s*(.+?)(?:\||$)/m);
  if (m) return m[1].trim();
  m = block.match(/\*\*Kueche:\*\*\s*(.+?)(?:\s*\|)/m);
  if (m) return m[1].trim();
  return '';
}

function splitRecipeBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  let currentBlock = [];
  let currentCategory = '';

  for (const line of lines) {
    // Check for category headers
    const catMatch = line.match(/^##\s+(?:KATEGORIE\s*\d*:?\s*)?([A-ZÄÖÜ].+)/);
    if (catMatch && !line.match(/^###/) && !line.match(/Rezept\s+\d+/i)) {
      const cat = catMatch[1].replace(/\*\*/g, '').trim();
      if (!cat.match(/^(INHALTSVERZEICHNIS|Zubereitung|Zutaten|Warum|SUPPEN|EINTOEPFE|CURRYS|BOWLS|PFANNENGERICHTE|OFENGERICHTE|SALATE|NUDELGERICHTE|WEITERE)/i)) {
        // skip
      }
      currentCategory = cat;
    }

    // Recipe boundary detection
    const isRecipeStart =
      line.match(/^###\s+\d+\.\s+/) ||
      line.match(/^##\s+Rezept\s+\d+:/i);

    if (isRecipeStart) {
      if (currentBlock.length > 0) {
        blocks.push({ lines: currentBlock, category: currentCategory });
      }
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock.length > 0) {
    blocks.push({ lines: currentBlock, category: currentCategory });
  }

  return blocks;
}

function parseRecipeBlock(block, type, prefix, index) {
  const text = block.lines.join('\n');
  const lines = block.lines;

  // Extract name
  let name = '';
  let m = lines[0].match(/^###\s+\d+\.\s+(.+)/);
  if (m) {
    name = m[1].replace(/\*\*/g, '').trim();
  } else {
    m = lines[0].match(/^##\s+Rezept\s+\d+:\s+(.+)/i);
    if (m) name = m[1].replace(/\*\*/g, '').trim();
  }
  if (!name) return null;

  // Remove parenthetical recipe description from name
  name = name.replace(/\s*\(vegan.*?\)/gi, '').replace(/\s*\(glutenfrei.*?\)/gi, '').trim();

  // Extract sections
  const ingredients = [];
  const instructions = [];
  let skinBenefits = '';
  let prepTime = 0;
  let cuisine = extractCuisine(text);

  // State machine to parse sections
  let section = 'none';
  let instructionBuffer = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Detect section changes — only match at line start to avoid false positives
    const trimmedLine = line.trim();
    const trimmedLower = trimmedLine.toLowerCase();

    if ((trimmedLower.startsWith('**zutaten') || trimmedLower.startsWith('### zutaten')) && !trimmedLower.startsWith('**zubereitungszeit')) {
      section = 'ingredients';
      continue;
    }
    if ((trimmedLower.startsWith('**zubereitung') || trimmedLower.startsWith('### zubereitung') || trimmedLower.startsWith('**schnelle variante'))
        && !trimmedLower.startsWith('**zubereitungszeit') && !trimmedLower.startsWith('### zubereitungszeit')) {
      section = 'instructions';
      continue;
    }
    if (trimmedLower.startsWith('**gut fuer die haut') || trimmedLower.startsWith('### warum gut') || trimmedLower.startsWith('**warum gut') || trimmedLower.startsWith('### gut fuer')) {
      section = 'benefits';
      const benefitMatch = line.match(/(?:gut fuer die haut|warum gut).*?:\*?\*?\s*(.*)/i);
      if (benefitMatch && benefitMatch[1].trim()) {
        skinBenefits = benefitMatch[1].trim();
      }
      continue;
    }
    if (trimmedLower.startsWith('**zubereitungszeit') || trimmedLower.startsWith('### zubereitungszeit')) {
      const time = extractPrepTime(line);
      if (time > 0) prepTime = time;
      section = 'time';
      continue;
    }

    // Also check for "Gesamt:" in any context for prep time
    if (lower.includes('gesamt:')) {
      const time = extractPrepTime(line);
      if (time > 0) prepTime = time;
    }

    // Parse content based on current section
    if (section === 'ingredients') {
      if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
        const ing = parseIngredient(line.trim());
        if (ing) ingredients.push(ing);
      }
      // Skip sub-headers like "**Fuer den Wok:**"
    }

    if (section === 'instructions') {
      const trimmed = line.trim();
      if (!trimmed) {
        if (instructionBuffer.length > 0) {
          instructions.push(instructionBuffer.join(' ').trim());
          instructionBuffer = [];
        }
        continue;
      }

      // Numbered step: "1. Text" or "**Schritt 1:**"
      const stepMatch = trimmed.match(/^(?:\d+\.\s+|\*\*Schritt\s+\d+[^:]*:\*\*\s*)(.*)/);
      if (stepMatch) {
        if (instructionBuffer.length > 0) {
          instructions.push(instructionBuffer.join(' ').trim());
          instructionBuffer = [];
        }
        if (stepMatch[1].trim()) {
          instructionBuffer.push(stepMatch[1].trim());
        }
      } else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
        // Sub-header in instructions, skip
      } else if (!trimmed.startsWith('#') && !trimmed.startsWith('---')) {
        instructionBuffer.push(trimmed);
      }
    }

    if (section === 'benefits') {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && !trimmed.startsWith('**Zubereitungszeit')) {
        if (trimmed.startsWith('- ')) {
          skinBenefits += (skinBenefits ? ' ' : '') + trimmed.substring(2);
        } else {
          skinBenefits += (skinBenefits ? ' ' : '') + trimmed;
        }
      }
    }
  }

  // Flush remaining instruction buffer
  if (instructionBuffer.length > 0) {
    instructions.push(instructionBuffer.join(' ').trim());
  }

  // If no prepTime found, try to extract from full text
  if (prepTime === 0) {
    prepTime = extractPrepTime(text);
  }

  // Default prep times
  if (prepTime === 0) {
    prepTime = type === 'breakfast' ? 5 : 30;
  }

  // Clean up skin benefits
  skinBenefits = skinBenefits.replace(/\*\*/g, '').trim();

  // Fallback: if no instructions found, try multiple strategies
  if (instructions.length === 0) {
    // Strategy 1: paragraph after **Zubereitung...**
    const instrMatch = text.match(/\*\*(?:Zubereitung|Schnelle Variante)[^*]*\*\*\s*\n([\s\S]+?)(?=\n\*\*|\n###|\n---)/);
    if (instrMatch) {
      const lines = instrMatch[1].trim().split('\n').filter(l => l.trim());
      for (const l of lines) {
        const cleaned = l.trim().replace(/^\d+\.\s*/, '');
        if (cleaned) instructions.push(cleaned);
      }
    }
  }
  if (instructions.length === 0) {
    // Strategy 2: look for numbered steps anywhere in the block
    const numberedSteps = text.match(/^\d+\.\s+.+/gm);
    if (numberedSteps && numberedSteps.length >= 2) {
      for (const step of numberedSteps) {
        instructions.push(step.replace(/^\d+\.\s+/, '').trim());
      }
    }
  }

  const id = `${prefix}-${String(index).padStart(2, '0')}`;

  // Strip markdown formatting from all text fields
  function stripMd(s) {
    return s.replace(/\*\*/g, '').replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1').trim();
  }

  // Remove ingredient entries that are sub-headers (e.g. "*Tofu:*", "*Gemuese:*")
  const cleanIngredients = ingredients.filter(ing => {
    const t = ing.text.trim();
    return !(t.startsWith('*') && t.endsWith('*') && t.endsWith(':*'));
  }).map(ing => ({
    ...ing,
    text: stripMd(ing.text),
    name: stripMd(ing.name),
  }));

  return {
    id,
    type,
    name: stripMd(name),
    category: block.category || '',
    cuisine,
    prepTime,
    ingredients: cleanIngredients,
    instructions: instructions.filter(s => s.length > 0).map(stripMd),
    skinBenefits: stripMd(skinBenefits),
  };
}

function processFile(fileConfig) {
  const filePath = path.join(__dirname, fileConfig.path);
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const blocks = splitRecipeBlocks(content);
  const recipes = [];

  let recipeIndex = 1;
  for (const block of blocks) {
    // Skip blocks that don't start with a recipe heading
    if (!block.lines[0].match(/^#{2,3}\s+(?:\d+\.|Rezept\s+\d+)/i)) continue;

    const recipe = parseRecipeBlock(block, fileConfig.type, fileConfig.prefix, recipeIndex);
    if (recipe && recipe.ingredients.length > 0) {
      recipes.push(recipe);
      recipeIndex++;
    }
  }

  return recipes;
}

// Main
const allRecipes = [];
const seenNames = new Set();

for (const file of FILES) {
  console.log(`Processing: ${file.path}`);
  const recipes = processFile(file);
  console.log(`  Found ${recipes.length} recipes`);

  for (const recipe of recipes) {
    // Deduplicate by name similarity
    const normalizedName = recipe.name.toLowerCase().replace(/[^a-zäöüß]/g, '');
    if (seenNames.has(normalizedName)) {
      console.log(`  Skipping duplicate: ${recipe.name}`);
      continue;
    }
    seenNames.add(normalizedName);
    allRecipes.push(recipe);
  }
}

// Summary
const breakfastCount = allRecipes.filter(r => r.type === 'breakfast').length;
const dinnerCount = allRecipes.filter(r => r.type === 'dinner').length;
console.log(`\nTotal: ${allRecipes.length} recipes (${breakfastCount} breakfast, ${dinnerCount} dinner)`);

// Check for recipes with missing data
let issues = 0;
for (const r of allRecipes) {
  const problems = [];
  if (r.ingredients.length === 0) problems.push('no ingredients');
  if (r.instructions.length === 0) problems.push('no instructions');
  if (!r.skinBenefits) problems.push('no skin benefits');
  if (problems.length > 0) {
    console.warn(`  [${r.id}] ${r.name}: ${problems.join(', ')}`);
    issues++;
  }
}
if (issues > 0) console.warn(`\n${issues} recipes with issues`);

// Write output
const outputPath = path.join(__dirname, 'data', 'recipes.json');
fs.writeFileSync(outputPath, JSON.stringify(allRecipes, null, 2), 'utf-8');
console.log(`\nWritten to ${outputPath}`);

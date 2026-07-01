#!/usr/bin/env node
/**
 * convert-journals.js
 *
 * Copies pre-converted journal JSONs from sveilheim-5e (already ported from
 * Draw Steel to Foundry JournalEntry format) and rewrites all mechanical
 * references from D&D 5e terminology to Symbaroum terminology.
 *
 * Handles:
 * - Act 1/2/3 campaign beat journals
 * - World lore journals (gazetteer, pantheon, calendar, languages)
 * - Downtime reference
 * - Skill challenges (→ Challenge Scenes)
 * - Social encounters
 *
 * Usage: node tools/convert-journals.js
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  foundryId,
  replaceTerms, fixMojibake, stripTableStyles, mkSymStats,
} = require('./shared');

// ── Paths ──────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_JOURNALS = path.resolve(REPO_ROOT, '..', 'sveilheim-5e', 'data', 'journals');
const OUT_JOURNALS = path.join(REPO_ROOT, 'data', 'journals');

// ── Subdirectory mapping: source → output ─────────────────────────────
const JOURNAL_DIRS = [
  { src: 'act1',     out: 'act1' },
  { src: 'act2',     out: 'act2' },
  { src: 'act3',     out: 'act3' },
  { src: 'world-lore', out: 'world-lore' },
  { src: 'downtime', out: 'downtime' },
  { src: 'mechanics', out: 'mechanics' },
];

// ── Additional term replacements for journal content ──────────────────
// These are applied AFTER the main term replacements in shared.js

const JOURNAL_SPECIFIC_FIXES = [
  // Fix DC references: "DC 13 Strength (Athletics) check" → "Strong test (modified 13)"
  [/DC\s+(\d+)\s+(\w+)(?:\s*\((\w+)\))?\s*(check|save)?/gi, (m, dc, ability, skill, type) => {
    const symAbilities = {
      strength: 'Strong', str: 'Strong',
      dexterity: 'Quick', dex: 'Quick',
      constitution: 'Strong', con: 'Strong',
      intelligence: 'Cunning', int: 'Cunning',
      wisdom: 'Vigilant', wis: 'Vigilant',
      charisma: 'Persuasive', cha: 'Persuasive',
    };
    const symAttr = symAbilities[ability.toLowerCase()] || ability;
    if (type && type.toLowerCase() === 'save') {
      return `Resolute test (DC ${dc})`;
    }
    return `${symAttr} test (modified ${dc})`;
  }],

  // Fix skill references: "Strength (Athletics)" → "Strong"
  [/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s*\((\w+)\)\b/gi, (m, ability) => {
    const map = {
      strength: 'Strong', dexterity: 'Quick', constitution: 'Strong',
      intelligence: 'Cunning', wisdom: 'Vigilant', charisma: 'Persuasive',
    };
    return map[ability.toLowerCase()] || ability;
  }],

  // Fix "feet" distance → "meters" for Symbaroum
  [/(\d+)[-\s]*foot\b/gi, (m, num) => `${Math.round(parseInt(num, 10) / 3)} meters`],
  [/(\d+)\s*ft\.?/gi, (m, num) => `${Math.round(parseInt(num, 10) / 3)} m`],

  // Fix proficiency → attribute
  [/\bproficiency bonus\b/gi, 'attribute modifier'],

  // Fix spell references
  [/\bspell\b/gi, 'mystical power'],
  [/\bSpells?\b/g, 'Mystical Powers'],

  // Fix Challenge Rating → Threat Level
  [/\bChallenge Rating\b/gi, 'Threat Level'],
  [/\bCR\s+(\d+(?:\.\d+)?)/gi, 'Threat Level $1'],

  // Fix "1d20 + X" → Symbaroum style (attribute test)
  // Symbaroum uses d20 ≤ attribute for success, not d20 + mod
  [/1d20\s*\+\s*(\w+)\s*\((\w+)\)/gi, '$2 test'],

  // Fix various D&D specific terms
  [/\bproficient\b/gi, 'trained'],
  [/\binitiative\b/gi, 'initiative'],
  [/\bInitiative\b/g, 'Initiative'],
  [/\bexperience points?\b/gi, 'experience'],
  [/\bXP\b/g, 'Exp'],

  // Fix level references: "1st level" → "Novice"
  [/\b1st[-\s]level\b/gi, 'Novice'],
  [/\b2nd[-\s]level\b/gi, 'Novice'],
  [/\b3rd[-\s]level\b/gi, 'Adept'],
  [/\b4th[-\s]level\b/gi, 'Adept'],
  [/\b5th[-\s]level\b/gi, 'Master'],
  [/\b(\d+)th[-\s]level\b/gi, 'Veteran (level $1)'],

  // Fix "per day" / "per long rest" → "per extended rest"
  [/\bper long rest\b/gi, 'per extended rest'],
  [/\bper short rest\b/gi, 'per rest'],
  [/\bper day\b/gi, 'per extended rest'],

  // Fix "hit die" references
  [/\bhit dice?\b/gi, 'recovery test'],
  [/\bHit Dice?\b/g, 'Recovery Tests'],

  // Fix "combat encounter" → "combat scene"
  [/\bcombat encounter\b/gi, 'combat scene'],
  [/\bEncounter\b/g, 'Scene'],
  [/\bencounter\b/g, 'scene'],

  // Fix "saving throw" more aggressively
  [/\b(\w+) saving throw\b/gi, '$1 test'],
  [/\bsaving throw\b/gi, 'Resolute test'],

  // Fix action names
  [/\bAction\b/g, 'Combat Action'],
  [/\baction\b/g, 'combat action'],
  [/\bMove Action\b/g, 'Movement Action'],

  // Fix magic item → artifact
  [/\bmagic item\b/gi, 'artifact'],
  [/\bMagic Item\b/g, 'Artifact'],

  // Fix resistances
  [/\bdamage resistance\b/gi, 'armor'],
  [/\bdamage immunity\b/gi, 'full armor'],
  [/\bcondition immunity\b/gi, 'immune to'],

  // Fix potion → elixir
  [/\bpotion\b/gi, 'elixir'],

  // Fix scroll references
  [/\bspell scroll\b/gi, 'mystical scroll'],
];

/**
 * Apply journal-specific term replacements on top of the base replacements.
 */
function rewriteJournalText(text) {
  if (!text) return text;
  // First apply base replacements (DS → Symbaroum)
  text = replaceTerms(text);
  // Then apply journal-specific fixes
  for (const [pat, rep] of JOURNAL_SPECIFIC_FIXES) {
    text = text.replace(pat, rep);
  }
  text = stripTableStyles(text);
  return text;
}

/**
 * Recursively walk an object and rewrite all string values.
 */
function deepRewrite(obj) {
  if (typeof obj === 'string') {
    return rewriteJournalText(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(deepRewrite);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepRewrite(value);
    }
    return result;
  }
  return obj;
}

/**
 * Convert a single journal JSON from 5e format to Symbaroum format.
 */
function convertJournal(journalJson) {
  // Deep rewrite all text content
  const converted = deepRewrite(journalJson);

  // Update stats block
  if (converted._stats) {
    converted._stats.systemId = 'symbaroum';
    converted._stats.systemVersion = null;
    converted._stats.compendiumSource = null;
    converted._stats.duplicateSource = null;
    converted._stats.exportSource = null;
  }

  // Update page stats
  if (converted.pages) {
    for (const page of converted.pages) {
      if (page._stats) {
        page._stats.systemId = 'symbaroum';
        page._stats.systemVersion = null;
      }
    }
  }

  return converted;
}

// ── Process all journal directories ────────────────────────────────────
function main() {
  console.log('=== 5e → Symbaroum Journal Conversion ===\n');

  if (!fs.existsSync(SRC_JOURNALS)) {
    console.log(`  Source journals dir not found: ${SRC_JOURNALS}`);
    console.log('  Make sure sveilheim-5e repo exists at the expected path.');
    console.log('  Looking for journals in sveilheim-5e/data/journals/');
    return;
  }

  let totalCount = 0;

  for (const { src, out } of JOURNAL_DIRS) {
    const srcDir = path.join(SRC_JOURNALS, src);
    const outDir = path.join(OUT_JOURNALS, out);

    if (!fs.existsSync(srcDir)) {
      console.log(`  ⚠ Skipping ${src}/ (source dir not found)`);
      continue;
    }

    fs.mkdirSync(outDir, { recursive: true });

    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.json')).sort();
    let dirCount = 0;

    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(srcDir, file), 'utf8'));
        const converted = convertJournal(raw);
        fs.writeFileSync(path.join(outDir, file), JSON.stringify(converted, null, 2), 'utf8');
        dirCount++;
      } catch (err) {
        console.error(`  ✗ ERROR converting ${src}/${file}: ${err.message}`);
      }
    }

    console.log(`  ${src}/ → ${dirCount} journals`);
    totalCount += dirCount;
  }

  console.log(`\n  Total journals converted: ${totalCount}`);
}

main();

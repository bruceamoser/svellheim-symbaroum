#!/usr/bin/env node
/**
 * convert-items.js
 *
 * Reads Draw Steel item/treasure JSONs from Svellheim-Entities
 * and outputs Symbaroum-compatible Item JSONs for the svellheim-symbaroum module.
 *
 * Usage: node tools/convert-items.js
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  foundryId, slugify,
  replaceTerms, stripTableStyles, fixMojibake,
  dsArmorToProtection, buildBonusBlock, mkSymStats,
} = require('./shared');

// ── Paths ──────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..');
const ENTITIES_ROOT = path.resolve(REPO_ROOT, '..', 'Svellheim-Entities');
const ITEM_SRC = path.join(ENTITIES_ROOT, 'data', 'items');
const ITEM_OUT = path.join(REPO_ROOT, 'data', 'items');
const MODULE_ID = 'svellheim-symbaroum';

// ── DS Item Kind → Symbaroum Item Type ────────────────────────────────
function mapItemType(dsKind, dsCategory) {
  if (dsCategory === 'consumable') return 'equipment';
  switch (dsKind) {
    case 'weapon': return 'weapon';
    case 'armor': case 'shield': return 'armor';
    case 'implement': return 'equipment';
    default: return 'artifact';
  }
}

// ── DS Echelon → Symbaroum Power Level ────────────────────────────────
function echelonToCorruptionCost(echelon) {
  if (echelon <= 1) return 1;
  if (echelon <= 4) return 2;
  if (echelon <= 7) return 3;
  return 4; // 1d4 temporary corruption
}

// ── Infer Qualities from Description ──────────────────────────────────
function inferQualities(description) {
  const desc = description.toLowerCase();
  const qualities = {};

  // Weapon qualities
  if (desc.includes('frost') || desc.includes('cold') || desc.includes('ice')) {
    qualities.flaming = true; // Re-purpose flaming for frost aesthetic
  }
  if (desc.includes('fire') || desc.includes('flame') || desc.includes('ember')) {
    qualities.flaming = true;
  }
  if (desc.includes('holy') || desc.includes('hallowed') || desc.includes('blessed')) {
    qualities.hallowed = true;
  }
  if (desc.includes('corrupt') || desc.includes('dark') || desc.includes('necrotic')) {
    qualities.desecrated = true;
  }
  if (desc.includes('poison') || desc.includes('venom')) {
    qualities.poison = true;
  }
  if (desc.includes('thunder') || desc.includes('lightning') || desc.includes('storm')) {
    qualities.thundering = true;
  }
  if (desc.includes('mystical') || desc.includes('magic') || desc.includes('rune')) {
    qualities.mystical = true;
  }
  if (desc.includes('bane') || desc.includes('slay') || desc.includes('destroy')) {
    qualities.bane = true;
  }
  if (desc.includes('death') || desc.includes('grave')) {
    qualities.deathrune = true;
  }

  return qualities;
}

// ── Convert a single DS item → Symbaroum Item ─────────────────────────
function convertItem(dsItem) {
  const sys = dsItem.system || {};
  const name = fixMojibake(dsItem.name || 'Unknown Item');
  const slug = slugify(name);
  const kind = sys.kind || '';
  const category = sys.category || 'leveled';
  const echelon = sys.echelon || 1;
  const keywords = sys.keywords || [];

  // Description
  let desc = replaceTerms(sys.description?.value || '');
  desc = stripTableStyles(desc);

  // Director notes
  const directorNotes = replaceTerms(sys.description?.director || '');

  // Crafting info
  if (sys.project?.prerequisites) {
    desc += `\n<hr><h3>Crafting</h3>`;
    desc += `<p><strong>Prerequisites:</strong> ${replaceTerms(sys.project.prerequisites)}</p>`;
    if (sys.project.source) desc += `<p><strong>Source:</strong> ${replaceTerms(sys.project.source)}</p>`;
    if (sys.project.goal) desc += `<p><strong>Crafting Time:</strong> ${sys.project.goal} downtime days</p>`;
  }

  // Director notes → secret block
  if (directorNotes) {
    desc += `\n<section class="secret"><h3>GM Notes</h3>${directorNotes}</section>`;
  }

  const symbType = mapItemType(kind, category);
  const isArtifact = echelon >= 2 && category !== 'consumable';

  // Infer qualities
  const qualities = inferQualities(desc);

  const symbItem = {
    _id: foundryId(`symb:item:${slug}`),
    name: name,
    type: symbType,
    img: dsItem.img ? dsItem.img.replace(/modules\/svellheim-entities/g, `modules/${MODULE_ID}`) : 'icons/svg/item-bag.svg',
    system: {
      description: desc,
      bonus: buildBonusBlock(),
      isArtifact: isArtifact,
      power: {},
      qualities: {},
      marker: '',
      state: 'other',
    },
    effects: [],
    flags: {},
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    _stats: mkSymStats(),
  };

  // ── Type-specific fields ──
  if (symbType === 'weapon') {
    symbItem.system.attribute = 'accurate';
    symbItem.system.reference = '1handed';
    symbItem.system.baseDamage = echelon >= 5 ? '1d10' : echelon >= 3 ? '1d8' : '1d6';
    symbItem.system.bonusDamage = echelon >= 4 ? '+1' : '';
    symbItem.system.alternativeDamage = '';
    symbItem.system.cost = '';
    symbItem.system.number = 1;
    symbItem.system.isArtifact = isArtifact;
    symbItem.system.quality = '';
    symbItem.system.qualities = qualities;

    // Two-handed heavy weapons
    if (desc.toLowerCase().includes('two-hand') || desc.toLowerCase().includes('great') || keywords.includes('heavy')) {
      symbItem.system.reference = 'heavy';
      symbItem.system.baseDamage = echelon >= 5 ? '1d12' : echelon >= 3 ? '1d10' : '1d8';
    }
    // Ranged
    if (keywords.includes('ranged') || desc.toLowerCase().includes('bow') || desc.toLowerCase().includes('throw')) {
      symbItem.system.reference = 'ranged';
    }
  }

  if (symbType === 'armor') {
    symbItem.system.baseProtection = kind === 'shield' ? '1d4' : dsArmorToProtection(echelon);
    symbItem.system.bonusProtection = '';
    symbItem.system.qualities = {
      flexible: desc.toLowerCase().includes('flexible') || desc.toLowerCase().includes('light'),
      reinforced: desc.toLowerCase().includes('reinforced') || desc.toLowerCase().includes('heavy'),
      cumbersome: desc.toLowerCase().includes('cumbersome') || desc.toLowerCase().includes('plate'),
      concealed: false,
      hallowed: qualities.hallowed || false,
      retributive: false,
      desecrated: qualities.desecrated || false,
    };
    symbItem.system.cost = '';
    symbItem.system.state = 'other';
    symbItem.system.impeding = kind === 'shield' ? 1 : desc.toLowerCase().includes('heavy') ? 3 : desc.toLowerCase().includes('medium') ? 2 : 1;
    symbItem.system.isArtifact = isArtifact;
  }

  if (symbType === 'equipment') {
    symbItem.system.cost = '';
    symbItem.system.number = sys.quantity || 1;
    symbItem.system.isArtifact = false;
  }

  if (symbType === 'artifact') {
    symbItem.type = 'artifact';
    symbItem.system.isArtifact = true;
    symbItem.system.corruptionDescription = `Using this artifact costs ${echelonToCorruptionCost(echelon)} temporary corruption.`;
    symbItem.system.power = {
      description: desc,
      action: 'A',
    };
  }

  return symbItem;
}

// ── Process all items ──────────────────────────────────────────────────
function main() {
  console.log('=== DS → Symbaroum Item Conversion ===\n');

  if (!fs.existsSync(ITEM_SRC)) {
    console.log(`  Source dir not found: ${ITEM_SRC}`);
    console.log('  Make sure Svellheim-Entities repo exists at the expected path.');
    return;
  }

  fs.mkdirSync(ITEM_OUT, { recursive: true });

  const files = fs.readdirSync(ITEM_SRC).filter(f => f.endsWith('.json')).sort();
  let count = 0;

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ITEM_SRC, file), 'utf8'));
      const converted = convertItem(raw);
      fs.writeFileSync(path.join(ITEM_OUT, file), JSON.stringify(converted, null, 2), 'utf8');
      count++;
      console.log(`  ✓ ${converted.name} (${converted.type})`);
    } catch (err) {
      console.error(`  ✗ ERROR converting ${file}: ${err.message}`);
    }
  }

  console.log(`\n  Items converted: ${count}`);
}

main();

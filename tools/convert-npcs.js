#!/usr/bin/env node
/**
 * convert-npcs.js
 *
 * Reads Draw Steel NPC JSONs from Svellheim-Entities
 * and outputs Symbaroum-compatible Actor JSONs for the svellheim-symbaroum module.
 *
 * NPCs become Symbaroum "monster" type actors with detailed bio fields.
 *
 * Usage: node tools/convert-npcs.js
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  foundryId, slugify,
  buildAttributes, convertToughness, buildHealth, buildArmorBlock,
  mapSize, convertMovement, buildBio, buildBonusBlock,
  buildExperienceBlock, mkSymStats, mkPrototypeToken,
  replaceTerms, stripTableStyles,
} = require('./shared');

// ── Paths ──────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..');
const ENTITIES_ROOT = path.resolve(REPO_ROOT, '..', 'Svellheim-Entities');
const NPC_SRC = path.join(ENTITIES_ROOT, 'data', 'npcs');
const NPC_OUT = path.join(REPO_ROOT, 'data', 'npcs');
const MODULE_ID = 'svellheim-symbaroum';

// ── Convert a single DS NPC → Symbaroum Actor ─────────────────────────
function convertNPC(dsNpc) {
  const sys = dsNpc.system || {};
  const characteristics = sys.characteristics || {};
  const biography = sys.biography || {};
  const movement = sys.movement || {};

  const name = dsNpc.name || 'Unknown NPC';

  // ── Build Symbaroum Actor ──
  const symbId = foundryId(`symb:npc:${slugify(name)}`);

  // NPCs have moderate attributes (DS level 3 equivalent)
  let attr = buildAttributes(characteristics);

  // NPCs have moderate toughness (like a platoon-level creature)
  const { toughness, corruption } = convertToughness(sys.stamina?.value || 15, 'platoon');

  const movDesc = convertMovement(movement);

  // Description
  let description = replaceTerms(biography.value || '');
  description = stripTableStyles(description);
  if (movDesc) {
    description += `\n<p><strong>Movement:</strong> ${movDesc}</p>`;
  }

  // Bio
  const bio = buildBio('Human', 'NPC');
  bio.quote = replaceTerms(biography.value || '').replace(/<[^>]*>/g, '').substring(0, 200);
  bio.shadow = '';

  // Collect embedded items (abilities, traits) from DS NPC
  const embeddedItems = [];
  const dsItems = dsNpc.items || [];

  for (const dsItem of dsItems) {
    const itemSys = dsItem.system || {};
    const desc = replaceTerms(itemSys.description?.value || '');

    // Create a simple trait or ability entry
    const itemType = itemSys.type || 'ability';
    const symbType = (itemType === 'feature') ? 'trait' : 'ability';

    const npcItem = {
      _id: foundryId(`symb:${symbType}:${slugify(dsItem.name)}:${dsItem._id}`),
      name: dsItem.name || 'Ability',
      type: symbType,
      img: dsItem.img || 'icons/svg/item-bag.svg',
      system: {
        description: desc,
        reference: '',
        novice: { isActive: true, action: 'A', description: desc },
        adept: { isActive: false, action: 'A', description: '' },
        master: { isActive: false, action: 'A', description: '' },
        bonus: buildBonusBlock(),
        isArtifact: false,
        power: {},
        qualities: {},
        marker: '',
        state: 'active',
      },
      effects: [],
      flags: {},
      sort: 0,
      ownership: { default: 0 },
      _stats: mkSymStats(),
    };
    embeddedItems.push(npcItem);
  }

  // Build actor
  const tokenImg = (dsNpc.prototypeToken?.texture?.src || dsNpc.img || '')
    .replace(/modules\/svellheim-entities/g, `modules/${MODULE_ID}`);

  const actor = {
    _id: symbId,
    name: name,
    type: 'monster',
    img: tokenImg || 'icons/svg/mystery-man.svg',
    system: {
      attributes: attr,
      health: {
        toughness: toughness,
        corruption: corruption,
      },
      combat: {
        baseProtection: '0',
        bonusProtection: '',
        qualities: {},
        cost: '',
        state: 'other',
        impeding: 0,
      },
      bio: bio,
      bonus: buildBonusBlock(),
      experience: buildExperienceBlock(3),
      nbrOfFailedDeathRoll: 0,
      isMonster: true,
    },
    items: embeddedItems,
    effects: [],
    flags: {},
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    prototypeToken: mkPrototypeToken(name, tokenImg, 0), // NPCs are neutral/friendly
    _stats: mkSymStats(),
  };

  return actor;
}

// ── Process all NPCs ───────────────────────────────────────────────────
function main() {
  console.log('=== DS → Symbaroum NPC Conversion ===\n');

  if (!fs.existsSync(NPC_SRC)) {
    console.log(`  Source dir not found: ${NPC_SRC}`);
    console.log('  Make sure Svellheim-Entities repo exists at the expected path.');
    return;
  }

  fs.mkdirSync(NPC_OUT, { recursive: true });

  const files = fs.readdirSync(NPC_SRC).filter(f => f.endsWith('.json')).sort();
  let count = 0;

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(NPC_SRC, file), 'utf8'));
      const converted = convertNPC(raw);
      fs.writeFileSync(path.join(NPC_OUT, file), JSON.stringify(converted, null, 2), 'utf8');
      count++;
      console.log(`  ✓ ${converted.name}`);
    } catch (err) {
      console.error(`  ✗ ERROR converting ${file}: ${err.message}`);
    }
  }

  console.log(`\n  NPCs converted: ${count}`);
}

main();

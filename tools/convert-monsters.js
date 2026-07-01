#!/usr/bin/env node
/**
 * convert-monsters.js
 *
 * Reads Draw Steel monster JSONs from Svellheim-Entities
 * and outputs Symbaroum-compatible Actor JSONs for the svellheim-symbaroum module.
 *
 * Usage: node tools/convert-monsters.js
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  foundryId, slugify,
  buildAttributes, convertToughness, buildHealth, buildArmorBlock,
  mapSize, convertMovement, mapTraits, convertWeapon, convertAbility,
  replaceTerms, stripTableStyles, buildBio, buildBonusBlock,
  buildExperienceBlock, mkSymStats, mkPrototypeToken,
} = require('./shared');

// ── Paths ──────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..');
const ENTITIES_ROOT = path.resolve(REPO_ROOT, '..', 'Svellheim-Entities');
const MONSTER_SRC = path.join(ENTITIES_ROOT, 'data', 'monsters');
const MONSTER_OUT = path.join(REPO_ROOT, 'data', 'monsters');
const MODULE_ID = 'svellheim-symbaroum';

// ── Convert a single DS monster → Symbaroum Actor ─────────────────────
function convertMonster(dsMonster) {
  const sys = dsMonster.system || {};
  const monsterData = sys.monster || {};
  const characteristics = sys.characteristics || {};
  const combat = sys.combat || {};
  const biography = sys.biography || {};
  const movement = sys.movement || {};
  const damage = sys.damage || {};

  const name = dsMonster.name || 'Unknown Monster';
  const dsLevel = monsterData.level || 1;
  const dsOrg = monsterData.organization || 'platoon';
  const dsRole = monsterData.role || 'brute';
  const dsKeywords = monsterData.keywords || [];

  // ── Build Symbaroum Actor ──
  const symbId = foundryId(`symb:monster:${slugify(name)}`);
  const attr = buildAttributes(characteristics);
  const { toughness, corruption } = convertToughness(sys.stamina?.value || 10, dsOrg);
  const size = mapSize(combat.size);
  const movDesc = convertMovement(movement);

  // Description with bio info
  let description = replaceTerms(biography.value || '');
  description = stripTableStyles(description);

  // Movement info
  description += `\n<p><strong>Movement:</strong> ${movDesc}</p>`;

  // Damage immunities/weaknesses as flavor
  const immunities = damage.immunities || {};
  const weaknesses = damage.weaknesses || {};
  const immList = Object.entries(immunities).filter(([k, v]) => v > 0 && k !== 'all').map(([k, v]) => k).join(', ');
  const weakList = Object.entries(weaknesses).filter(([k, v]) => v > 0 && k !== 'all').map(([k, v]) => k).join(', ');
  if (immList) description += `\n<p><strong>Resistances:</strong> ${immList}</p>`;
  if (weakList) description += `\n<p><strong>Vulnerabilities:</strong> ${weakList}</p>`;

  // Determine creature type label
  const creatureType = dsKeywords.length > 0 ? dsKeywords[0] : 'monster';
  const typeLabel = creatureType.charAt(0).toUpperCase() + creatureType.slice(1);

  // Map traits from keywords
  const traits = mapTraits(dsKeywords, dsLevel, dsRole);

  // Convert embedded items (abilities → traits/weapons)
  const embeddedItems = [];
  const dsItems = dsMonster.items || [];

  for (const dsItem of dsItems) {
    const itemSys = dsItem.system || {};
    const itemType = dsItem.type;
    const itemCategory = itemSys.category || '';

    if (itemType === 'ability' && itemCategory === 'signature') {
      // Main attack → weapon item
      const weapon = convertWeapon(dsItem, characteristics, dsLevel);
      if (weapon) embeddedItems.push(weapon);
    } else if (itemType === 'ability') {
      // Non-attack ability → trait or ability item
      const ability = convertAbility(dsItem, dsLevel);
      if (ability) embeddedItems.push(ability);
    } else if (itemType === 'feature') {
      // Passive feature → trait
      const featDesc = replaceTerms(itemSys.description?.value || '');
      const traitItem = {
        _id: foundryId(`symb:trait:${slugify(dsItem.name)}:${dsItem._id}`),
        name: dsItem.name,
        type: 'trait',
        img: dsItem.img || 'icons/svg/item-bag.svg',
        system: {
          description: featDesc,
          reference: '',
          novice: { isActive: false, action: 'P', description: featDesc },
          adept: { isActive: false, action: 'P', description: '' },
          master: { isActive: false, action: 'P', description: '' },
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
      embeddedItems.push(traitItem);
    }
  }

  // Add trait items from keyword mapping
  for (const traitDef of traits) {
    const traitId = foundryId(`symb:trait:${traitDef.reference}:${symbId}`);
    const traitItem = {
      _id: traitId,
      name: traitDef.name,
      type: 'trait',
      img: `systems/symbaroum/asset/image/trait.png`,
      system: {
        description: '',
        reference: traitDef.reference,
        novice: { isActive: traitDef.level >= 1, action: 'P', description: '' },
        adept: { isActive: traitDef.level >= 2, action: 'P', description: '' },
        master: { isActive: traitDef.level >= 3, action: 'P', description: '' },
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
    embeddedItems.push(traitItem);
  }

  // Build the Symbaroum Actor
  const tokenImg = (dsMonster.prototypeToken?.texture?.src || dsMonster.img || '')
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
      bio: {
        race: typeLabel,
        occupation: dsRole.charAt(0).toUpperCase() + dsRole.slice(1),
        quote: '',
        shadow: `A ${size} ${typeLabel} of DS level ${dsLevel} (${dsOrg})`,
        manner: '',
      },
      bonus: buildBonusBlock(),
      experience: buildExperienceBlock(dsLevel),
      nbrOfFailedDeathRoll: 0,
      isMonster: true,
    },
    items: embeddedItems,
    effects: [],
    flags: {},
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    prototypeToken: mkPrototypeToken(name, tokenImg, -1),
    _stats: mkSymStats(),
  };

  return actor;
}

// ── Process all monsters ───────────────────────────────────────────────
function main() {
  console.log('=== DS → Symbaroum Monster Conversion ===\n');

  if (!fs.existsSync(MONSTER_SRC)) {
    console.log(`  Source dir not found: ${MONSTER_SRC}`);
    console.log('  Make sure Svellheim-Entities repo exists at the expected path.');
    return;
  }

  fs.mkdirSync(MONSTER_OUT, { recursive: true });

  const files = fs.readdirSync(MONSTER_SRC).filter(f => f.endsWith('.json')).sort();
  let count = 0;

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(MONSTER_SRC, file), 'utf8'));
      const converted = convertMonster(raw);
      fs.writeFileSync(path.join(MONSTER_OUT, file), JSON.stringify(converted, null, 2), 'utf8');
      count++;
      console.log(`  ✓ ${converted.name}`);
    } catch (err) {
      console.error(`  ✗ ERROR converting ${file}: ${err.message}`);
    }
  }

  console.log(`\n  Monsters converted: ${count}`);
}

main();

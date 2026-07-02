#!/usr/bin/env node
/**
 * convert-npcs.js
 *
 * Reads Draw Steel NPC JSONs from Svellheim-Entities and outputs
 * Symbaroum-compatible Actor JSONs. NPCs are bio-only: no embedded
 * ability/trait items — all character details live in bio.description.
 *
 * Usage: node tools/convert-npcs.js
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  foundryId, slugify,
  buildAttributes, convertToughness, mapSize, convertMovement,
  buildBonusBlock, buildBio, buildExperienceBlock,
  replaceTerms, stripTableStyles, mkSymStats, mkPrototypeToken,
} = require('./shared');

const REPO_ROOT = path.resolve(__dirname, '..');
const ENTITIES_ROOT = path.resolve(REPO_ROOT, '..', 'Svellheim-Entities');
const NPC_SRC = path.join(ENTITIES_ROOT, 'data', 'npcs');
const NPC_OUT = path.join(REPO_ROOT, 'data', 'npcs');
const MODULE_ID = 'svellheim-symbaroum';

function convertNPC(dsNpc) {
  const sys = dsNpc.system || {};
  const characteristics = sys.characteristics || {};
  const biography = sys.biography || {};
  const movement = sys.movement || {};

  const name = dsNpc.name || 'Unknown NPC';
  const symbId = foundryId(`symb:npc:${slugify(name)}`);

  // Moderate attributes for NPCs
  const attr = buildAttributes(characteristics);

  // Moderate toughness
  const { toughness, corruption } = convertToughness(sys.stamina?.value || 15, 'platoon');
  const movDesc = convertMovement(movement);

  // Build comprehensive bio description
  let desc = replaceTerms(biography.value || '');
  desc = stripTableStyles(desc);
  if (movDesc) desc += `\n<p><strong>Movement:</strong> ${movDesc}</p>`;

  // Collect any DS abilities as narrative description
  const dsItems = dsNpc.items || [];
  if (dsItems.length > 0) {
    const abilityTexts = [];
    for (const item of dsItems) {
      const itemSys = item.system || {};
      const itemName = item.name || '';
      const itemDesc = replaceTerms(itemSys.description?.value || '');
      if (itemName && itemDesc) {
        abilityTexts.push(`<p><strong>${itemName}:</strong> ${itemDesc}</p>`);
      }
    }
    if (abilityTexts.length > 0) {
      desc += `\n<hr>\n<h3>Notable Traits</h3>\n${abilityTexts.join('\n')}`;
    }
  }

  // Bio
  const bio = buildBio('Human', 'NPC');
  bio.shadow = replaceTerms(biography.value || '').replace(/<[^>]*>/g, '').substring(0, 300);

  // No embedded items — NPCs are bio-only
  const tokenImg = (dsNpc.prototypeToken?.texture?.src || dsNpc.img || '')
    .replace(/modules\/svellheim-entities/g, `modules/${MODULE_ID}`);

  return {
    _id: symbId,
    name,
    type: 'monster', // Symbaroum uses 'monster' type for all NPCs/adversaries
    img: tokenImg || 'icons/svg/mystery-man.svg',
    system: {
      attributes: attr,
      health: { toughness, corruption },
      combat: {
        baseProtection: '0', bonusProtection: '', qualities: {},
        cost: '', state: 'other', impeding: 0,
      },
      bio,
      bonus: buildBonusBlock(),
      experience: buildExperienceBlock(),
      nbrOfFailedDeathRoll: 0,
      isMonster: true,
    },
    items: [], // NO embedded items
    effects: [], flags: {}, folder: null, sort: 0, ownership: { default: 0 },
    prototypeToken: mkPrototypeToken(name, tokenImg, 0), // NPCs are neutral
    _stats: mkSymStats(),
  };
}

function main() {
  console.log('=== DS → Symbaroum NPC Conversion (BIO-ONLY) ===\n');
  if (!fs.existsSync(NPC_SRC)) {
    console.log(`  Source dir not found: ${NPC_SRC}`);
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
      console.error(`  ✗ ERROR ${file}: ${err.message}`);
    }
  }
  console.log(`\n  NPCs converted: ${count}`);
}

main();

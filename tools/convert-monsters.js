#!/usr/bin/env node
/**
 * convert-monsters.js
 *
 * Reads Draw Steel monster JSONs from Svellheim-Entities and outputs
 * Symbaroum-compatible Actor JSONs using ONLY canon traits/abilities
 * from the Symbaroum system. No empty reference fields.
 *
 * Usage: node tools/convert-monsters.js
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  foundryId, slugify,
  buildAttributes, convertToughness, mapSize, convertMovement,
  getCanonTraits, getCanonAbilities,
  buildTraitItem, buildAbilityItem, buildMonsterWeapon,
  collectMonsterAbilitiesDescription,
  replaceTerms, stripTableStyles, buildBonusBlock, buildBio,
  buildExperienceBlock, mkSymStats, mkPrototypeToken,
} = require('./shared');

const REPO_ROOT = path.resolve(__dirname, '..');
const ENTITIES_ROOT = path.resolve(REPO_ROOT, '..', 'Svellheim-Entities');
const MONSTER_SRC = path.join(ENTITIES_ROOT, 'data', 'monsters');
const MONSTER_OUT = path.join(REPO_ROOT, 'data', 'monsters');
const MODULE_ID = 'svellheim-symbaroum';

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

  // ── Symbaroum actor base ──
  const symbId = foundryId(`symb:monster:${slugify(name)}`);
  const attr = buildAttributes(characteristics);
  const { toughness, corruption } = convertToughness(sys.stamina?.value || 10, dsOrg);
  const size = mapSize(combat.size);
  const movDesc = convertMovement(movement);

  // ── Build description ──
  let desc = replaceTerms(biography.value || '');
  desc = stripTableStyles(desc);
  desc += `\n<p><strong>Movement:</strong> ${movDesc}</p>`;

  // Damage resistances/weaknesses as text
  const immunities = damage.immunities || {};
  const weaknesses = damage.weaknesses || {};
  const immList = Object.entries(immunities).filter(([,v]) => v > 0).map(([k]) => k).join(', ');
  const weakList = Object.entries(weaknesses).filter(([,v]) => v > 0).map(([k]) => k).join(', ');
  if (immList) desc += `\n<p><strong>Resistances:</strong> ${immList}</p>`;
  if (weakList) desc += `\n<p><strong>Vulnerabilities:</strong> ${weakList}</p>`;

  // Collect special abilities as description text (NOT as items!)
  const abilitiesDesc = collectMonsterAbilitiesDescription(dsMonster.items);
  if (abilitiesDesc) {
    desc += `\n<hr>\n<h3>Special Abilities</h3>\n${abilitiesDesc}`;
  }

  // ── Build embedded items (CANON ONLY) ──
  const items = [];

  // 1. Canon traits from keywords
  const traitRefs = getCanonTraits(dsKeywords);
  for (const ref of traitRefs) {
    items.push(buildTraitItem(ref, 1));
  }

  // 2. Canon abilities from role
  const abilityDefs = getCanonAbilities(dsRole, dsLevel);
  for (const ab of abilityDefs) {
    items.push(buildAbilityItem(ab.reference, ab.level, 'A'));
  }

  // 3. ONE weapon from the signature attack
  const dsItems = dsMonster.items || [];
  const sigAttack = dsItems.find(i => (i.system || {}).category === 'signature');
  if (sigAttack) {
    const weapon = buildMonsterWeapon(sigAttack, characteristics, dsLevel);
    items.push(weapon);
  } else {
    // Fallback: natural weapon
    items.push({
      _id: foundryId(`symb:weapon:natural:${symbId}`),
      name: 'Natural Weapon',
      type: 'weapon',
      img: 'icons/svg/sword.svg',
      system: {
        description: '',
        attribute: 'strong',
        reference: 'unarmed',
        baseDamage: '1d6',
        bonusDamage: '', alternativeDamage: '', cost: '', number: 1,
        isArtifact: false, quality: '', qualities: {},
        bonus: buildBonusBlock(),
        power: {}, marker: '', state: 'active',
      },
      effects: [], flags: {}, sort: 0, ownership: { default: 0 },
      _stats: mkSymStats(),
    });
  }

  // ── Bio ──
  const creatureType = dsKeywords.length > 0 ? dsKeywords[0] : 'monster';
  const typeLabel = creatureType.charAt(0).toUpperCase() + creatureType.slice(1);
  const bio = buildBio(typeLabel, dsRole.charAt(0).toUpperCase() + dsRole.slice(1));
  bio.shadow = replaceTerms(biography.value || '').replace(/<[^>]*>/g, '').substring(0, 300);

  // ── Assemble actor ──
  const tokenImg = (dsMonster.prototypeToken?.texture?.src || dsMonster.img || '')
    .replace(/modules\/svellheim-entities/g, `modules/${MODULE_ID}`);

  return {
    _id: symbId,
    name,
    type: 'monster',
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
    items,
    effects: [], flags: {}, folder: null, sort: 0, ownership: { default: 0 },
    prototypeToken: mkPrototypeToken(name, tokenImg, -1),
    _stats: mkSymStats(),
  };
}

function main() {
  console.log('=== DS → Symbaroum Monster Conversion (CANON ONLY) ===\n');
  if (!fs.existsSync(MONSTER_SRC)) {
    console.log(`  Source dir not found: ${MONSTER_SRC}`);
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
      console.error(`  ✗ ERROR ${file}: ${err.message}`);
    }
  }
  console.log(`\n  Monsters converted: ${count}`);
}

main();

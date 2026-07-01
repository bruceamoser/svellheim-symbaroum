#!/usr/bin/env node
/**
 * shared.js — Shared utilities for DS → Symbaroum conversion scripts.
 *
 * Reads Draw Steel entity JSONs from Svellheim-Entities and provides
 * helpers to produce Symbaroum-compatible Foundry VTT data structures.
 */
const crypto = require('node:crypto');

// ── Deterministic ID helpers (same as 5e version) ──────────────────────
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function base62FromBuffer(buf, length) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex'));
  const base = BigInt(B62.length);
  let out = '';
  while (n > 0n) {
    out = B62[Number(n % base)] + out;
    n /= base;
  }
  if (out.length < length) out = out.padStart(length, '0');
  if (out.length > length) out = out.slice(0, length);
  return out;
}

function foundryId(seed) {
  const digest = crypto.createHash('sha1').update(String(seed)).digest();
  return base62FromBuffer(digest.subarray(0, 12), 16);
}

function slugify(input) {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[ðÐ]/g, 'd')
    .replace(/[þÞ]/g, 'th')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ── DS Characteristic → Symbaroum Attribute ────────────────────────────
// DS characteristics range from -3 to +5. Symbaroum attributes typical
// range is 5–15 for human-scale. We use a linear mapping.

const DS_TO_SYMB_ATTR = {
  might:     'strong',
  agility:   'quick',
  reason:    'cunning',
  intuition: 'vigilant',
  presence:  'persuasive',
};

/** Convert a DS characteristic value (-3..+5) to a Symbaroum attribute value (5–15). */
function dsCharToSymbValue(dsValue) {
  // Linear mapping: 10 + (dsValue * 1.5), clamped to 5–18
  return Math.max(5, Math.min(18, Math.round(10 + (dsValue * 1.5))));
}

/** Build the full 8-attribute object for a Symbaroum actor from DS characteristics. */
function buildAttributes(dsCharacteristics) {
  const attrs = {};
  // Primary attributes from DS characteristics
  for (const [dsKey, symKey] of Object.entries(DS_TO_SYMB_ATTR)) {
    const val = dsCharacteristics?.[dsKey]?.value ?? 0;
    attrs[symKey] = { value: dsCharToSymbValue(val), bonus: 0, total: 0, modifier: 0, temporaryMod: 0 };
  }
  // Derived attributes
  const strongVal = attrs.strong?.value || 10;
  const quickVal  = attrs.quick?.value  || 10;
  const cunningVal = attrs.cunning?.value || 10;
  const vigilantVal = attrs.vigilant?.value || 10;
  const persuasiveVal = attrs.persuasive?.value || 10;

  attrs.accurate   = { value: Math.round((strongVal + quickVal) / 2), bonus: 0, total: 0, modifier: 0, temporaryMod: 0 };
  attrs.discreet   = { value: 10, bonus: 0, total: 0, modifier: 0, temporaryMod: 0 };
  attrs.resolute   = { value: Math.round((cunningVal + persuasiveVal) / 2), bonus: 0, total: 0, modifier: 0, temporaryMod: 0 };

  // Compute derived totals
  for (const key of Object.keys(attrs)) {
    attrs[key].total = attrs[key].value + attrs[key].bonus + attrs[key].temporaryMod;
    attrs[key].modifier = 10 - attrs[key].total;
  }

  return attrs;
}

// ── DS Stamina → Symbaroum Toughness ───────────────────────────────────
// Symbaroum Toughness is a small flat number (typically 10-15 for humans,
// 5-25 for monsters). Pain Threshold = Toughness / 2.

function convertToughness(dsStamina, dsOrg) {
  const base = dsStamina || 10;
  // Organization multiplier
  const orgMult = {
    minion: 1.0,
    horde:  1.2,
    platoon: 1.5,
    elite:  2.0,
    leader: 2.5,
    solo:   3.5,
  };
  const mult = orgMult[dsOrg] || 1.5;
  const toughness = Math.max(5, Math.min(40, Math.round(base * mult)));
  const threshold = Math.floor(toughness / 2);
  return {
    toughness: { value: toughness, max: toughness, threshold },
    corruption: { value: 0, max: 0, threshold: 0 },
  };
}

// ── DS Size → Symbaroum size ──────────────────────────────────────────
function mapSize(dsSize) {
  if (!dsSize) return 'medium';
  const val = dsSize.value || 1;
  const letter = (dsSize.letter || 'M').toUpperCase();
  if (letter === 'T') return 'tiny';
  if (letter === 'S') return 'small';
  if (letter === 'M') return 'medium';
  if (letter === 'L') return 'large';
  if (letter === 'H') return 'huge';
  if (letter === 'G') return 'gargantuan';
  if (val <= 0.5) return 'tiny';
  if (val <= 1) return 'medium';
  if (val <= 2) return 'large';
  if (val <= 3) return 'huge';
  return 'gargantuan';
}

// ── DS Movement → Text description ────────────────────────────────────
function convertMovement(dsMovement) {
  const types = dsMovement?.types || ['walk'];
  const speed = dsMovement?.value || 5;
  const speeds = [];
  for (const t of types) {
    switch (t) {
      case 'walk': speeds.push(`Movement: ${speed * 2}`); break;
      case 'climb': speeds.push(`Climbing: ${speed * 2}`); break;
      case 'swim': speeds.push(`Swimming: ${speed * 2}`); break;
      case 'fly': speeds.push(`Flying: ${speed * 3}`); break;
      case 'burrow': speeds.push(`Burrowing: ${speed}`); break;
      default: speeds.push(`${t}: ${speed * 2}`); break;
    }
  }
  return speeds.join(', ');
}

// ── DS Keywords → Symbaroum Traits ────────────────────────────────────
const KEYWORD_TO_TRAITS = {
  undead:      ['undead', 'gravelycold'],
  construct:   ['armored', 'robust'],
  beast:       ['naturalweapon'],
  plant:       ['regeneration', 'rootwall'],
  fey:         ['spiritform', 'freespirit'],
  elemental:   ['alternativedamage'],
  swarm:       ['swarm', 'diminutive'],
  ooze:        ['acidicblood', 'corruptingattack'],
  giant:       ['colossal', 'robust'],
  demon:       ['corruptingattack', 'terrify'],
  dragon:      ['colossal', 'deadlybreath', 'terrify'],
};

/**
 * Map DS monster keywords to an array of Symbaroum trait names.
 * Returns [{ name, reference, level }] for embedding as trait items.
 */
function mapTraits(dsKeywords, dsLevel, dsRole) {
  const traits = [];
  const added = new Set();
  if (!dsKeywords || !dsKeywords.length) return traits;

  for (const kw of dsKeywords) {
    const mapped = KEYWORD_TO_TRAITS[kw.toLowerCase()];
    if (mapped) {
      for (const t of mapped) {
        if (!added.has(t)) {
          traits.push({ name: t, reference: t, level: 1 });
          added.add(t);
        }
      }
    }
  }

  // Role-based traits
  if (dsRole === 'brute' && !added.has('robust')) {
    traits.push({ name: 'Robust', reference: 'robust', level: 1 });
    added.add('robust');
  }
  if (dsRole === 'artillery' && !added.has('naturalweapon')) {
    traits.push({ name: 'Natural Weapon', reference: 'naturalweapon', level: 1 });
    added.add('naturalweapon');
  }
  if (dsRole === 'controller' && !added.has('enthrall')) {
    traits.push({ name: 'Enthrall', reference: 'enthrall', level: 1 });
    added.add('enthrall');
  }
  if (dsRole === 'sniper' && !added.has('observant')) {
    traits.push({ name: 'Observant', reference: 'observant', level: 1 });
    added.add('observant');
  }

  return traits;
}

// ── DS Damage Type → Symbaroum ────────────────────────────────────────
// Symbaroum doesn't have explicit damage types like D&D. Instead it uses
// traits and weapon qualities. We map for flavor text purposes.

const DAMAGE_TYPE_FLAVOR = {
  acid:       { name: 'Acid', desc: 'corrosive acid' },
  cold:       { name: 'Cold', desc: 'frozen chill' },
  corruption: { name: 'Corruption', desc: 'corrupting darkness' },
  fire:       { name: 'Fire', desc: 'searing flame' },
  holy:       { name: 'Holy', desc: 'hallowed light' },
  lightning:  { name: 'Lightning', desc: 'crackling lightning' },
  poison:     { name: 'Poison', desc: 'debilitating poison' },
  psychic:    { name: 'Psychic', desc: 'psychic assault' },
  sonic:      { name: 'Sonic', desc: 'thunderous force' },
};

// ── DS Ability → Symbaroum Ability/Trait Item ─────────────────────────
// DS action types map to Symbaroum action types: A=Active, M=Movement,
// T=Full Turn, F=Free, P=Passive, R=Reaction, S=Special

const DS_CATEGORY_TO_ACTION = {
  signature: 'A',   // Main attack
  heroic:    'A',   // Heroic ability
  action:    'A',
  maneuver:  'M',
  triggered: 'R',
  free:      'F',
  passive:   'P',
  villain:   'S',
};

/**
 * Convert a DS ability item to a Symbaroum embedded trait or ability item.
 * Monsters use traits for most abilities; special abilities become
 * embedded "ability" items.
 */
function convertAbility(dsItem, dsLevel) {
  const sys = dsItem.system || {};
  const dsCategory = sys.category || 'action';
  const actionType = DS_CATEGORY_TO_ACTION[dsCategory] || 'A';
  const desc = replaceTerms(sys.description?.value || sys.effect?.after || sys.effect?.before || '');

  // Determine if this should be a trait or ability
  const isAttack = dsCategory === 'signature' || (sys.keywords || []).includes('strike');

  if (isAttack) {
    // This is a weapon attack — we'll handle it as a weapon item
    return null; // Signal that this gets converted to a weapon instead
  }

  // For non-attack abilities, create a Symbaroum trait or ability
  const itemName = dsItem.name || 'Unknown Ability';
  // Determine trait reference from keywords
  let reference = '';
  const keywords = sys.keywords || [];
  if (keywords.includes('area')) reference = 'deadlybreath';
  else if (keywords.includes('ranged')) reference = 'alternativedamage';

  const symbItem = {
    _id: foundryId(`symb:ability:${slugify(itemName)}:${dsItem._id}`),
    name: itemName,
    type: reference ? 'trait' : 'ability',
    img: dsItem.img || 'icons/svg/item-bag.svg',
    system: {
      description: desc,
      reference: reference,
      novice: { isActive: dsLevel >= 1, action: actionType, description: desc },
      adept:  { isActive: dsLevel >= 3, action: actionType, description: '' },
      master: { isActive: dsLevel >= 6, action: actionType, description: '' },
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

  return symbItem;
}

/**
 * Convert a DS attack ability into a Symbaroum weapon item.
 * DS weapons have tier-based damage; we map to a flat Symbaroum damage die.
 */
function convertWeapon(dsItem, dsCharacteristics, dsLevel) {
  const sys = dsItem.system || {};
  const desc = replaceTerms(sys.description?.value || sys.effect?.after || '');
  // Determine attribute: check power roll characteristics
  const powerChars = sys.power?.roll?.characteristics || ['might'];
  const primaryChar = powerChars[0]; // might, agility, reason, intuition, presence
  const symbAttr = DS_TO_SYMB_ATTR[primaryChar] || 'strong';

  // Map damage: DS tier 2/average damage → Symbaroum die
  const tier2Dmg = sys.power?.effects ? Object.values(sys.power.effects).find(e => e.type === 'damage')?.damage?.tier2?.value : null;
  const dmgValue = tier2Dmg ? parseInt(tier2Dmg, 10) : 2;

  // DS damage → Symbaroum base damage die
  let baseDamage = '1d6';
  if (dmgValue <= 2) baseDamage = '1d4';
  else if (dmgValue <= 4) baseDamage = '1d6';
  else if (dmgValue <= 7) baseDamage = '1d8';
  else if (dmgValue <= 11) baseDamage = '1d10';
  else baseDamage = '1d12';

  // Determine weapon type
  const keywords = sys.keywords || [];
  let reference = '1handed';
  if (keywords.includes('ranged')) reference = 'ranged';
  else if (dsItem.name?.toLowerCase().includes('claw') || dsItem.name?.toLowerCase().includes('bite')) reference = 'unarmed';
  else if (dsItem.name?.toLowerCase().includes('shield')) reference = 'shield';

  // Qualities from damage types
  const qualities = {};
  if (desc.toLowerCase().includes('cold') || desc.toLowerCase().includes('frost')) qualities.flaming = true; // re-use flaming for frost aesthetic
  if (desc.toLowerCase().includes('corrupt')) qualities.desecrated = true;
  if (desc.toLowerCase().includes('holy')) qualities.hallowed = true;
  if (desc.toLowerCase().includes('poison')) qualities.poison = true;

  const weaponItem = {
    _id: foundryId(`symb:weapon:${slugify(dsItem.name)}:${dsItem._id}`),
    name: dsItem.name || 'Natural Weapon',
    type: 'weapon',
    img: dsItem.img || 'icons/svg/sword.svg',
    system: {
      description: desc,
      attribute: symbAttr,
      reference: reference,
      baseDamage: baseDamage,
      bonusDamage: '',
      alternativeDamage: '',
      cost: '',
      number: 1,
      isArtifact: false,
      quality: '',
      qualities: qualities,
      bonus: buildBonusBlock(),
      power: {},
      marker: '',
      state: 'active',
    },
    effects: [],
    flags: {},
    sort: 0,
    ownership: { default: 0 },
    _stats: mkSymStats(),
  };

  return weaponItem;
}

// ── Symbaroum Health Block ────────────────────────────────────────────
function buildHealth(toughness, threshold, corruptionMax) {
  return {
    toughness: {
      value: toughness,
      max: toughness,
      threshold: threshold || Math.floor(toughness / 2),
    },
    corruption: {
      value: 0,
      max: corruptionMax || 0,
      threshold: 0,
    },
  };
}

// ── Symbaroum Bio Block ──────────────────────────────────────────────
function buildBio(race, occupation) {
  return {
    race: race || '',
    occupation: occupation || '',
    quote: '',
    shadow: '',
    manner: '',
  };
}

// ── Symbaroum Bonus Block (all zeros for monsters) ───────────────────
function buildBonusBlock() {
  return {
    defense: 0,
    accurate: 0,
    cunning: 0,
    discreet: 0,
    persuasive: 0,
    quick: 0,
    resolute: 0,
    strong: 0,
    vigilant: 0,
    toughness: { max: 0, threshold: 0 },
    corruption: { max: 0, threshold: 0 },
    experience: { value: 0, cost: 0 },
  };
}

// ── Symbaroum Armor Block (for embedded armor in monster) ────────────
function buildArmorBlock(baseProtection, qualities, impeding) {
  return {
    baseProtection: baseProtection || '0',
    bonusProtection: '',
    qualities: qualities || {},
    cost: '',
    state: 'other',
    impeding: impeding || 0,
  };
}

// ── Symbaroum Experience Block ───────────────────────────────────────
function buildExperienceBlock(dsLevel) {
  return {
    total: 0,
    artifactrr: 0,
    spent: 0,
    available: 0,
  };
}

// ── DS → Symbaroum Armor Value ───────────────────────────────────────
function dsArmorToProtection(dsArmorValue) {
  // DS armor values are typically 1-6; map to Symbaroum protection dice
  if (!dsArmorValue || dsArmorValue <= 0) return '0';
  if (dsArmorValue <= 1) return '1d4';
  if (dsArmorValue <= 2) return '1d6';
  if (dsArmorValue <= 4) return '1d8';
  return '1d10';
}

// ── Term Replacement for Symbaroum ────────────────────────────────────
// Rewrites Draw Steel / D&D terminology to Symbaroum equivalents.

const TERM_REPLACEMENTS = [
  // Health
  [/\bStamina\b/g, 'Toughness'],
  [/\bstamina\b/g, 'toughness'],
  [/\bHit Points?\b/g, 'Toughness'],
  [/\bhit points?\b/g, 'toughness'],
  [/\bHP\b/g, 'Toughness'],
  [/\bhp\b/g, 'toughness'],

  // Armor Class → Defense
  [/\bArmor Class\b/g, 'Defense'],
  [/\barmor class\b/g, 'defense'],
  [/\bAC\b/g, 'Defense'],

  // Saving Throw → Attribute Test
  [/\bSaving Throw\b/g, 'Attribute Test'],
  [/\bsaving throw\b/g, 'attribute test'],
  [/\bSTR save\b/g, 'Strong test'],
  [/\bDEX save\b/g, 'Quick test'],
  [/\bCON save\b/g, 'Strong test'],
  [/\bINT save\b/g, 'Cunning test'],
  [/\bWIS save\b/g, 'Vigilant test'],
  [/\bCHA save\b/g, 'Persuasive test'],
  [/\bDC\s+(\d+)\s+(\w+) saving throw\b/gi, 'Resolute test'],
  [/\bDC (\d+)\b/g, (m, dc) => `modified [Resolute←${dc}]`],

  // Skill checks
  [/\bSkill Check\b/g, 'Attribute Test'],
  [/\bskill check\b/g, 'attribute test'],
  [/\bAthletics\b/g, 'Strong'],
  [/\bAcrobatics\b/g, 'Quick'],
  [/\bStealth\b/g, 'Discreet'],
  [/\bSleight of Hand\b/g, 'Discreet'],
  [/\bArcana\b/g, 'Cunning'],
  [/\bHistory\b/g, 'Cunning'],
  [/\bInvestigation\b/g, 'Cunning'],
  [/\bNature\b/g, 'Cunning'],
  [/\bReligion\b/g, 'Cunning'],
  [/\bInsight\b/g, 'Vigilant'],
  [/\bMedicine\b/g, 'Cunning'],
  [/\bPerception\b/g, 'Vigilant'],
  [/\bSurvival\b/g, 'Vigilant'],
  [/\bDeception\b/g, 'Persuasive'],
  [/\bIntimidation\b/g, 'Persuasive'],
  [/\bPerformance\b/g, 'Persuasive'],
  [/\bPersuasion\b/g, 'Persuasive'],

  // Advantage/Disadvantage → Symbaroum terminology
  [/\bAdvantage\b/g, 'Second Chance (two rolls, take best)'],
  [/\badvantage\b/g, 'second chance (two rolls, take best)'],
  [/\bDisadvantage\b/g, 'Second Chance (two rolls, take worst)'],
  [/\bdisadvantage\b/g, 'second chance (two rolls, take worst)'],

  // Rest mechanics
  [/\bLong Rest\b/g, 'Extended Rest'],
  [/\blong rest\b/g, 'extended rest'],
  [/\bShort Rest\b/g, 'Rest'],
  [/\bshort rest\b/g, 'rest'],

  // Spellcasting
  [/\bSpell Slot\b/gi, 'Corruption threshold'],
  [/\bspell slots?\b/g, 'corruption threshold'],
  [/\bCantrip\b/gi, 'Mystical Power (Novice)'],
  [/\bcantrip\b/g, 'mystical power (novice)'],

  // Action economy
  [/\bBonus Action\b/g, 'Movement Action'],
  [/\bbonus action\b/g, 'movement action'],
  [/\bManeuver\b/g, 'Free Action'],
  [/\bmaneuver\b/g, 'free action'],
  [/\bOpportunity Attack\b/g, 'Free Attack'],
  [/\bopportunity attack\b/g, 'free attack'],
  [/\bReaction\b/g, 'Reaction'],
  [/\breaction\b/g, 'reaction'],

  // DS specific
  [/\bEdge\b(?! of)/g, 'Advantage (Second Chance)'],
  [/\bedge\b(?! of)/g, 'advantage (second chance)'],
  [/\bBane\b/g, 'Disadvantage (Second Chance)'],
  [/\bbane\b/g, 'disadvantage (second chance)'],
  [/\bFree Strike\b/gi, 'Free Attack'],
  [/\bfree strike\b/g, 'free attack'],
  [/\bHero Token\b/gi, 'Experience'],
  [/\bhero token\b/g, 'experience'],
  [/\bVictory Point\b/gi, 'Milestone'],
  [/\bvictory point\b/g, 'milestone'],
  [/\bVictories\b/g, 'Milestones'],
  [/\bvictories\b/g, 'milestones'],
  [/\bpower roll\b/gi, 'attribute test'],
  [/\bTier 1\b/g, 'weak effect'],
  [/\bTier 2\b/g, 'moderate effect'],
  [/\bTier 3\b/g, 'strong effect'],
  [/\bStability\b/g, 'Resistance'],
  [/\bstability\b/g, 'resistance'],
  [/\bsquares?\b/g, (m) => m === 'square' ? 'meters (2 m)' : 'meters'],

  // Recovery
  [/\bRecovery\b(?! value)/g, 'Recovery Test'],
  [/\brecovery\b(?! value)/g, 'recovery test'],
  [/\bRecoveries\b/g, 'Recovery Tests'],
  [/\brecoveries\b/g, 'recovery tests'],
  [/\bRespite\b/g, 'Extended Rest'],
  [/\brespite\b/g, 'extended rest'],

  // Damage types
  [/\bnecrotic\b/g, 'corruption'],
  [/\bradiant\b/g, 'hallowed'],
  [/\bthunder\b/g, 'force'],
  [/\bbludgeoning\b/g, 'blunt'],
  [/\bslashing\b/g, 'slashing'],
  [/\bpiercing\b/g, 'piercing'],
];

/**
 * Fix UTF-8 double-encoding (mojibake) — same as 5e version.
 */
function fixMojibake(text) {
  if (!text) return text;
  const CP1252_REVERSE = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
    0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
    0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
    0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
    0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
  };
  text = text.replace(/\u00e2\u0080\u0093/g, '\u2013');
  text = text.replace(/\u00e2\u0080\u0094/g, '\u2014');
  text = text.replace(/\u00e2\u0080\u0098/g, '\u2018');
  text = text.replace(/\u00e2\u0080\u0099/g, '\u2019');
  text = text.replace(/\u00e2\u0080\u009c/g, '\u201c');
  text = text.replace(/\u00e2\u0080\u009d/g, '\u201d');
  text = text.replace(/\u00e2\u20ac\u201c/g, '\u2013');
  text = text.replace(/\u00e2\u20ac\u201d/g, '\u2014');
  text = text.replace(/\u00e2\u20ac\u02dc/g, '\u2018');
  text = text.replace(/\u00e2\u20ac\u2122/g, '\u2019');
  text = text.replace(/\u00e2\u20ac\u0153/g, '\u201c');
  text = text.replace(/\u00e2\u20ac\u009d/g, '\u201d');
  text = text.replace(/\u00c5\u0093/g, '\u0153');
  text = text.replace(/\u00c3([\u0080-\u00bf])/g, (_, c) =>
    String.fromCharCode(0xc0 + (c.charCodeAt(0) - 0x80))
  );
  text = text.replace(/\u00c3(.)/g, (m, c) => {
    const byte = CP1252_REVERSE[c.charCodeAt(0)];
    if (byte !== undefined) return String.fromCharCode(0xc0 + (byte - 0x80));
    return m;
  });
  text = text.replace(/\u00c2([\u0080-\u00bf])/g, (_, c) =>
    String.fromCharCode(c.charCodeAt(0))
  );
  return text;
}

function replaceTerms(text) {
  if (!text) return text;
  text = fixMojibake(text);
  for (const [pat, rep] of TERM_REPLACEMENTS) {
    text = text.replace(pat, rep);
  }
  // Strip Draw Steel compendium links
  text = text.replace(/\[\[\/[^\]]*\]\]/g, '');
  text = text.replace(/@Embed\[[^\]]*\]/g, '');
  return text;
}

/**
 * Strip inline styles from HTML table elements.
 */
function stripTableStyles(html) {
  if (!html) return html;
  return html.replace(/<(table|thead|tbody|tr|th|td)\b([^>]*?)>/gi, (match, tag, attrs) => {
    const cleaned = attrs.replace(/\s*style="[^"]*"/gi, '');
    return `<${tag}${cleaned}>`;
  });
}

// ── Symbaroum _stats block ────────────────────────────────────────────
function mkSymStats() {
  return {
    compendiumSource: null,
    duplicateSource: null,
    exportSource: null,
    coreVersion: '13',
    systemId: 'symbaroum',
    systemVersion: null,
    createdTime: Date.now(),
    modifiedTime: null,
    lastModifiedBy: null,
  };
}

// ── Symbaroum prototypeToken ──────────────────────────────────────────
function mkPrototypeToken(name, img, disposition) {
  return {
    name: name,
    displayName: 20,
    actorLink: false,
    disposition: disposition || -1,
    width: 1,
    height: 1,
    texture: {
      src: img || '',
      anchorX: 0.5,
      anchorY: 0.5,
      offsetX: 0,
      offsetY: 0,
      fit: 'contain',
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      tint: '#ffffff',
      alphaThreshold: 0.75,
    },
    lockRotation: true,
    rotation: 0,
    alpha: 1,
    displayBars: 20,
    bar1: { attribute: 'health.toughness' },
    bar2: { attribute: 'health.corruption' },
    light: {
      negative: false, priority: 0, alpha: 0.5, angle: 360,
      bright: 0, color: null, coloration: 1, dim: 0,
      attenuation: 0.5, luminosity: 0.5, saturation: 0, contrast: 0, shadows: 0,
      animation: { type: null, speed: 5, intensity: 5, reverse: false },
      darkness: { min: 0, max: 1 },
    },
    sight: {
      enabled: false, range: 0, angle: 360, visionMode: 'basic',
      color: null, attenuation: 0.1, brightness: 0, saturation: 0, contrast: 0,
    },
    detectionModes: [],
    occludable: { radius: 0 },
    ring: { enabled: false, colors: { ring: null, background: null }, effects: 1, subject: { scale: 1, texture: null } },
    turnMarker: { mode: 1, animation: null, src: null, disposition: false },
    movementAction: null,
    flags: {},
    randomImg: false,
    appendNumber: false,
    prependAdjective: false,
  };
}

module.exports = {
  // IDs
  foundryId, slugify, base62FromBuffer,
  // Attribute mapping
  DS_TO_SYMB_ATTR, dsCharToSymbValue, buildAttributes,
  // Health
  convertToughness, buildHealth,
  // Size & movement
  mapSize, convertMovement,
  // Traits
  mapTraits, KEYWORD_TO_TRAITS,
  // Damage types
  DAMAGE_TYPE_FLAVOR,
  // Item conversion
  convertAbility, convertWeapon,
  DS_CATEGORY_TO_ACTION,
  // Armor
  dsArmorToProtection, buildArmorBlock,
  // Bio & bonus blocks
  buildBio, buildBonusBlock, buildExperienceBlock,
  // Term replacement
  replaceTerms, fixMojibake, stripTableStyles, TERM_REPLACEMENTS,
  // Stats & token
  mkSymStats, mkPrototypeToken,
};

#!/usr/bin/env node
/**
 * shared.js — Shared utilities for DS → Symbaroum conversion scripts.
 *
 * ALL trait and ability references MUST be valid Symbaroum canon keys
 * as defined in symbaroum/script/common/config.js.
 */
const crypto = require('node:crypto');

// ── Deterministic ID helpers ──────────────────────────────────────
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function base62FromBuffer(buf, length) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex'));
  const base = BigInt(B62.length);
  let out = '';
  while (n > 0n) { out = B62[Number(n % base)] + out; n /= base; }
  if (out.length < length) out = out.padStart(length, '0');
  if (out.length > length) out = out.slice(0, length);
  return out;
}
function foundryId(seed) {
  const digest = crypto.createHash('sha1').update(String(seed)).digest();
  return base62FromBuffer(digest.subarray(0, 12), 16);
}
function slugify(input) {
  return input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[øØ]/g,'o').replace(/[æÆ]/g,'ae').replace(/[ðÐ]/g,'d')
    .replace(/[þÞ]/g,'th').toLowerCase().replace(/['']/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/-+/g,'-').replace(/(^-|-$)/g,'');
}

// ── DS → Symbaroum Attribute Mapping ────────────────────────────
const DS_TO_SYMB_ATTR = {
  might:'strong', agility:'quick', reason:'cunning',
  intuition:'vigilant', presence:'persuasive',
};
function dsCharToSymbValue(dsValue) {
  return Math.max(5, Math.min(18, Math.round(10 + (dsValue * 1.5))));
}
function buildAttributes(dsCharacteristics) {
  const attrs = {};
  for (const [dsKey, symKey] of Object.entries(DS_TO_SYMB_ATTR)) {
    const val = dsCharacteristics?.[dsKey]?.value ?? 0;
    attrs[symKey] = { value: dsCharToSymbValue(val), bonus: 0, total: 0, modifier: 0, temporaryMod: 0 };
  }
  const sv = attrs.strong?.value||10, qv=attrs.quick?.value||10;
  const cv=attrs.cunning?.value||10, pv=attrs.persuasive?.value||10;
  attrs.accurate = { value: Math.round((sv+qv)/2), bonus:0, total:0, modifier:0, temporaryMod:0 };
  attrs.discreet = { value: 10, bonus:0, total:0, modifier:0, temporaryMod:0 };
  attrs.resolute = { value: Math.round((cv+pv)/2), bonus:0, total:0, modifier:0, temporaryMod:0 };
  for (const key of Object.keys(attrs)) {
    attrs[key].total = attrs[key].value + attrs[key].bonus + attrs[key].temporaryMod;
    attrs[key].modifier = 10 - attrs[key].total;
  }
  return attrs;
}

// ── Health ──────────────────────────────────────────────────────
function convertToughness(dsStamina, dsOrg) {
  const mult = { minion:1.0, horde:1.2, platoon:1.5, elite:2.0, leader:2.5, solo:3.5 }[dsOrg] || 1.5;
  const t = Math.max(5, Math.min(40, Math.round((dsStamina||10) * mult)));
  return {
    toughness: { value:t, max:t, threshold:Math.floor(t/2) },
    corruption: { value:0, max:0, threshold:0 },
  };
}

// ── Size ────────────────────────────────────────────────────────
function mapSize(dsSize) {
  if (!dsSize) return 'medium';
  const l = (dsSize.letter||'M').toUpperCase();
  if (l==='T') return 'tiny'; if (l==='S') return 'small'; if (l==='M') return 'medium';
  if (l==='L') return 'large'; if (l==='H') return 'huge'; if (l==='G') return 'gargantuan';
  const v = dsSize.value||1;
  if (v<=0.5) return 'tiny'; if (v<=1) return 'medium'; if (v<=2) return 'large';
  if (v<=3) return 'huge'; return 'gargantuan';
}
function convertMovement(dsMovement) {
  const types = dsMovement?.types || ['walk'];
  const speed = dsMovement?.value || 5;
  const m = [];
  for (const t of types) {
    switch(t) {
      case 'walk': m.push(`Movement: ${speed*2}`); break;
      case 'climb': m.push(`Climbing: ${speed*2}`); break;
      case 'swim': m.push(`Swimming: ${speed*2}`); break;
      case 'fly': m.push(`Flying: ${speed*3}`); break;
      case 'burrow': m.push(`Burrowing: ${speed}`); break;
      default: m.push(`${t}: ${speed*2}`);
    }
  }
  return m.join(', ');
}

// ── CANON Symbaroum Trait Mapping ───────────────────────────────
// ONLY use reference keys that exist in symbaroum config.js traitsList.
// Any trait NOT on this list will be silently skipped.

const CANON_TRAITS = new Set([
  'acidicattack','acidicblood','alternativedamage','amphibian','armored',
  'avengingsuccessor','bloodlust','carapace','collectivepower','colossal',
  'companions','corruptingattack','corruptionhoarder','corruptionsensitive',
  'crushingembrace','deadlybreath','deathstruggle','devour','diminutive',
  'enthrall','earthbound','freespirit','grapplingtongue','gravelycold',
  'harmfulaura','haunting','infectious','infestation','invisibility',
  'leap','lifesense','manifestation','many-headed','metamorphosis',
  'mysticalresistance','naturalweapon','nightperception','observant',
  'paralyzingvenom','piercingattack','poisonous','poisonspit',
  'prehensileclaws','rampage','regeneration','robust','rootwall',
  'shapeshifter','spiritform','sturdy','summoner','survivalinstinct',
  'swarm','swift','terrify','tunneler','undead','web','wings',
  'wisdomages','wrecker',
]);

// DS keyword → canon Symbaroum trait reference(s)
const KEYWORD_TO_TRAIT = {
  undead:    ['undead','gravelycold'],
  construct: ['armored','robust'],
  beast:     ['naturalweapon','survivalinstinct'],
  plant:     ['regeneration','rootwall'],
  fey:       ['spiritform','freespirit'],
  elemental: ['alternativedamage','deadlybreath'],
  swarm:     ['swarm','diminutive'],
  ooze:      ['acidicblood','corruptingattack'],
  giant:     ['colossal','robust','wrecker'],
  demon:     ['corruptingattack','terrify','harmfulaura'],
  dragon:    ['colossal','deadlybreath','terrify','wings'],
};

function getCanonTraits(dsKeywords) {
  const traits = new Set();
  if (!dsKeywords) return [];
  for (const kw of dsKeywords) {
    const mapped = KEYWORD_TO_TRAIT[kw.toLowerCase()];
    if (mapped) mapped.forEach(t => traits.add(t));
  }
  return [...traits];
}

// ── Build a canon trait item ──────────────────────────────────
function buildTraitItem(referenceKey, level) {
  return {
    _id: foundryId(`symb:trait:${referenceKey}`),
    name: referenceKey.charAt(0).toUpperCase() + referenceKey.slice(1),
    type: 'trait',
    img: 'systems/symbaroum/asset/image/trait.png',
    system: {
      description: '',
      reference: referenceKey,
      novice:  { isActive: level >= 1, action: 'P', description: '' },
      adept:   { isActive: level >= 2, action: 'P', description: '' },
      master:  { isActive: level >= 3, action: 'P', description: '' },
      bonus: buildBonusBlock(),
      isArtifact: false, power: {}, qualities: {}, marker: '', state: 'active',
    },
    effects: [], flags: {}, sort: 0, ownership: { default: 0 },
    _stats: mkSymStats(),
  };
}

// ── Build a canon ability item ────────────────────────────────
function buildAbilityItem(referenceKey, level, actionType) {
  return {
    _id: foundryId(`symb:ability:${referenceKey}`),
    name: referenceKey.charAt(0).toUpperCase() + referenceKey.slice(1).replace(/([A-Z])/g,' $1'),
    type: 'ability',
    img: `systems/symbaroum/asset/image/ability.png`,
    system: {
      description: '',
      reference: referenceKey,
      novice:  { isActive: level >= 1, action: actionType || 'A', description: '' },
      adept:   { isActive: level >= 3, action: actionType || 'A', description: '' },
      master:  { isActive: level >= 6, action: actionType || 'A', description: '' },
      bonus: buildBonusBlock(),
      isArtifact: false, power: {}, qualities: {}, marker: '', state: 'active',
    },
    effects: [], flags: {}, sort: 0, ownership: { default: 0 },
    _stats: mkSymStats(),
  };
}

// ── DS Role → canon Symbaroum ability ─────────────────────────
// Map monster roles to canon abilities that make thematic sense
const ROLE_TO_ABILITY = {
  defender:  ['bodyguard','shieldfighter'],
  brute:     ['featofstrength','twohandedforce'],
  artillery: ['marksman','rapidfire'],
  controller:['dominate','ensnare'],
  sniper:    ['backstab','huntersinstinct'],
  support:   ['leader','medicus'],
};

function getCanonAbilities(dsRole, dsLevel) {
  const abilities = ROLE_TO_ABILITY[dsRole] || [];
  const result = [];
  for (const ref of abilities) {
    result.push({ reference: ref, level: dsLevel >= 5 ? 2 : 1 });
  }
  return result;
}

// ── DS attack → Symbaroum weapon ──────────────────────────────
function buildMonsterWeapon(dsItem, dsCharacteristics, dsLevel) {
  const sys = dsItem.system || {};
  const powerChars = sys.power?.roll?.characteristics || ['might'];
  const symbAttr = DS_TO_SYMB_ATTR[powerChars[0]] || 'strong';

  const tier2Dmg = sys.power?.effects
    ? Object.values(sys.power.effects).find(e => e.type === 'damage')?.damage?.tier2?.value
    : null;
  const dmg = tier2Dmg ? parseInt(tier2Dmg, 10) : 2;

  let baseDamage = '1d6';
  if (dmg <= 2) baseDamage = '1d4';
  else if (dmg <= 4) baseDamage = '1d6';
  else if (dmg <= 7) baseDamage = '1d8';
  else if (dmg <= 11) baseDamage = '1d10';
  else baseDamage = '1d12';

  const name = (dsItem.name || 'Claw').toLowerCase();
  const keywords = sys.keywords || [];
  let reference = 'unarmed';
  if (keywords.includes('ranged')) reference = 'ranged';
  else if (name.includes('sword') || name.includes('axe') || name.includes('blade')) reference = '1handed';
  else if (name.includes('shield')) reference = 'shield';

  const qualities = {};
  const desc = replaceTerms(sys.description?.value || sys.effect?.after || '');
  if (desc.toLowerCase().includes('cold') || desc.toLowerCase().includes('frost')) qualities.flaming = true;
  if (desc.toLowerCase().includes('corrupt')) qualities.desecrated = true;
  if (desc.toLowerCase().includes('holy') || desc.toLowerCase().includes('hallowed')) qualities.hallowed = true;
  if (desc.toLowerCase().includes('poison') || desc.toLowerCase().includes('venom')) qualities.poison = true;

  return {
    _id: foundryId(`symb:weapon:${slugify(dsItem.name||'claw')}:${dsItem._id}`),
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
      cost: '', number: 1, isArtifact: false, quality: '',
      qualities: qualities,
      bonus: buildBonusBlock(),
      power: {}, marker: '', state: 'active',
    },
    effects: [], flags: {}, sort: 0, ownership: { default: 0 },
    _stats: mkSymStats(),
  };
}

// ── Collect monster special abilities as DESCRIPTION text ─────
function collectMonsterAbilitiesDescription(dsItems) {
  if (!dsItems || !dsItems.length) return '';
  const parts = [];
  for (const item of dsItems) {
    const sys = item.system || {};
    const category = sys.category || '';
    // Skip signature attacks (they become weapons)
    if (category === 'signature') continue;
    const name = item.name || 'Special';
    const desc = replaceTerms(sys.description?.value || sys.effect?.after || sys.effect?.before || '');
    if (desc.trim()) {
      parts.push(`<p><strong>${name}:</strong> ${desc}</p>`);
    }
  }
  return parts.join('\n');
}

// ── Blocks ────────────────────────────────────────────────────
function buildBonusBlock() {
  return {
    defense:0, accurate:0, cunning:0, discreet:0, persuasive:0,
    quick:0, resolute:0, strong:0, vigilant:0,
    toughness:{ max:0, threshold:0 }, corruption:{ max:0, threshold:0 },
    experience:{ value:0, cost:0 },
  };
}
function buildBio(race, occupation) {
  return { race: race||'', occupation: occupation||'', quote: '', shadow: '', manner: '' };
}
function buildExperienceBlock() {
  return { total:0, artifactrr:0, spent:0, available:0 };
}

// ── Term replacement ──────────────────────────────────────────
const TERM_REPLACEMENTS = [
  [/\bStamina\b/g,'Toughness'],[/\bstamina\b/g,'toughness'],
  [/\bHit Points?\b/g,'Toughness'],[/\bhit points?\b/g,'toughness'],
  [/\bHP\b/g,'Toughness'],[/\bhp\b/g,'toughness'],
  [/\bArmor Class\b/g,'Defense'],[/\barmor class\b/g,'defense'],[/\bAC\b/g,'Defense'],
  [/\bSaving Throw\b/g,'Attribute Test'],[/\bsaving throw\b/g,'attribute test'],
  [/\bSTR save\b/g,'Strong test'],[/\bDEX save\b/g,'Quick test'],
  [/\bCON save\b/g,'Strong test'],[/\bINT save\b/g,'Cunning test'],
  [/\bWIS save\b/g,'Vigilant test'],[/\bCHA save\b/g,'Persuasive test'],
  [/\bDC (\d+)\b/g, (_,dc)=>`modified Resolute←${dc}`],
  [/\bSkill Check\b/g,'Attribute Test'],[/\bskill check\b/g,'attribute test'],
  [/\bAthletics\b/g,'Strong'],[/\bAcrobatics\b/g,'Quick'],[/\bStealth\b/g,'Discreet'],
  [/\bArcana\b/g,'Cunning'],[/\bHistory\b/g,'Cunning'],[/\bInvestigation\b/g,'Cunning'],
  [/\bNature\b/g,'Cunning'],[/\bReligion\b/g,'Cunning'],
  [/\bInsight\b/g,'Vigilant'],[/\bMedicine\b/g,'Cunning'],
  [/\bPerception\b/g,'Vigilant'],[/\bSurvival\b/g,'Vigilant'],
  [/\bDeception\b/g,'Persuasive'],[/\bIntimidation\b/g,'Persuasive'],
  [/\bPerformance\b/g,'Persuasive'],[/\bPersuasion\b/g,'Persuasive'],
  [/\bAdvantage\b/g,'Second Chance (best of two)'],[/\badvantage\b/g,'second chance (best of two)'],
  [/\bDisadvantage\b/g,'Second Chance (worst of two)'],[/\bdisadvantage\b/g,'second chance (worst of two)'],
  [/\bLong Rest\b/g,'Extended Rest'],[/\blong rest\b/g,'extended rest'],
  [/\bShort Rest\b/g,'Rest'],[/\bshort rest\b/g,'rest'],
  [/\bSpell Slot\b/gi,'Corruption threshold'],[/\bspell slots?\b/g,'corruption threshold'],
  [/\bBonus Action\b/g,'Movement Action'],[/\bbonus action\b/g,'movement action'],
  [/\bManeuver\b/g,'Free Action'],[/\bmaneuver\b/g,'free action'],
  [/\bOpportunity Attack\b/g,'Free Attack'],[/\bopportunity attack\b/g,'free attack'],
  [/\bEdge\b(?! of)/g,'Advantage (Second Chance)'],[/\bedges?\b/g,'advantage (second chance)'],
  [/\bBane\b/g,'Disadvantage (Second Chance)'],[/\bbane\b/g,'disadvantage (second chance)'],
  [/\bFree Strike\b/gi,'Free Attack'],[/\bfree strike\b/g,'free attack'],
  [/\bHero Token\b/gi,'Experience'],[/\bhero token\b/g,'experience'],
  [/\bVictory Point\b/gi,'Milestone'],[/\bvictory point\b/g,'milestone'],
  [/\bVictories\b/g,'Milestones'],[/\bvictories\b/g,'milestones'],
  [/\bpower roll\b/gi,'attribute test'],
  [/\bTier 1\b/g,'weak effect'],[/\bTier 2\b/g,'moderate effect'],[/\bTier 3\b/g,'strong effect'],
  [/\bStability\b/g,'Resistance'],[/\bstability\b/g,'resistance'],
  [/\bsquares?\b/g, m => m==='square'?'meters (2 m)':'meters'],
  [/\bRecovery\b(?! value)/g,'Recovery Test'],[/\brecovery\b(?! value)/g,'recovery test'],
  [/\bRecoveries\b/g,'Recovery Tests'],[/\brecoveries\b/g,'recovery tests'],
  [/\bRespite\b/g,'Extended Rest'],[/\brespite\b/g,'extended rest'],
  [/\bnecrotic\b/g,'corruption'],[/\bradiant\b/g,'hallowed'],[/\bthunder\b/g,'force'],
  [/\bbludgeoning\b/g,'blunt'],[/\bslashing\b/g,'slashing'],[/\bpiercing\b/g,'piercing'],
  [/\bencounter\b/g,'scene'],[/\bEncounter\b/g,'Scene'],
  [/\bproficiency bonus\b/gi,'attribute modifier'],
  [/\b1st[-\s]level\b/gi,'Novice'],[/\b2nd[-\s]level\b/gi,'Novice'],
  [/\b3rd[-\s]level\b/gi,'Adept'],[/\b4th[-\s]level\b/gi,'Adept'],
  [/\b5th[-\s]level\b/gi,'Master'],
  [/\bper long rest\b/gi,'per extended rest'],[/\bper short rest\b/gi,'per rest'],
  [/\bper day\b/gi,'per extended rest'],
];

function fixMojibake(text) {
  if (!text) return text;
  const CP1252_REVERSE = {
    0x20ac:0x80,0x201a:0x82,0x0192:0x83,0x201e:0x84,
    0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02c6:0x88,
    0x2030:0x89,0x0160:0x8a,0x2039:0x8b,0x0152:0x8c,
    0x017d:0x8e,0x2018:0x91,0x2019:0x92,0x201c:0x93,
    0x201d:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,
    0x02dc:0x98,0x2122:0x99,0x0161:0x9a,0x203a:0x9b,
    0x0153:0x9c,0x017e:0x9e,0x0178:0x9f,
  };
  text = text.replace(/\u00e2\u0080[\u0093\u0094\u0098\u0099\u009c\u009d]/g, m => {
    const map = {'\u0093':'\u2013','\u0094':'\u2014','\u0098':'\u2018','\u0099':'\u2019','\u009c':'\u201c','\u009d':'\u201d'};
    return map[m[2]] || m;
  });
  text = text.replace(/\u00e2\u20ac[\u201c\u201d\u02dc\u2122\u0153\u009d]/g, m => {
    const map = {'\u201c':'\u2013','\u201d':'\u2014','\u02dc':'\u2018','\u2122':'\u2019','\u0153':'\u201c','\u009d':'\u201d'};
    return map[m[2]] || m;
  });
  text = text.replace(/\u00c5\u0093/g, '\u0153');
  text = text.replace(/\u00c3([\u0080-\u00bf])/g, (_,c) => String.fromCharCode(0xc0+(c.charCodeAt(0)-0x80)));
  text = text.replace(/\u00c3(.)/g, (m,c) => {
    const b = CP1252_REVERSE[c.charCodeAt(0)];
    return b !== undefined ? String.fromCharCode(0xc0+(b-0x80)) : m;
  });
  text = text.replace(/\u00c2([\u0080-\u00bf])/g, (_,c) => String.fromCharCode(c.charCodeAt(0)));
  return text;
}
function replaceTerms(text) {
  if (!text) return text;
  text = fixMojibake(text);
  for (const [pat, rep] of TERM_REPLACEMENTS) text = text.replace(pat, rep);
  text = text.replace(/\[\[\/[^\]]*\]\]/g, '');
  text = text.replace(/@Embed\[[^\]]*\]/g, '');
  return text;
}
function stripTableStyles(html) {
  if (!html) return html;
  return html.replace(/<(table|thead|tbody|tr|th|td)\b([^>]*?)>/gi, (_,tag,attrs) => {
    const cleaned = attrs.replace(/\s*style="[^"]*"/gi, '');
    return `<${tag}${cleaned}>`;
  });
}

// ── Stats & token ─────────────────────────────────────────────
function mkSymStats() {
  return {
    compendiumSource: null, duplicateSource: null, exportSource: null,
    coreVersion: '13', systemId: 'symbaroum', systemVersion: null,
    createdTime: Date.now(), modifiedTime: null, lastModifiedBy: null,
  };
}
function mkPrototypeToken(name, img, disposition) {
  return {
    name, displayName:20, actorLink:false, disposition: disposition ?? -1,
    width:1, height:1,
    texture: { src: img||'', anchorX:0.5, anchorY:0.5, offsetX:0, offsetY:0,
      fit:'contain', scaleX:1, scaleY:1, rotation:0, tint:'#ffffff', alphaThreshold:0.75 },
    lockRotation:true, rotation:0, alpha:1, displayBars:20,
    bar1:{ attribute:'health.toughness' }, bar2:{ attribute:'health.corruption' },
    light:{ negative:false, priority:0, alpha:0.5, angle:360, bright:0, color:null,
      coloration:1, dim:0, attenuation:0.5, luminosity:0.5, saturation:0, contrast:0, shadows:0,
      animation:{ type:null, speed:5, intensity:5, reverse:false }, darkness:{ min:0, max:1 } },
    sight:{ enabled:false, range:0, angle:360, visionMode:'basic', color:null,
      attenuation:0.1, brightness:0, saturation:0, contrast:0 },
    detectionModes:[], occludable:{ radius:0 },
    ring:{ enabled:false, colors:{ ring:null, background:null }, effects:1, subject:{ scale:1, texture:null } },
    turnMarker:{ mode:1, animation:null, src:null, disposition:false },
    movementAction:null, flags:{}, randomImg:false, appendNumber:false, prependAdjective:false,
  };
}

module.exports = {
  foundryId, slugify,
  DS_TO_SYMB_ATTR, dsCharToSymbValue, buildAttributes,
  convertToughness, mapSize, convertMovement,
  CANON_TRAITS, KEYWORD_TO_TRAIT, getCanonTraits,
  ROLE_TO_ABILITY, getCanonAbilities,
  buildTraitItem, buildAbilityItem, buildMonsterWeapon,
  collectMonsterAbilitiesDescription,
  buildBonusBlock, buildBio, buildExperienceBlock,
  replaceTerms, fixMojibake, stripTableStyles,
  mkSymStats, mkPrototypeToken,
};

# Sveilheim: Era of Embers (Symbaroum)

A Foundry VTT module adapting the complete **Era of Embers** campaign from Draw Steel to the **Symbaroum RPG system**.

## Contents

| Pack | Count | Description |
|------|-------|-------------|
| Monsters | 58 | Draugr, Pale Maw, corrupted beasts, Grafvitnir boss stages |
| NPCs | 25 | Söldís, Kaelen, Lew, Gragnir, Harald, and more |
| Items & Artifacts | 25 | Frost-Etched Barrow-Blade, Yggdrasil Sap-Amber Pendant, etc. |
| World Lore | 9 | Gazetteer, pantheon, calendar, languages, ancestry guide |
| Act 1 Journals | 2 | Beats 1–9: The Gathering (director + player) |
| Act 2 Journals | 3 | Beats 10–19: The Northern Road |
| Act 3 Journals | 2 | Beats 20–27: The Burning |
| Challenge Scenes & Social Encounters | 33 | Converted from Draw Steel montage tests & negotiations |

**Total: 157 documents across 8 compendium packs.**

## System Requirements

- **Foundry VTT**: Version 13 or later
- **Symbaroum System**: Version 6.0.0 or later

## Installation

1. Copy the `module/` directory to your Foundry VTT `Data/modules/svellheim-symbaroum/` folder
2. Enable the module in your Symbaroum world
3. Access all content through the Compendium tab

## Building from Source

```bash
npm install
npm run convert:all   # Convert all Draw Steel / 5e data to Symbaroum format
npm run build         # Compile LevelDB packs
npm run full          # Both steps
```

### Conversion Pipeline

```
Svellheim-Entities (Draw Steel)
    │
    ├── convert-monsters.js  →  data/monsters/   (Symbaroum Actor JSON)
    ├── convert-npcs.js      →  data/npcs/       (Symbaroum Actor JSON)
    ├── convert-items.js     →  data/items/      (Symbaroum Item JSON)
    │
sveilheim-5e (5e journals)
    │
    └── convert-journals.js  →  data/journals/   (Symbaroum Journal JSON)
                                   │
                            build-packs.js
                                   │
                            module/packs/   (LevelDB compendiums)
```

## Conversion Notes

### Attribute Mapping (Draw Steel → Symbaroum)

| Draw Steel (−3 to +5) | Symbaroum (5–15) |
|------------------------|-------------------|
| Might | **Strong** |
| Agility | **Quick** |
| Reason | **Cunning** |
| Intuition | **Vigilant** |
| Presence | **Persuasive** |
| *(derived)* | **Accurate** = (Strong + Quick) / 2 |
| *(derived)* | **Resolute** = (Cunning + Persuasive) / 2 |
| *(derived)* | **Discreet** = 10 (base) |

### Health Conversion

- **Toughness** = DS Stamina × organization multiplier (1.0 for minions, up to 3.5 for solos)
- **Pain Threshold** = Toughness ÷ 2
- **Corruption** = 0 (baseline), with corruption traits for undead/corrupted creatures

### Monster Traits

DS creature keywords map to Symbaroum's fixed trait system:
- `undead` → Undead, Gravely Cold
- `construct` → Armored, Robust
- `beast` → Natural Weapon
- `plant` → Regeneration, Root Wall
- `swarm` → Swarm, Diminutive

### Terminology Rewrites

All journal content has been rewritten to use Symbaroum terminology:

| Original (D&D 5e) | Symbaroum |
|--------------------|-----------|
| Hit Points (HP) | Toughness |
| Armor Class (AC) | Defense |
| Saving Throw | Attribute Test |
| Skill Check | Attribute Test |
| Advantage/Disadvantage | Second Chance |
| Long Rest / Short Rest | Extended Rest / Rest |
| Spell Slot | Corruption Threshold |
| Magic Item | Artifact |
| Challenge Rating | Threat Level |
| Encounter | Scene |

### Damage & Weapon Qualities

Weapon qualities are inferred from item descriptions:
- Frost/cold descriptions → Flaming quality
- Corruption/dark descriptions → Desecrated quality
- Holy/blessed descriptions → Hallowed quality
- Poison/venom → Poison quality
- Rune/magic → Mystical quality

## License

This module contains campaign content for the Era of Embers setting. The Symbaroum system is by Free League Publishing.

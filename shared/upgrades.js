const CORE_UPGRADE_COSTS = Object.freeze([
  Object.freeze({ ore: 12 }),
  Object.freeze({ ore: 26, diamond: 1 }),
  Object.freeze({ ore: 45, diamond: 2 }),
  Object.freeze({ ore: 70, diamond: 3 }),
  Object.freeze({ ore: 100, diamond: 4 })
]);

export const UPGRADE_DEFINITIONS = Object.freeze([
  {
    id: "speed",
    label: "SPEED",
    code: "SPEED",
    maxLevel: 5,
    description: "SHIP THRUST AND TOP SPEED",
    baseStatText: "100% THRUST / 100% SPEED",
    visual: "Longer shared thruster plume.",
    levels: Object.freeze([
      {
        cost: CORE_UPGRADE_COSTS[0],
        effectText: "+45% THRUST / +32% SPEED",
        effects: { thrustMultiplier: 1.45, maxSpeedMultiplier: 1.32, thrusterParticleMultiplier: 1.35 }
      },
      {
        cost: CORE_UPGRADE_COSTS[1],
        effectText: "+75% THRUST / +58% SPEED",
        effects: { thrustMultiplier: 1.75, maxSpeedMultiplier: 1.58, thrusterParticleMultiplier: 1.55 }
      },
      {
        cost: CORE_UPGRADE_COSTS[2],
        effectText: "+105% THRUST / +82% SPEED",
        effects: { thrustMultiplier: 2.05, maxSpeedMultiplier: 1.82, thrusterParticleMultiplier: 1.75 }
      },
      {
        cost: CORE_UPGRADE_COSTS[3],
        effectText: "+135% THRUST / +105% SPEED",
        effects: { thrustMultiplier: 2.35, maxSpeedMultiplier: 2.05, thrusterParticleMultiplier: 1.95 }
      },
      {
        cost: CORE_UPGRADE_COSTS[4],
        effectText: "+170% THRUST / +128% SPEED",
        effects: { thrustMultiplier: 2.7, maxSpeedMultiplier: 2.28, thrusterParticleMultiplier: 2.2 }
      }
    ])
  },
  {
    id: "range",
    label: "RANGE",
    code: "RANGE",
    maxLevel: 5,
    description: "MINING RAY REACHES FARTHER",
    baseStatText: "100% RAY RANGE",
    visual: "Mining ray endpoint reaches farther.",
    levels: Object.freeze([
      { cost: CORE_UPGRADE_COSTS[0], effectText: "+25% RAY RANGE", effects: { rayLengthBonus: 7 } },
      { cost: CORE_UPGRADE_COSTS[1], effectText: "+61% RAY RANGE", effects: { rayLengthBonus: 17 } },
      { cost: CORE_UPGRADE_COSTS[2], effectText: "+100% RAY RANGE", effects: { rayLengthBonus: 28 } },
      { cost: CORE_UPGRADE_COSTS[3], effectText: "+150% RAY RANGE", effects: { rayLengthBonus: 42 } },
      { cost: CORE_UPGRADE_COSTS[4], effectText: "+221% RAY RANGE", effects: { rayLengthBonus: 62 } }
    ])
  },
  {
    id: "power",
    label: "POWER",
    code: "POWER",
    maxLevel: 5,
    description: "FASTER MINING AND MORE DAMAGE",
    baseStatText: "100% RAY POWER",
    visual: "Mining ray rotates faster and hits harder.",
    levels: Object.freeze([
      {
        cost: CORE_UPGRADE_COSTS[0],
        effectText: "+30% RAY POWER",
        effects: {
          miningPowerMultiplier: 1.3,
          rayDamageMultiplier: 1.3,
          raySpinMultiplier: 1.32,
          miningParticleMultiplier: 1.18
        }
      },
      {
        cost: CORE_UPGRADE_COSTS[1],
        effectText: "+70% RAY POWER",
        effects: {
          miningPowerMultiplier: 1.7,
          rayDamageMultiplier: 1.7,
          raySpinMultiplier: 1.72,
          miningParticleMultiplier: 1.36
        }
      },
      {
        cost: CORE_UPGRADE_COSTS[2],
        effectText: "+125% RAY POWER",
        effects: {
          miningPowerMultiplier: 2.25,
          rayDamageMultiplier: 2.25,
          raySpinMultiplier: 2.2,
          miningParticleMultiplier: 1.58
        }
      },
      {
        cost: CORE_UPGRADE_COSTS[3],
        effectText: "+200% RAY POWER",
        effects: {
          miningPowerMultiplier: 3,
          rayDamageMultiplier: 3,
          raySpinMultiplier: 2.8,
          miningParticleMultiplier: 1.82
        }
      },
      {
        cost: CORE_UPGRADE_COSTS[4],
        effectText: "+300% RAY POWER",
        effects: {
          miningPowerMultiplier: 4,
          rayDamageMultiplier: 4,
          raySpinMultiplier: 3.6,
          miningParticleMultiplier: 2.15
        }
      }
    ])
  },
  {
    id: "health",
    label: "HEALTH",
    code: "HEALTH",
    maxLevel: 4,
    description: "ADDS ANOTHER HP BAR",
    baseStatText: "3 HP BARS",
    visual: "HUD health bar count increases up to seven.",
    levels: Object.freeze([
      { cost: CORE_UPGRADE_COSTS[1], effectText: "4 HP BARS", effects: { healthBarsBonus: 1 } },
      { cost: CORE_UPGRADE_COSTS[2], effectText: "5 HP BARS", effects: { healthBarsBonus: 2 } },
      { cost: CORE_UPGRADE_COSTS[3], effectText: "6 HP BARS", effects: { healthBarsBonus: 3 } },
      { cost: CORE_UPGRADE_COSTS[4], effectText: "7 HP BARS", effects: { healthBarsBonus: 4 } }
    ])
  },
  {
    id: "repair",
    label: "REPAIR",
    code: "REPAIR",
    maxLevel: 4,
    description: "SLOW HP REGEN AFTER DAMAGE",
    baseStatText: "NO REPAIR",
    visual: "Health returns slowly after a quiet window.",
    levels: Object.freeze([
      { cost: CORE_UPGRADE_COSTS[1], effectText: "1 HP BAR PER 60S AFTER 5S", effects: { healthRechargePerSecond: 100 / 60 } },
      { cost: CORE_UPGRADE_COSTS[2], effectText: "1 HP BAR PER 30S AFTER 5S", effects: { healthRechargePerSecond: 100 / 30 } },
      { cost: CORE_UPGRADE_COSTS[3], effectText: "1 HP BAR PER 20S AFTER 5S", effects: { healthRechargePerSecond: 5 } },
      { cost: CORE_UPGRADE_COSTS[4], effectText: "1 HP BAR PER 15S AFTER 5S", effects: { healthRechargePerSecond: 100 / 15 } }
    ])
  }
]);

const UPGRADE_IDS = new Set(UPGRADE_DEFINITIONS.map((upgrade) => upgrade.id));
const DEFAULT_EFFECTS = Object.freeze({
  thrustMultiplier: 1,
  maxSpeedMultiplier: 1,
  dragMultiplier: 1,
  rayLengthBonus: 0,
  miningPowerMultiplier: 1,
  rayDamageMultiplier: 1,
  raySpinMultiplier: 1,
  miningParticleMultiplier: 1,
  thrusterParticleMultiplier: 1,
  healthBarsBonus: 0,
  healthRechargePerSecond: 0,
  damageTakenMultiplier: 1
});

export function createUpgradeState() {
  const upgrades = {};

  for (const definition of UPGRADE_DEFINITIONS) {
    upgrades[definition.id] = 0;
  }

  return upgrades;
}

export function sanitizeUpgradeState(upgrades) {
  const sanitized = createUpgradeState();

  for (const definition of UPGRADE_DEFINITIONS) {
    sanitized[definition.id] = upgradeLevel(upgrades, definition.id);
  }

  return sanitized;
}

export function upgradeDefinitionById(upgradeId) {
  return UPGRADE_DEFINITIONS.find((definition) => definition.id === upgradeId) || null;
}

export function upgradeLevel(upgrades, upgradeId) {
  if (!UPGRADE_IDS.has(upgradeId)) {
    return 0;
  }

  const definition = upgradeDefinitionById(upgradeId);
  const value = Number(upgrades?.[upgradeId] ?? 0);
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(definition.maxLevel, Math.floor(value)));
}

export function nextUpgradeCost(upgrades, upgradeId) {
  const definition = upgradeDefinitionById(upgradeId);
  if (!definition) {
    return null;
  }

  const currentLevel = upgradeLevel(upgrades, upgradeId);
  if (currentLevel >= definition.maxLevel) {
    return null;
  }

  return definition.levels[currentLevel].cost;
}

export function canAffordUpgrade(resources, cost) {
  if (!cost) {
    return false;
  }

  return Object.entries(cost).every(([resource, amount]) => (resources?.[resource] || 0) >= amount);
}

export function aggregateUpgradeEffects(upgrades) {
  const effects = { ...DEFAULT_EFFECTS };

  for (const definition of UPGRADE_DEFINITIONS) {
    const level = upgradeLevel(upgrades, definition.id);
    if (level <= 0) {
      continue;
    }

    Object.assign(effects, definition.levels[level - 1].effects);
  }

  return effects;
}

export function isUpgradeId(value) {
  return UPGRADE_IDS.has(value);
}

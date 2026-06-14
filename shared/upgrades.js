export const UPGRADE_DEFINITIONS = Object.freeze([
  {
    id: "speed",
    label: "SPEED",
    code: "SPD",
    maxLevel: 5,
    visual: "Longer shared thruster plume.",
    levels: Object.freeze([
      {
        cost: { rock: 45, ore: 4 },
        effects: { thrustMultiplier: 1.06, maxSpeedMultiplier: 1.06, thrusterParticleMultiplier: 1.08 }
      },
      {
        cost: { rock: 90, ore: 9 },
        effects: { thrustMultiplier: 1.12, maxSpeedMultiplier: 1.13, thrusterParticleMultiplier: 1.16 }
      },
      {
        cost: { rock: 150, ore: 18, diamond: 1 },
        effects: { thrustMultiplier: 1.18, maxSpeedMultiplier: 1.21, thrusterParticleMultiplier: 1.26 }
      },
      {
        cost: { rock: 230, ore: 30, diamond: 2 },
        effects: { thrustMultiplier: 1.25, maxSpeedMultiplier: 1.29, thrusterParticleMultiplier: 1.38 }
      },
      {
        cost: { rock: 340, ore: 45, diamond: 4 },
        effects: { thrustMultiplier: 1.32, maxSpeedMultiplier: 1.38, thrusterParticleMultiplier: 1.52 }
      }
    ])
  },
  {
    id: "control",
    label: "CONTROL",
    code: "CTL",
    maxLevel: 4,
    visual: "Tighter drift with the same ship silhouette.",
    levels: Object.freeze([
      { cost: { rock: 35, ore: 3 }, effects: { dragMultiplier: 0.965 } },
      { cost: { rock: 75, ore: 7 }, effects: { dragMultiplier: 0.935 } },
      { cost: { rock: 130, ore: 14, diamond: 1 }, effects: { dragMultiplier: 0.905 } },
      { cost: { rock: 210, ore: 24, diamond: 2 }, effects: { dragMultiplier: 0.875 } }
    ])
  },
  {
    id: "range",
    label: "RANGE",
    code: "RNG",
    maxLevel: 5,
    visual: "Mining ray endpoint reaches farther.",
    levels: Object.freeze([
      { cost: { rock: 55, ore: 6 }, effects: { rayLengthBonus: 5 } },
      { cost: { rock: 110, ore: 12 }, effects: { rayLengthBonus: 10 } },
      { cost: { rock: 180, ore: 22, diamond: 1 }, effects: { rayLengthBonus: 16 } },
      { cost: { rock: 270, ore: 36, diamond: 2 }, effects: { rayLengthBonus: 23 } },
      { cost: { rock: 390, ore: 55, diamond: 4 }, effects: { rayLengthBonus: 31 } }
    ])
  },
  {
    id: "power",
    label: "POWER",
    code: "PWR",
    maxLevel: 5,
    visual: "Mining ray rotates faster and hits harder.",
    levels: Object.freeze([
      {
        cost: { rock: 60, ore: 10 },
        effects: {
          miningPowerMultiplier: 1.15,
          rayDamageMultiplier: 1.12,
          raySpinMultiplier: 1.18,
          miningParticleMultiplier: 1.1
        }
      },
      {
        cost: { rock: 130, ore: 22, diamond: 1 },
        effects: {
          miningPowerMultiplier: 1.32,
          rayDamageMultiplier: 1.26,
          raySpinMultiplier: 1.4,
          miningParticleMultiplier: 1.22
        }
      },
      {
        cost: { rock: 220, ore: 40, diamond: 2 },
        effects: {
          miningPowerMultiplier: 1.52,
          rayDamageMultiplier: 1.43,
          raySpinMultiplier: 1.68,
          miningParticleMultiplier: 1.36
        }
      },
      {
        cost: { rock: 340, ore: 62, diamond: 4 },
        effects: {
          miningPowerMultiplier: 1.75,
          rayDamageMultiplier: 1.63,
          raySpinMultiplier: 2,
          miningParticleMultiplier: 1.52
        }
      },
      {
        cost: { rock: 500, ore: 90, diamond: 7 },
        effects: {
          miningPowerMultiplier: 2.05,
          rayDamageMultiplier: 1.88,
          raySpinMultiplier: 2.38,
          miningParticleMultiplier: 1.72
        }
      }
    ])
  },
  {
    id: "hull",
    label: "HULL",
    code: "HUL",
    maxLevel: 4,
    visual: "HUD health bar count increases up to seven.",
    levels: Object.freeze([
      { cost: { rock: 90, ore: 12 }, effects: { healthBarsBonus: 1 } },
      { cost: { rock: 170, ore: 26, diamond: 1 }, effects: { healthBarsBonus: 2 } },
      { cost: { rock: 290, ore: 45, diamond: 3 }, effects: { healthBarsBonus: 3 } },
      { cost: { rock: 440, ore: 70, diamond: 6 }, effects: { healthBarsBonus: 4 } }
    ])
  },
  {
    id: "repair",
    label: "REPAIR",
    code: "REP",
    maxLevel: 4,
    visual: "Health returns slowly after a quiet window.",
    levels: Object.freeze([
      { cost: { rock: 80, ore: 16, diamond: 1 }, effects: { healthRechargePerSecond: 1.5 } },
      { cost: { rock: 160, ore: 32, diamond: 2 }, effects: { healthRechargePerSecond: 3 } },
      { cost: { rock: 280, ore: 55, diamond: 4 }, effects: { healthRechargePerSecond: 5 } },
      { cost: { rock: 430, ore: 85, diamond: 7 }, effects: { healthRechargePerSecond: 7.5 } }
    ])
  },
  {
    id: "armor",
    label: "ARMOR",
    code: "ARM",
    maxLevel: 4,
    visual: "Incoming mining-ray damage is reduced.",
    levels: Object.freeze([
      { cost: { rock: 100, ore: 18, diamond: 1 }, effects: { damageTakenMultiplier: 0.94 } },
      { cost: { rock: 210, ore: 36, diamond: 3 }, effects: { damageTakenMultiplier: 0.88 } },
      { cost: { rock: 360, ore: 60, diamond: 5 }, effects: { damageTakenMultiplier: 0.81 } },
      { cost: { rock: 560, ore: 95, diamond: 8 }, effects: { damageTakenMultiplier: 0.74 } }
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

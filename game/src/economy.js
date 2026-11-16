// The economy: Vanguard starts each match with $800 and earns money the Counter-
// Strike way — kills pay, planting pays, winning pays most. Between rounds the buy
// menu spends it on guns, grenades and ammo. Money is the one number that carries
// across rounds, so a lost round still leaves a next one to play for.
import { WEAPONS, GRENADES } from './weapons.js';

export const REWARDS = { kill: 300, plant: 300, roundWin: 3250, roundLoss: 1900 };
export const AMMO_PRICE = 150;
const START_MONEY = 800;

export function createEconomy(weapons) {
  const state = { money: START_MONEY, ownedPrimary: 'rifle' };

  function buyPrimary(id) {
    const def = WEAPONS[id];
    if (!def || def.kind !== 'primary') return { ok: false, reason: 'no such weapon' };
    if (state.ownedPrimary === id) return { ok: false, reason: 'already owned' };
    if (state.money < def.price) return { ok: false, reason: 'not enough money' };
    state.money -= def.price;
    state.ownedPrimary = id;
    weapons.equipPrimary(id);
    return { ok: true, spent: def.price };
  }

  function buyGrenade(kind) {
    const def = GRENADES[kind];
    if (!def) return { ok: false, reason: 'no such grenade' };
    if (state.money < def.price) return { ok: false, reason: 'not enough money' };
    if (!weapons.addGrenade(kind)) return { ok: false, reason: 'carrying the maximum' };
    state.money -= def.price;
    return { ok: true, spent: def.price };
  }

  function buyAmmo() {
    if (state.money < AMMO_PRICE) return { ok: false, reason: 'not enough money' };
    state.money -= AMMO_PRICE;
    weapons.refillAmmo();
    return { ok: true, spent: AMMO_PRICE };
  }

  return {
    state,
    buyPrimary,
    buyGrenade,
    buyAmmo,
    earn(amount) {
      state.money += amount;
    },
    reset() {
      state.money = START_MONEY;
      state.ownedPrimary = 'rifle';
    },
  };
}

// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill feed,
// bomb status, plant bar, buy menu and the overlay panels. It never touches the
// simulation; game.js pushes numbers in and reads button callbacks out. Every setter
// skips work when the value has not changed, so the HUD costs nothing on a quiet frame.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const buyPanel = $('buy');
  const buyGrid = $('buy-grid');
  const buyMoney = $('buy-money');
  const deployButton = $('deploy');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damage = $('damage');
  const flashWhite = $('flashwhite');
  const timerEl = $('timer');
  const scoreEl = $('score');
  const aliveEl = $('alive');
  const bombBanner = $('bomb-banner');
  const bombText = $('bomb-text');
  const plantBar = $('plantbar');
  const plantFill = $('plantfill');
  const killfeed = $('killfeed');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyEl = $('money');
  const grenadesEl = $('grenades');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const ammoEl = $('ammo');
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;
  let last = {};

  function setText(element, value, key) {
    if (last[key] === value) return;
    last[key] = value;
    element.textContent = value;
  }

  const COPY = {
    start: {
      title: 'EMBERLINE — Dock 9',
      copy: 'Vanguard versus the Rustjackals, first to 5 rounds. Plant the charge at A or B, or wipe the other team. $800 in your pocket — spend it well.',
      action: 'Click to play',
    },
    paused: {
      title: 'EMBERLINE — Dock 9',
      copy: 'Paused. Click to resume.',
      action: 'Click to resume',
    },
    round: {
      title: 'Round over',
      copy: '',
      action: 'Continue',
    },
    match: {
      title: 'Match over',
      copy: '',
      action: 'Play again',
    },
  };

  return {
    setHealth(hp) {
      if (last.health === hp) return;
      last.health = hp;
      healthFill.style.width = `${hp}%`;
      healthNum.textContent = String(hp);
      healthFill.style.background = hp > 50 ? '#57d977' : hp > 25 ? '#f0a830' : '#d84a35';
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, String(mag), 'mag');
      setText(ammoReserve, `/ ${reserve}`, 'reserve');
      setText(weaponName, name, 'weaponName');
      ammoEl.classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      setText(moneyEl, `$${value}`, 'money');
      setText(buyMoney, `$${value}`, 'buyMoney');
    },
    setGrenades(frags, flashes) {
      setText(grenadesEl, `Frag ${frags} · Flash ${flashes}`, 'grenades');
    },
    setTimer(seconds) {
      const total = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      setText(timerEl, text, 'timer');
      timerEl.classList.toggle('low', total <= 10);
    },
    setScore(us, them) {
      setText(scoreEl, `VANGUARD ${us} — ${them} RUSTJACKALS`, 'score');
    },
    setAlive(us, them) {
      setText(aliveEl, `Alive ${us} · ${them}`, 'alive');
    },
    setCrosshair(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damage.classList.remove('on'), 220);
    },
    flashWhite(strength) {
      flashWhite.style.opacity = String(Math.min(1, strength));
      setTimeout(() => {
        flashWhite.style.opacity = '0';
      }, 350);
    },
    setBomb(status, seconds) {
      if (!status) {
        bombBanner.hidden = true;
        return;
      }
      bombBanner.hidden = false;
      const text = status === 'planted' ? `CHARGE PLANTED — detonates in ${Math.ceil(seconds)}s` : status === 'defusing' ? 'CHARGE BEING DEFUSED!' : status;
      setText(bombText, text, 'bombText');
      bombBanner.classList.toggle('danger', status === 'defusing');
    },
    setPlant(progress) {
      if (progress <= 0) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    killfeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    showBanner(title, sub, holdMs = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      overlayTitle.textContent = text.title;
      overlayCopy.textContent = detail ?? text.copy;
      playButton.textContent = text.action;
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    // The buy menu is built from the shop's items: { id, name, price, desc, key, owned, disabled }.
    buildBuy(items, onBuy, onDeploy) {
      buyGrid.innerHTML = '';
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-item';
        button.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-price">$${item.price}</span><span class="buy-desc">${item.desc}</span>`;
        if (item.owned) button.classList.add('owned');
        button.addEventListener('click', () => onBuy(item.id));
        buyGrid.appendChild(button);
      }
      deployButton.onclick = onDeploy;
    },
    refreshBuy(money, ownedPrimary) {
      for (const button of buyGrid.children) {
        const price = Number(button.querySelector('.buy-price').textContent.slice(1));
        const name = button.querySelector('.buy-name').textContent;
        const isOwned = name === ownedPrimary;
        button.classList.toggle('owned', isOwned);
        button.classList.toggle('poor', !isOwned && price > money);
      }
      setText(buyMoney, `$${money}`, 'buyMoney');
    },
    showBuy() {
      buyPanel.hidden = false;
    },
    hideBuy() {
      buyPanel.hidden = true;
    },
    onPlay(handler) {
      playButton.addEventListener('click', handler);
    },
  };
}

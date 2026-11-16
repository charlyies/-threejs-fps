// The DOM HUD: crosshair, hitmarker, health/armor/ammo/money, timer, scores,
// kill feed, Beacon progress, damage direction, and the overlay screens.
// It never touches the simulation; main.js pushes numbers in.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), hitKill: $('hitmarker-kill'),
    healthFill: $('health-fill'), healthNum: $('health-num'), armorFill: $('armor-fill'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    money: $('money'), timer: $('timer'), roundLabel: $('round-label'),
    scoreEmber: $('score-ember'), scoreFrost: $('score-frost'),
    feed: $('killfeed'), beaconBar: $('beacon-fill'), beaconLabel: $('beacon-label'),
    dmg: $('dmg-indicator'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    overlayStats: $('overlay-stats'), playBtn: $('play'), buyPanel: $('buy-panel'), titlePanel: $('title-panel'),
    buyMoney: $('buy-money'), buyList: $('buy-list'), buyTimer: $('buy-timer'),
  };
  let hitTimer = null;
  function showOverlay(title, copy, btn, statsHtml = '') {
    els.overlay.hidden = false;
    els.titlePanel.hidden = false;
    els.buyPanel.hidden = true;
    els.overlayTitle.textContent = title;
    els.overlayCopy.innerHTML = copy;
    els.playBtn.textContent = btn;
    els.overlayStats.innerHTML = statsHtml;
    els.playBtn.style.display = btn ? '' : 'none';
  }
  return {
    els,
    setHealth(hp, armor) {
      els.healthFill.style.width = `${Math.max(0, hp)}%`;
      els.healthNum.textContent = Math.ceil(Math.max(0, hp));
      els.armorFill.style.width = `${Math.min(100, armor)}%`;
    },
    setAmmo(mag, reserve, name) {
      els.ammoMag.textContent = mag;
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.weaponName.textContent = name;
    },
    setMoney(m) { els.money.textContent = `$${m}`; },
    setTimer(s) {
      const v = Math.max(0, Math.ceil(s));
      els.timer.textContent = `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
      els.timer.classList.toggle('low', v <= 15);
    },
    setScores(e, f, round) {
      els.scoreEmber.textContent = e; els.scoreFrost.textContent = f;
      els.roundLabel.textContent = `ROUND ${round}`;
    },
    setSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitmarker(kill) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', !!kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on'), 120);
    },
    damageFrom(angleDeg) {
      els.dmg.style.setProperty('--rot', `${angleDeg}deg`);
      els.dmg.classList.add('on');
      setTimeout(() => els.dmg.classList.remove('on'), 450);
    },
    feed(text, good) {
      const div = document.createElement('div');
      div.className = 'feed-item' + (good ? ' good' : ' bad');
      div.textContent = text;
      els.feed.prepend(div);
      while (els.feed.children.length > 5) els.feed.lastChild.remove();
      setTimeout(() => div.remove(), 6000);
    },
    setBeacon(progress, owner) {
      els.beaconBar.style.width = `${Math.round(progress * 100)}%`;
      els.beaconBar.className = owner === 'ember' ? 'ember' : owner === 'frost' ? 'frost' : '';
      els.beaconLabel.textContent = progress > 0
        ? (owner === 'ember' ? 'EMBER capturing the Beacon…' : owner === 'frost' ? 'FROST capturing the Beacon…' : 'Beacon contested')
        : 'Beacon — stand in the ring to capture';
    },
    banner(title, sub, ms = 3200) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.hidden = false;
      setTimeout(() => { els.banner.hidden = true; }, ms);
    },
    title() {
      showOverlay('EMBERLINE',
        'A round-based tactical FPS in the Foundry Yard. <b>Ember</b> vs <b>Frost</b>, 5v5. ' +
        'Win the round by eliminating the enemy team or capturing <b>The Beacon</b> at mid. ' +
        'First to 5 rounds takes the match. Earn cash for kills and wins — spend it between rounds.',
        'Click to play');
    },
    buy(money, owned, onBuy, onReady, seconds) {
      els.overlay.hidden = false;
      els.titlePanel.hidden = true;
      els.buyPanel.hidden = false;
      els.buyMoney.textContent = `$${money}`;
      els.buyTimer.textContent = `Buy phase — ${seconds}s (B to close)`;
      els.buyList.innerHTML = '';
      const items = [
        { key: '1', id: 'pistol', name: 'Sidearm', desc: '12 / 48 · reliable', price: 0 },
        { key: '2', id: 'smg', name: 'Hornet SMG', desc: '28 / 112 · fast, close range', price: 600 },
        { key: '3', id: 'rifle', name: 'Longshot Rifle', desc: '30 / 90 · the all-rounder', price: 1200 },
        { key: '4', id: 'sniper', name: 'Deadeye', desc: '5 / 15 · one-shot headshots', price: 2000 },
        { key: '5', id: 'armor', name: 'Plating', desc: 'absorbs 50% of damage', price: 400 },
      ];
      for (const it of items) {
        const b = document.createElement('button');
        b.className = 'buy-item' + (owned.includes(it.id) ? ' owned' : '');
        b.innerHTML = `<span class="buy-key">${it.key}</span><span class="buy-name">${it.name}</span>` +
          `<span class="buy-desc">${it.desc}</span><span class="buy-price">${it.price === 0 ? 'OWNED' : '$' + it.price}</span>`;
        b.onclick = () => onBuy(it.id);
        els.buyList.appendChild(b);
      }
      const ready = document.createElement('button');
      ready.className = 'buy-ready'; ready.textContent = 'READY — start round';
      ready.onclick = onReady;
      els.buyList.appendChild(ready);
    },
    hideBuy() { els.buyPanel.hidden = true; els.overlay.hidden = true; els.titlePanel.hidden = false; },
    hideOverlay() { els.overlay.hidden = true; els.buyPanel.hidden = true; },
    matchEnd(won, statsHtml) {
      showOverlay(won ? 'EMBER TAKES THE MATCH' : 'FROST TAKES THE MATCH',
        won ? 'The foundry is yours. The Beacon burns orange tonight.'
            : 'The frost holds the yard — for now. Run it back.',
        'Play again', statsHtml);
    },
    onPlay(fn) { els.playBtn.addEventListener('click', fn); },
  };
}

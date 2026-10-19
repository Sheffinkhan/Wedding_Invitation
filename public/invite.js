// Interactions for the invitation page: opening, music, petals, reveals,
// countdown, calendar menus, guest wishes and sharing.
(() => {
  const data = JSON.parse(document.getElementById('invite-data').textContent);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pageOpenedAt = Date.now();

  const store = {
    get(key, fallback) {
      try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Private browsing: likes simply are not remembered.
      }
    },
  };

  // ---- Music ----

  const audio = document.querySelector('[data-audio]');
  const musicButton = document.querySelector('[data-music]');
  const musicLabel = document.querySelector('[data-music-label]');
  const songTitle = data.music.title ? `: ${data.music.title}` : '';
  let wantsMusic = false;

  function showMusicState() {
    if (!musicButton) return;
    const playing = !audio.paused;
    musicButton.setAttribute('aria-pressed', String(playing));
    musicLabel.textContent = `${playing ? 'Pause' : 'Play'} music${songTitle}`;
  }

  function fadeIn() {
    audio.volume = 0;
    const step = () => {
      if (audio.paused) return;
      audio.volume = Math.min(0.7, audio.volume + 0.035);
      if (audio.volume < 0.7) setTimeout(step, 100);
    };
    step();
  }

  function playMusic() {
    if (!audio) return;
    wantsMusic = true;
    audio
      .play()
      .then(fadeIn)
      .catch(() => {})
      .finally(showMusicState);
  }

  if (audio && musicButton) {
    musicButton.addEventListener('click', () => {
      if (audio.paused) playMusic();
      else {
        wantsMusic = false;
        audio.pause();
        showMusicState();
      }
    });
    audio.addEventListener('pause', showMusicState);
    audio.addEventListener('play', showMusicState);
    // Pause while the guest is in another app, and pick up again when they return.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) audio.pause();
      else if (wantsMusic) audio.play().catch(() => {});
    });
  }

  // ---- Opening ----

  const cover = document.getElementById('cover');
  const openButton = document.getElementById('open');
  const main = document.getElementById('invitation');

  function openInvitation() {
    if (cover.classList.contains('is-opening')) return;
    cover.classList.add('is-opening');
    document.body.classList.remove('is-locked');
    document.body.classList.add('is-open');
    if (musicButton) musicButton.hidden = false;
    playMusic();
    setTimeout(
      () => {
        cover.hidden = true;
        main.focus({ preventScroll: true });
      },
      reduceMotion ? 0 : 1400,
    );
    window.scrollTo(0, 0);
  }

  if (location.hash && location.hash !== '#cover' && document.querySelector(location.hash)) {
    // Links to a section skip the opening screen.
    cover.hidden = true;
    document.body.classList.add('is-open');
    if (musicButton) musicButton.hidden = false;
  } else {
    document.body.classList.add('is-locked');
    openButton.addEventListener('click', (event) => {
      event.preventDefault();
      openInvitation();
    });
  }

  // ---- Petals ----

  const petals = document.querySelector('.petals');
  if (petals && !reduceMotion) {
    const count = window.innerWidth < 600 ? 12 : 18;
    const random = (min, max) => min + Math.random() * (max - min);
    for (let i = 0; i < count; i++) {
      const petal = document.createElement('span');
      petal.className = 'petal';
      const fall = random(11, 20);
      petal.style.cssText = [
        `--x:${random(-5, 100)}%`,
        `--fall:${fall}s`,
        `--delay:${-random(0, fall)}s`,
        `--drift:${random(-80, 80)}px`,
        `--size:${random(9, 17)}px`,
        `--sway:${random(2.5, 4.5)}s`,
        `--tint:${i % 3 === 0 ? '#fff' : 'var(--mist)'}`,
      ].join(';');
      petal.appendChild(document.createElement('i'));
      petals.appendChild(petal);
    }
  }

  // ---- Reveal on scroll ----

  const revealed = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    revealed.forEach((element) => observer.observe(element));
  } else {
    revealed.forEach((element) => element.classList.add('is-visible'));
  }

  // ---- Parallax ----

  const layers = [...document.querySelectorAll('[data-parallax]')];
  if (layers.length && !reduceMotion) {
    let queued = false;
    const update = () => {
      queued = false;
      for (const layer of layers) {
        const box = layer.parentElement.getBoundingClientRect();
        if (box.bottom < 0 || box.top > window.innerHeight) continue;
        layer.style.transform = `translate3d(0, ${(box.top * -0.12).toFixed(1)}px, 0)`;
      }
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!queued) {
          queued = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    update();
  }

  // ---- Countdown ----

  const grid = document.querySelector('[data-countdown]');
  if (grid) {
    const start = new Date(data.countdown.start).getTime();
    const end = new Date(data.countdown.end).getTime();
    const message = document.querySelector('[data-countdown-message]');
    const cells = Object.fromEntries([...grid.querySelectorAll('[data-unit]')].map((cell) => [cell.dataset.unit, cell]));
    let timer;

    const set = (unit, value) => {
      const text = String(value).padStart(2, '0');
      const cell = cells[unit];
      if (cell.textContent === text) return;
      cell.textContent = text;
      if (!reduceMotion) {
        cell.classList.remove('tick');
        void cell.offsetWidth;
        cell.classList.add('tick');
      }
    };

    const tick = () => {
      const now = Date.now();
      if (now >= start) {
        clearInterval(timer);
        grid.hidden = true;
        message.hidden = false;
        message.textContent = now >= end ? data.countdown.ended : data.countdown.started;
        if (now < end) setTimeout(tick, Math.min(end - now, 2 ** 31 - 1));
        return;
      }
      let left = Math.floor((start - now) / 1000);
      set('days', Math.floor(left / 86400));
      left %= 86400;
      set('hours', Math.floor(left / 3600));
      left %= 3600;
      set('minutes', Math.floor(left / 60));
      set('seconds', left % 60);
    };

    tick();
    timer = setInterval(tick, 1000);
  }

  // ---- Calendar menus close when tapping elsewhere ----

  document.addEventListener('click', (event) => {
    document.querySelectorAll('details.calendar[open]').forEach((menu) => {
      if (!menu.contains(event.target)) menu.open = false;
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('details.calendar[open]').forEach((menu) => {
      menu.open = false;
      menu.querySelector('summary').focus();
    });
  });

  // ---- Sharing ----

  document.querySelectorAll('[data-share]').forEach((button) => {
    button.addEventListener('click', async () => {
      const url = location.origin + location.pathname;
      if (navigator.share) {
        try {
          await navigator.share({ title: data.share.title, text: data.share.text, url });
          return;
        } catch (error) {
          if (error && error.name === 'AbortError') return;
        }
      }
      window.open(`https://wa.me/?text=${encodeURIComponent(`${data.share.title}\n${url}`)}`, '_blank', 'noopener');
    });
  });

  // ---- Guest wishes ----

  const form = document.querySelector('[data-wish-form]');
  const list = document.querySelector('[data-wish-list]');
  if (!form || !list || !data.wishes.available) return;

  const status = form.querySelector('[data-form-status]');
  const counter = form.querySelector('[data-count]');
  const submit = form.querySelector('button[type="submit"]');
  const liked = new Set(store.get('liked-wishes', []));
  const PAGE = 12;
  let wishes = [];
  let shown = PAGE;
  let likesOn = data.wishes.likes;

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function heartIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-heart');
    svg.appendChild(use);
    return svg;
  }

  function wishCard(wish) {
    const card = element('article', 'wish');
    const head = element('div', 'wish__head');
    head.append(element('h3', 'wish__name', wish.name), element('time', 'wish__date', dateFormat.format(new Date(wish.createdAt))));
    card.append(head, element('p', 'wish__message', wish.message));
    if (likesOn) {
      const button = element('button', 'like');
      button.type = 'button';
      const count = element('span', '', String(wish.likes || 0));
      button.append(heartIcon(), count);
      const label = () => button.setAttribute('aria-label', `${liked.has(wish.id) ? 'Unlike' : 'Like'} wish from ${wish.name}`);
      button.setAttribute('aria-pressed', String(liked.has(wish.id)));
      label();
      button.addEventListener('click', () => toggleLike(wish, button, count, label));
      card.append(button);
    }
    return card;
  }

  function render() {
    list.replaceChildren();
    if (!wishes.length) {
      list.append(element('p', 'muted', 'Be the first to leave a wish.'));
      return;
    }
    wishes.slice(0, shown).forEach((wish) => list.append(wishCard(wish)));
    if (wishes.length > shown) {
      const more = element('button', 'btn btn--outline', `Show more wishes (${wishes.length - shown})`);
      more.type = 'button';
      more.addEventListener('click', () => {
        shown += PAGE;
        render();
      });
      list.append(more);
    }
  }

  async function toggleLike(wish, button, count, label) {
    const nowLiked = !liked.has(wish.id);
    const before = wish.likes || 0;
    const apply = (isLiked, likes) => {
      if (isLiked) liked.add(wish.id);
      else liked.delete(wish.id);
      wish.likes = likes;
      count.textContent = String(likes);
      button.setAttribute('aria-pressed', String(isLiked));
      label();
      store.set('liked-wishes', [...liked]);
    };
    apply(nowLiked, Math.max(0, before + (nowLiked ? 1 : -1)));
    button.disabled = true;
    try {
      const response = await fetch(`/api/wishes/${encodeURIComponent(wish.id)}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liked: nowLiked }),
      });
      if (!response.ok) throw new Error();
      apply(nowLiked, (await response.json()).likes);
    } catch {
      apply(!nowLiked, before);
    } finally {
      button.disabled = false;
    }
  }

  async function loadWishes() {
    try {
      const response = await fetch('/api/wishes', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error();
      const body = await response.json();
      wishes = body.wishes;
      likesOn = body.likes;
      render();
    } catch {
      list.replaceChildren(element('p', 'muted', 'Wishes could not be loaded right now. Please refresh to try again.'));
    }
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = `form-status${kind ? ` is-${kind}` : ''}`;
  }

  const fields = { name: form.elements.name, message: form.elements.message };

  fields.message.addEventListener('input', () => {
    counter.textContent = `${fields.message.value.length} / 500`;
  });

  for (const field of Object.values(fields)) {
    field.addEventListener('input', () => field.removeAttribute('aria-invalid'));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = fields.name.value.trim();
    const message = fields.message.value.trim();
    if (name.length < 2) {
      fields.name.setAttribute('aria-invalid', 'true');
      fields.name.focus();
      return setStatus('Please enter your name.', 'error');
    }
    if (message.length < 2) {
      fields.message.setAttribute('aria-invalid', 'true');
      fields.message.focus();
      return setStatus('Please write a message.', 'error');
    }

    submit.disabled = true;
    const label = submit.querySelector('span');
    const original = label.textContent;
    label.textContent = 'Sending…';
    setStatus('');
    try {
      const response = await fetch('/api/wishes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message, website: form.elements.website.value, elapsedMs: Date.now() - pageOpenedAt }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Your wish could not be sent. Please try again.');
      form.reset();
      counter.textContent = '0 / 500';
      if (body.pending) {
        setStatus('Thank you! Your wish will appear once the family has seen it.', 'success');
      } else {
        setStatus('Thank you! Your wish has been shared.', 'success');
        wishes = [body.wish, ...wishes.filter((wish) => wish.id !== body.wish.id)];
        render();
      }
    } catch (error) {
      // A TypeError means the request never reached the server.
      setStatus(
        error instanceof TypeError ? 'Your wish could not be sent. Please check your connection and try again.' : error.message,
        'error',
      );
    } finally {
      submit.disabled = false;
      label.textContent = original;
    }
  });

  // Wishes load when the section comes near, so they do not slow down the opening.
  if ('IntersectionObserver' in window) {
    const lazy = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        lazy.disconnect();
        loadWishes();
      }
    }, { rootMargin: '600px 0px' });
    lazy.observe(list);
  } else {
    loadWishes();
  }
})();

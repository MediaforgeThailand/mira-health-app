import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const clamp = gsap.utils.clamp;

/* ---------------------------------- nav ---------------------------------- */

function initNav() {
  const header = document.querySelector<HTMLElement>('[data-site-header]');
  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const menu = document.querySelector<HTMLElement>('[data-mobile-menu]');

  if (!header) return;

  const syncScrollState = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 80);
  };

  syncScrollState();
  window.addEventListener('scroll', syncScrollState, { passive: true });

  toggle?.addEventListener('click', () => {
    const open = !header.classList.contains('is-open');
    header.classList.toggle('is-open', open);
    document.documentElement.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    menu?.setAttribute('aria-hidden', String(!open));
  });

  menu?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      header.classList.remove('is-open');
      document.documentElement.classList.remove('menu-open');
      toggle?.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    });
  });
}

/* ------------------------ scroll progress + scrollspy ------------------------ */

function initProgressAndSpy() {
  const bar = document.querySelector<HTMLElement>('.scroll-progress span');

  if (bar && !reducedMotion) {
    gsap.to(bar, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: 0.4 },
    });
  }

  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-spy-link]')];
  if (links.length === 0) return;

  const setActive = (hash: string) => {
    links.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === hash));
  };

  links.forEach((link) => {
    const id = link.getAttribute('href');
    if (!id?.startsWith('#')) return;
    const target = document.querySelector<HTMLElement>(id);
    if (!target) return;

    ScrollTrigger.create({
      trigger: target,
      start: 'top 45%',
      end: 'bottom 45%',
      onToggle: (self) => {
        if (self.isActive) setActive(id);
      },
    });
  });
}

/* --------------------------------- hero --------------------------------- */

function initHero() {
  const hero = document.querySelector<HTMLElement>('.hero');
  if (!hero) return;

  if (!reducedMotion) {
    const words = hero.querySelectorAll('[data-words] .w');

    gsap.to(words, {
      y: 0,
      opacity: 1,
      filter: 'blur(0px)',
      duration: 1,
      ease: 'power3.out',
      stagger: 0.07,
      delay: 0.1,
    });

    gsap.to(hero.querySelectorAll('[data-reveal]'), {
      y: 0,
      opacity: 1,
      duration: 0.8,
      delay: 0.5,
      ease: 'power3.out',
      stagger: 0.09,
      onComplete: () => {
        hero.querySelectorAll('[data-reveal]').forEach((el) => el.setAttribute('data-reveal-done', ''));
      },
    });

    // gradient shimmer on the highlighted word
    gsap.to(hero.querySelectorAll('.gradient-text'), {
      backgroundPosition: '120% 0',
      duration: 4.5,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });
  }

  // pointer parallax: device tilts, glow layers drift
  if (!reducedMotion && finePointer) {
    const device = hero.querySelector<HTMLElement>('.hero-device .device-tilt');
    const glows = hero.querySelectorAll<HTMLElement>('.hero-layer');

    if (device) {
      const rx = gsap.quickTo(device, 'rotationX', { duration: 0.7, ease: 'power2.out' });
      const ry = gsap.quickTo(device, 'rotationY', { duration: 0.7, ease: 'power2.out' });
      const glowTos = [...glows].map((layer, index) => ({
        x: gsap.quickTo(layer, 'x', { duration: 1.1, ease: 'power2.out' }),
        y: gsap.quickTo(layer, 'y', { duration: 1.1, ease: 'power2.out' }),
        depth: (index + 1) * 14,
      }));

      hero.addEventListener('pointermove', (event) => {
        const rect = hero.getBoundingClientRect();
        const nx = (event.clientX - rect.left) / rect.width - 0.5;
        const ny = (event.clientY - rect.top) / rect.height - 0.5;
        ry(nx * 10);
        rx(ny * -8);
        glowTos.forEach(({ x, y, depth }) => {
          x(nx * depth);
          y(ny * depth);
        });
      });

      hero.addEventListener('pointerleave', () => {
        rx(0);
        ry(0);
        glowTos.forEach(({ x, y }) => {
          x(0);
          y(0);
        });
      });
    }
  }
}

/* ----------------------------- lazy videos ----------------------------- */

function initLazyVideos() {
  const videos = document.querySelectorAll<HTMLVideoElement>('[data-motion-video]');

  if (reducedMotion) {
    videos.forEach((video) => video.pause());
    return;
  }

  const attach = (video: HTMLVideoElement) => {
    if (video.dataset.loaded === 'true') return;
    video.querySelectorAll<HTMLSourceElement>('source[data-src]').forEach((source) => {
      source.src = source.dataset.src ?? '';
    });
    video.dataset.loaded = 'true';
    video.load();
    void video.play().catch(() => undefined);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          attach(entry.target as HTMLVideoElement);
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '150% 0px' },
  );

  videos.forEach((video) => observer.observe(video));
}

/* ----------------------------- scroll reveals ----------------------------- */

function initScrollReveals() {
  if (reducedMotion) return;

  const revealItems = gsap.utils
    .toArray<HTMLElement>('[data-reveal]')
    .filter((item) => !item.closest('.hero'));

  ScrollTrigger.batch(revealItems, {
    start: 'top 88%',
    once: true,
    onEnter: (batch) => {
      gsap.to(batch, {
        y: 0,
        opacity: 1,
        duration: 0.75,
        ease: 'power3.out',
        stagger: 0.09,
        overwrite: true,
        onComplete: () => batch.forEach((el) => el.setAttribute('data-reveal-done', '')),
      });
    },
  });

  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}

/* ------------------------- ghost word parallax ------------------------- */

function initGhostParallax() {
  if (reducedMotion) return;

  gsap.utils.toArray<HTMLElement>('.ghost-word').forEach((ghost) => {
    gsap.fromTo(
      ghost,
      { xPercent: 6 },
      {
        xPercent: -6,
        ease: 'none',
        scrollTrigger: {
          trigger: ghost,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.6,
        },
      },
    );
  });
}

/* ------------------------------- counters ------------------------------- */

function animateCount(el: HTMLElement) {
  if (el.dataset.counted === 'true') return;
  el.dataset.counted = 'true';

  const to = Number(el.dataset.countTo ?? 0);
  const prefix = el.dataset.countPrefix ?? '';
  const suffix = el.dataset.countSuffix ?? '';
  const state = { value: 0 };

  if (reducedMotion) {
    el.textContent = `${prefix}${to.toLocaleString('th-TH')}${suffix}`;
    return;
  }

  gsap.to(state, {
    value: to,
    duration: 1.4,
    ease: 'power2.out',
    onUpdate: () => {
      el.textContent = `${prefix}${Math.round(state.value).toLocaleString('th-TH')}${suffix}`;
    },
  });
}

function initCounters() {
  gsap.utils.toArray<HTMLElement>('[data-count-to]:not([data-count-manual])').forEach((el) => {
    ScrollTrigger.create({
      trigger: el,
      start: 'top 85%',
      once: true,
      onEnter: () => animateCount(el),
    });
  });
}

/* --------------------------- marquee velocity --------------------------- */

function initMarquees() {
  if (reducedMotion) {
    document.querySelectorAll<HTMLElement>('.marquee-track').forEach((track) => {
      track.style.animationPlayState = 'paused';
    });
    return;
  }

  const tracks = gsap.utils.toArray<HTMLElement>('.marquee-track');
  if (tracks.length === 0) return;

  const skewTos = tracks.map((track) => gsap.quickTo(track, 'skewX', { duration: 0.5, ease: 'power2.out' }));

  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      const skew = clamp(-8, 8, self.getVelocity() / -260);
      skewTos.forEach((to) => to(skew));
    },
  });
}

/* ------------------------------ 3D tilt cards ------------------------------ */

function initTilt() {
  if (reducedMotion || !finePointer) return;

  gsap.utils.toArray<HTMLElement>('.tilt-card').forEach((card) => {
    const rx = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power2.out' });
    const ry = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power2.out' });

    gsap.set(card, { transformPerspective: 900 });

    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / rect.width - 0.5;
      const ny = (event.clientY - rect.top) / rect.height - 0.5;
      ry(nx * 7);
      rx(ny * -7);
    });

    card.addEventListener('pointerleave', () => {
      rx(0);
      ry(0);
    });
  });
}

/* ----------------------------- magnetic buttons ----------------------------- */

function initMagnetic() {
  if (reducedMotion || !finePointer) return;

  gsap.utils.toArray<HTMLElement>('[data-magnetic]').forEach((el) => {
    const x = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power2.out' });
    const y = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power2.out' });

    el.addEventListener('pointermove', (event) => {
      const rect = el.getBoundingClientRect();
      x((event.clientX - rect.left - rect.width / 2) * 0.32);
      y((event.clientY - rect.top - rect.height / 2) * 0.32);
    });

    el.addEventListener('pointerleave', () => {
      x(0);
      y(0);
    });
  });
}

/* ----------------------------- referral scene ----------------------------- */

function initReferralScene() {
  const scene = document.querySelector<HTMLElement>('[data-referral-scene]');
  const progress = document.querySelector<HTMLElement>('[data-referral-progress]');
  const steps = gsap.utils.toArray<HTMLElement>('[data-referral-step]');
  const panels = gsap.utils.toArray<HTMLElement>('[data-referral-panel]');
  const counter = document.querySelector<HTMLElement>('[data-commission-counter]');

  if (!scene || steps.length === 0) return;

  let current = -1;

  const setStep = (index: number) => {
    if (index === current) return;
    current = index;

    steps.forEach((step, stepIndex) => {
      step.classList.toggle('is-active', stepIndex === index);
      step.classList.toggle('is-done', stepIndex < index);
    });
    panels.forEach((panel, panelIndex) => {
      panel.classList.toggle('is-active', panelIndex === index);
    });

    if (progress) {
      gsap.to(progress, { scaleY: (index + 1) / steps.length, duration: 0.4, ease: 'power2.out', overwrite: true });
    }

    if (index === steps.length - 1 && counter) {
      animateCount(counter);
    }
  };

  const showAll = () => {
    steps.forEach((step) => step.classList.add('is-active'));
    panels.forEach((panel, panelIndex) => panel.classList.toggle('is-active', panelIndex === panels.length - 1));
    if (progress) progress.style.transform = 'scaleY(1)';
    if (counter) animateCount(counter);
  };

  if (reducedMotion) {
    showAll();
    return;
  }

  const mm = gsap.matchMedia();

  mm.add('(min-width: 1024px)', () => {
    setStep(0);

    const trigger = ScrollTrigger.create({
      trigger: scene,
      start: 'top top',
      end: '+=280%',
      pin: true,
      scrub: true,
      anticipatePin: 1,
      onUpdate: (self) => {
        setStep(Math.min(steps.length - 1, Math.floor(self.progress * steps.length)));
      },
    });

    return () => trigger.kill();
  });

  mm.add('(max-width: 1023px)', () => {
    // no pin on mobile: activate steps as they enter, keep panels in sync
    const triggers = steps.map((step, index) =>
      ScrollTrigger.create({
        trigger: step,
        start: 'top 72%',
        onEnter: () => setStep(index),
        onEnterBack: () => setStep(index),
      }),
    );

    return () => triggers.forEach((t) => t.kill());
  });
}

/* ------------------------------- flywheel ------------------------------- */

function initFlywheel() {
  const wheel = document.querySelector<HTMLElement>('[data-flywheel]');
  if (!wheel || reducedMotion) return;

  const orbit = wheel.querySelector('[data-flywheel-orbit]');
  const comet = wheel.querySelector('[data-flywheel-comet]');
  const nodes = wheel.querySelectorAll('[data-flywheel-node]');
  const labels = wheel.querySelectorAll('[data-flywheel-label]');

  const tl = gsap.timeline({ repeat: -1, paused: true, defaults: { ease: 'none' } });

  if (orbit) {
    tl.to(orbit, { rotation: 360, duration: 26, svgOrigin: '300 300' }, 0);
  }
  if (comet) {
    tl.to(comet, { rotation: 360, duration: 6.5, svgOrigin: '300 300', repeat: 3 }, 0);
  }

  nodes.forEach((node, index) => {
    tl.fromTo(
      node,
      { scale: 1, transformOrigin: '50% 50%' },
      { scale: 1.18, duration: 0.5, ease: 'sine.inOut', yoyo: true, repeat: 1 },
      index * 6.5 + 0.4,
    );
    if (labels[index]) {
      tl.fromTo(
        labels[index],
        { opacity: 0.55 },
        { opacity: 1, duration: 0.5, ease: 'sine.inOut' },
        index * 6.5 + 0.4,
      );
    }
  });

  ScrollTrigger.create({
    trigger: wheel,
    start: 'top 85%',
    end: 'bottom top',
    onToggle: (self) => (self.isActive ? tl.play() : tl.pause()),
  });
}

/* ----------------------------- admin parallax ----------------------------- */

function initAdminParallax() {
  if (reducedMotion) return;

  gsap.utils.toArray<HTMLElement>('[data-float-card]').forEach((card, index) => {
    gsap.fromTo(
      card,
      { yPercent: index % 2 === 0 ? 4 : -2 },
      {
        yPercent: index % 2 === 0 ? -4 : 2,
        ease: 'none',
        scrollTrigger: {
          trigger: card,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.5,
        },
      },
    );
  });
}

/* ----------------------------- vertical panels ----------------------------- */

function initVerticalPanels() {
  if (reducedMotion) return;

  gsap.utils.toArray<HTMLElement>('[data-vertical-panel] .vertical-visual').forEach((panel) => {
    gsap.from(panel, {
      scale: 1.05,
      opacity: 0.85,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: panel,
        start: 'top 80%',
        once: true,
      },
    });
  });
}

/* ------------------------------ CTA spotlight ------------------------------ */

function initCtaSpotlight() {
  if (reducedMotion || !finePointer) return;

  const section = document.querySelector<HTMLElement>('[data-spotlight]');
  if (!section) return;

  section.addEventListener('pointermove', (event) => {
    const rect = section.getBoundingClientRect();
    section.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width) * 100}%`);
    section.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height) * 100}%`);
  });
}

/* ------------------------------- mailto form ------------------------------- */

function initMailtoForm() {
  document.querySelectorAll<HTMLFormElement>('[data-contact-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const recipient = form.dataset.mailto ?? 'hello@mira.com';
      const body = [
        `ชื่อ: ${data.get('name') ?? ''}`,
        `องค์กร: ${data.get('organization') ?? ''}`,
        `อีเมลหรือเบอร์ติดต่อ: ${data.get('contact') ?? ''}`,
        `ประเภทธุรกิจ: ${data.get('businessType') ?? ''}`,
      ].join('\n');
      const subject = encodeURIComponent('Mira demo request');
      window.location.href = `mailto:${recipient}?subject=${subject}&body=${encodeURIComponent(body)}`;
      form.querySelector<HTMLElement>('[data-form-note]')?.removeAttribute('hidden');
    });
  });
}

/* --------------------------------- boot --------------------------------- */

function init() {
  if (!reducedMotion) {
    document.documentElement.classList.add('has-motion');

    // safety net: if rAF is throttled to zero (occluded window, aggressive
    // battery saver), GSAP can never render a frame — show content un-animated
    // instead of leaving reveal targets at opacity 0.
    window.setTimeout(() => {
      if (gsap.ticker.frame === 0) {
        document.documentElement.classList.remove('has-motion');
      }
    }, 2400);
  }

  initNav();
  initProgressAndSpy();
  initHero();
  initLazyVideos();
  initScrollReveals();
  initGhostParallax();
  initCounters();
  initMarquees();
  initTilt();
  initMagnetic();
  initReferralScene();
  initFlywheel();
  initAdminParallax();
  initVerticalPanels();
  initCtaSpotlight();
  initMailtoForm();
}

init();

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

function initHeroReveal() {
  if (reducedMotion) return;

  const title = document.querySelector<HTMLElement>('[data-hero-title]');
  if (!title) return;

  const split = new SplitText(title, { type: 'lines', linesClass: 'hero-line' });
  gsap.from(split.lines, {
    yPercent: 105,
    opacity: 0,
    duration: 0.9,
    ease: 'power3.out',
    stagger: 0.12,
  });

  gsap.fromTo('.hero [data-reveal]', {
    y: 24,
    opacity: 0,
  }, {
    y: 0,
    opacity: 1,
    duration: 0.7,
    delay: 0.24,
    ease: 'power3.out',
    stagger: 0.08,
  });
}

function initScrollReveals() {
  if (reducedMotion) return;

  const revealItems = gsap.utils
    .toArray<HTMLElement>('[data-reveal]')
    .filter((item) => !item.closest('.hero'));

  ScrollTrigger.batch(revealItems, {
    start: 'top 88%',
    once: true,
    onEnter: (batch) => {
      gsap.fromTo(batch, {
        y: 18,
      }, {
        y: 0,
        duration: 0.55,
        ease: 'power3.out',
        stagger: 0.08,
        overwrite: true,
        clearProps: 'transform',
      });
    },
  });

  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}

function initReferralScene() {
  const scene = document.querySelector<HTMLElement>('[data-referral-scene]');
  const progress = document.querySelector<HTMLElement>('[data-referral-progress]');
  const steps = gsap.utils.toArray<HTMLElement>('[data-referral-step]');
  const counter = document.querySelector<HTMLElement>('[data-commission-counter]');
  let counterPlayed = false;

  if (!scene || steps.length === 0) return;

  const setActive = (index: number) => {
    steps.forEach((step, stepIndex) => {
      step.classList.toggle('is-active', stepIndex <= index);
    });

    if (index >= 3 && counter && !counterPlayed) {
      counterPlayed = true;
      const state = { value: 0 };
      gsap.to(state, {
        value: Number(counter.dataset.countTo ?? 350),
        duration: 1,
        ease: 'power2.out',
        onUpdate: () => {
          counter.textContent = `฿${Math.round(state.value).toLocaleString('th-TH')}`;
        },
      });
    }
  };

  if (reducedMotion || !window.matchMedia('(min-width: 1024px)').matches) {
    setActive(3);
    if (progress) progress.style.transform = 'scaleY(1)';
    return;
  }

  setActive(0);

  ScrollTrigger.create({
    trigger: scene,
    start: 'top top+=96',
    end: '+=300%',
    pin: scene,
    scrub: true,
    onUpdate: (self) => {
      const index = Math.min(3, Math.floor(self.progress * 4));
      setActive(index);
      if (progress) {
        progress.style.transform = `scaleY(${self.progress})`;
      }
    },
  });
}

function initAdminParallax() {
  if (reducedMotion) return;

  gsap.utils.toArray<HTMLElement>('[data-float-card]').forEach((card, index) => {
    gsap.to(card, {
      yPercent: index % 2 === 0 ? -6 : 6,
      ease: 'none',
      scrollTrigger: {
        trigger: card,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  });
}

function initVerticalPanels() {
  if (reducedMotion) return;

  gsap.utils.toArray<HTMLElement>('[data-vertical-panel] .vertical-visual').forEach((panel) => {
    gsap.from(panel, {
      scale: 1.06,
      opacity: 0.88,
      duration: 0.9,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: panel,
        start: 'top 78%',
        once: true,
      },
    });
  });
}

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
    });
  });
}

function init() {
  initNav();
  initLazyVideos();
  initHeroReveal();
  initScrollReveals();
  initReferralScene();
  initAdminParallax();
  initVerticalPanels();
  initMailtoForm();
}

init();

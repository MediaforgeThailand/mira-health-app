import { chatScript, type ChatStep } from '../data/chat-script';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

class ChatSimulator {
  private readonly root: HTMLElement;
  private readonly stream: HTMLElement;
  private visible = true;
  private stopped = false;

  constructor(root: HTMLElement) {
    const stream = root.querySelector<HTMLElement>('[data-chat-stream]');
    if (!stream) {
      throw new Error('ChatSim stream is missing');
    }

    this.root = root;
    this.stream = stream;
    this.bindVisibility();
  }

  start() {
    if (prefersReducedMotion) {
      this.renderInstant();
      return;
    }

    void this.loop();
  }

  private bindVisibility() {
    const observer = new IntersectionObserver(
      ([entry]) => {
        this.visible = entry?.isIntersecting ?? true;
      },
      { rootMargin: '220px 0px' },
    );

    observer.observe(this.root);
  }

  private async loop() {
    while (!this.stopped) {
      this.clear();

      for (const step of chatScript) {
        await this.waitForVisible();
        await this.renderStep(step);
        await sleep(step.type === 'mira' ? 500 : 1200);
      }

      await sleep(2000);
      this.stream.classList.add('is-resetting');
      await sleep(400);
      this.stream.classList.remove('is-resetting');
    }
  }

  private async waitForVisible() {
    while (!this.visible) {
      await sleep(250);
    }
  }

  private async renderStep(step: ChatStep) {
    if (step.type === 'mira') {
      const bubble = this.createBubble('mira');
      bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
      this.append(bubble);
      await sleep(600);
      bubble.textContent = '';
      await this.typeText(bubble, step.text);
      return;
    }

    this.append(this.createStepElement(step));
  }

  private renderInstant() {
    this.clear();
    for (const step of chatScript) {
      this.append(this.createStepElement(step));
    }
  }

  private async typeText(element: HTMLElement, text: string) {
    const chars = Array.from(text);
    for (const char of chars) {
      element.textContent = `${element.textContent ?? ''}${char}`;
      this.scrollToBottom();
      await sleep(36);
    }
  }

  private createStepElement(step: ChatStep) {
    switch (step.type) {
      case 'chip': {
        const chip = document.createElement('div');
        chip.className = `chat-item chat-chip ${step.tone === 'status' ? 'status' : ''}`;
        chip.textContent = step.text;
        return chip;
      }
      case 'user': {
        const bubble = this.createBubble('user');
        bubble.textContent = step.text;
        return bubble;
      }
      case 'mira': {
        const bubble = this.createBubble('mira');
        bubble.textContent = step.text;
        return bubble;
      }
      case 'products': {
        const stack = document.createElement('div');
        stack.className = 'chat-item product-stack';
        for (const item of step.items) {
          const card = document.createElement('article');
          card.className = 'product-card';
          card.innerHTML = `
            <strong>${item.name}</strong>
            <span class="price">${item.price}</span>
            <span class="sample-badge">${item.badge}</span>
          `;
          stack.append(card);
        }
        return stack;
      }
      case 'order': {
        const card = document.createElement('article');
        card.className = 'chat-item order-card';
        card.innerHTML = `
          <div>
            <strong>${step.title}</strong>
            ${step.lines.map((line) => `<p>${line}</p>`).join('')}
          </div>
          <div class="qr-tile" aria-hidden="true">${step.qrLabel}</div>
        `;
        return card;
      }
      case 'toast': {
        const toast = document.createElement('div');
        toast.className = 'chat-item toast-card';
        toast.textContent = step.text;
        return toast;
      }
    }
  }

  private createBubble(role: 'user' | 'mira') {
    const bubble = document.createElement('div');
    bubble.className = `chat-item ${role}`;
    return bubble;
  }

  private append(element: HTMLElement) {
    this.stream.append(element);
    this.scrollToBottom();
  }

  private clear() {
    this.stream.replaceChildren();
  }

  private scrollToBottom() {
    this.stream.scrollTop = this.stream.scrollHeight;
  }
}

for (const root of document.querySelectorAll<HTMLElement>('[data-chat-sim]')) {
  new ChatSimulator(root).start();
}

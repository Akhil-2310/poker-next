// Animation styles for poker actions

const actionAnimations = `
  @keyframes actionFloat {
    0% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateY(-60px) scale(0.8);
    }
  }

  @keyframes chipBounce {
    0%, 100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.15);
    }
  }

  @keyframes buttonPulse {
    0%, 100% {
      box-shadow: 0 0 20px rgba(255, 255, 255, 0.5);
    }
    50% {
      box-shadow: 0 0 40px rgba(255, 255, 255, 0.8);
    }
  }

  @keyframes callFlash {
    0%, 100% {
      background: linear-gradient(135deg, #00BFFF 0%, #00FFFF 100%);
    }
    50% {
      background: linear-gradient(135deg, #00FFFF 0%, #00FFFF 100%);
      filter: brightness(1.3);
    }
  }

  @keyframes betGlow {
    0%, 100% {
      box-shadow: 0 0 20px rgba(0, 255, 136, 0.6);
    }
    50% {
      box-shadow: 0 0 40px rgba(0, 255, 200, 1);
    }
  }

  @keyframes foldFade {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0.4;
      transform: scale(0.9);
    }
  }

  @keyframes winPulse {
    0%, 100% {
      transform: scale(1);
      filter: brightness(1);
    }
    50% {
      transform: scale(1.1);
      filter: brightness(1.2);
    }
  }

  @keyframes cardFlip {
    0% {
      transform: rotateY(0) scale(1);
      opacity: 1;
    }
    50% {
      transform: rotateY(90deg) scale(1.05);
    }
    100% {
      transform: rotateY(0) scale(1);
      opacity: 1;
    }
  }

  @keyframes revealCard {
    0% {
      transform: translateY(-20px) rotateY(90deg);
      opacity: 0;
    }
    50% {
      transform: translateY(-10px) rotateY(45deg);
    }
    100% {
      transform: translateY(0) rotateY(0);
      opacity: 1;
    }
  }

  @keyframes slideDown {
    0% {
      opacity: 0;
      transform: translateY(-60px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes fadeIn {
    0% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }

  @keyframes slideUp {
    0% {
      opacity: 0;
      transform: translateY(60px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .card-flip {
    animation: cardFlip 2.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  }

  .card-reveal {
    animation: revealCard 2s ease-out;
  }

  .action-call {
    animation: callFlash 0.6s ease-in-out !important;
  }

  .action-bet {
    animation: betGlow 0.8s ease-in-out !important;
  }

  .action-fold {
    animation: foldFade 0.5s ease-in-out forwards !important;
  }

  .action-float {
    animation: actionFloat 1.5s ease-out forwards;
    position: fixed;
    pointer-events: none;
    font-weight: bold;
    font-size: 20px;
    text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
    z-index: 999;
  }

  .chip-bounce {
    animation: chipBounce 0.6s ease-in-out;
  }

  .win-pulse {
    animation: winPulse 0.8s ease-in-out;
  }
`

export function injectAnimationStyles() {
  if (typeof document === 'undefined') return

  const styleEl = document.createElement('style')
  styleEl.textContent = actionAnimations
  document.head.appendChild(styleEl)
}

export function createFloatingText(text: string, x: number, y: number, color: string = '#00FFCC') {
  const el = document.createElement('div')
  el.textContent = text
  el.className = 'action-float'
  el.style.left = x + 'px'
  el.style.top = y + 'px'
  el.style.color = color
  document.body.appendChild(el)

  setTimeout(() => el.remove(), 1500)
}

export function animateButton(element: HTMLElement, animationName: string) {
  if (!element) return
  element.classList.remove(animationName)
  // Trigger reflow to restart animation
  void element.offsetWidth
  element.classList.add(animationName)
}

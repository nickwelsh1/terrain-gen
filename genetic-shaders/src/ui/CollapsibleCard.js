// Reusable BEM collapsible card component.
//   const card = createCard({ title: 'Core Noise', icon: '🌊', open: true });
//   container.append(card.el);  card.body.append(...controls);
export function createCard({ title, icon = '', open = true } = {}) {
  const el = document.createElement('section');
  el.className = 'control-card' + (open ? '' : ' control-card--collapsed');

  const header = document.createElement('button');
  header.className = 'control-card__header';
  header.type = 'button';

  if (icon) {
    const iconEl = document.createElement('span');
    iconEl.className = 'control-card__icon';
    iconEl.textContent = icon;
    header.append(iconEl);
  }

  const titleEl = document.createElement('span');
  titleEl.className = 'control-card__title';
  titleEl.textContent = title;
  header.append(titleEl);

  const badgesEl = document.createElement('span');
  badgesEl.className = 'control-card__badges';
  header.append(badgesEl);

  const chevron = document.createElement('span');
  chevron.className = 'control-card__chevron';
  chevron.textContent = '▾';
  header.append(chevron);

  const body = document.createElement('div');
  body.className = 'control-card__body';

  header.addEventListener('click', () => {
    el.classList.toggle('control-card--collapsed');
  });

  el.append(header, body);

  return {
    el,
    body,
    header,
    badgesEl,
    setOpen(isOpen) {
      el.classList.toggle('control-card--collapsed', !isOpen);
    },
    isOpen() {
      return !el.classList.contains('control-card--collapsed');
    },
  };
}

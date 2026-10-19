/**
 * The ready-made looks the couple can pick in the editor. A design sets the
 * fonts, the frame around the photos and a few section styles (in
 * styles.css under [data-design]); picking one in the editor also loads its
 * colours, which can then be changed freely.
 */
export type FrameShape = 'arch' | 'mihrab' | 'oval' | 'deco' | 'pill';

export interface Design {
  id: string;
  name: string;
  description: string;
  colours: { navy: string; ivory: string; mist: string; gold: string };
  frame: FrameShape;
  /** The garden drawing on the opening screen is shown at night. */
  night: boolean;
  /** Google Fonts families, as written in the css2 query. */
  fonts: string[];
}

const BASE_FONTS = ['Amiri:wght@400;700', 'Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500', 'Montserrat:wght@400;500'];

export const DESIGNS: Design[] = [
  {
    id: 'royal',
    name: 'Royal Navy',
    description: 'Midnight navy, ivory and champagne gold with a garden arch and sheer curtains.',
    colours: { navy: '#0e1b3d', ivory: '#fbf7ef', mist: '#d6e2ee', gold: '#c6a46a' },
    frame: 'arch',
    night: false,
    fonts: [...BASE_FONTS, 'Pinyon+Script'],
  },
  {
    id: 'emerald',
    name: 'Emerald Mihrab',
    description: 'Deep emerald with Islamic star patterns, a pointed mihrab frame and classic capitals.',
    colours: { navy: '#0f3b2e', ivory: '#f8f5ec', mist: '#dbe7dc', gold: '#c9a45c' },
    frame: 'mihrab',
    night: false,
    fonts: [...BASE_FONTS, 'Cinzel:wght@400;500;600', 'Great+Vibes'],
  },
  {
    id: 'rose',
    name: 'Rose Blush',
    description: 'Soft blush and burgundy with an oval cameo frame and romantic italics.',
    colours: { navy: '#5b2333', ivory: '#fdf7f4', mist: '#f2dcdc', gold: '#c4956a' },
    frame: 'oval',
    night: false,
    fonts: [...BASE_FONTS, 'Playfair+Display:ital,wght@0,400;0,500;1,400;1,500', 'Parisienne'],
  },
  {
    id: 'midnight',
    name: 'Midnight Gold',
    description: 'A starry black opening, art deco frame and gold accents on champagne.',
    colours: { navy: '#14141c', ivory: '#f7f2e8', mist: '#e9e0cf', gold: '#c39b4a' },
    frame: 'deco',
    night: true,
    fonts: [...BASE_FONTS, 'Marcellus', 'Pinyon+Script'],
  },
  {
    id: 'pearl',
    name: 'Pearl Minimal',
    description: 'Clean white space, sage and slate, with fine lines and light lettering.',
    colours: { navy: '#2f3b3a', ivory: '#fcfcfa', mist: '#e5ebe6', gold: '#a3a07f' },
    frame: 'pill',
    night: false,
    fonts: [...BASE_FONTS, 'Italiana', 'Mrs+Saint+Delafield'],
  },
];

export const DEFAULT_DESIGN = DESIGNS[0];

/** Frame outlines in a 300 × 400 box, used both to cut the photo and to draw the gold line. */
export const FRAME_PATHS: Record<FrameShape, string> = {
  arch: 'M0 400V150A150 150 0 0 1 300 150V400Z',
  mihrab: 'M0 400V175C0 105 88 70 150 0C212 70 300 105 300 175V400Z',
  oval: 'M150 0C233 0 300 90 300 200S233 400 150 400 0 310 0 200 67 0 150 0Z',
  deco: 'M30 0H270L300 30V370L270 400H30L0 370V30Z',
  pill: 'M0 150A150 150 0 0 1 300 150V250A150 150 0 0 1 0 250Z',
};

export function designById(id: string): Design {
  return DESIGNS.find((design) => design.id === id) ?? DEFAULT_DESIGN;
}

export function fontsUrl(design: Design): string {
  return `https://fonts.googleapis.com/css2?${design.fonts.map((family) => `family=${family}`).join('&')}&display=swap`;
}

/** The frame as a CSS mask image. */
export function frameMask(design: Design): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" preserveAspectRatio="none"><path d="${FRAME_PATHS[design.frame]}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

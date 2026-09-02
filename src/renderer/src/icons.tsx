/**
 * Icônes reprises du canvas : tracé sur une grille 256, contour uniquement,
 * `currentColor` pour suivre l'état du bouton qui les porte.
 *
 * Inline plutôt qu'une police d'icônes ou une dépendance : il y en a huit, la
 * CSP interdit toute ressource distante, et un SVG hérite de la couleur.
 */

type Props = { size?: number; className?: string };

function Icon({ size = 17, width = 18, children, className }: Props & { width?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconSearch = (p: Props) => (
  <Icon {...p}>
    <circle cx="112" cy="112" r="80" />
    <path d="M168 168l56 56" strokeLinecap="round" />
  </Icon>
);

export const IconDownload = (p: Props) => (
  <Icon {...p}>
    <path
      d="M128 32v120M84 108l44 44 44-44M40 176v32a8 8 0 008 8h160a8 8 0 008-8v-32"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Icon>
);

/** Viseur — réticule. Sert l'entrée de navigation « Prochainement ». */
export const IconSight = (p: Props) => (
  <Icon {...p}>
    <circle cx="128" cy="128" r="88" />
    <path d="M128 24v40M128 192v40M24 128h40M192 128h40" />
  </Icon>
);

export const IconSound = (p: Props) => (
  <Icon {...p}>
    <path d="M104 184H48a8 8 0 01-8-8v-48a8 8 0 018-8h56l48-40v144z" strokeLinejoin="round" />
    <path d="M192 96a40 40 0 010 64" strokeLinecap="round" />
  </Icon>
);

export const IconClose = (p: Props) => (
  <Icon width={22} {...p}>
    <path d="M56 56l144 144M200 56L56 200" strokeLinecap="round" />
  </Icon>
);

export const IconChevronLeft = (p: Props) => (
  <Icon width={22} {...p}>
    <path d="M160 208L80 128l80-80" strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);

export const IconChevronRight = (p: Props) => (
  <Icon width={22} {...p}>
    <path d="M96 48l80 80-80 80" strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);

export const IconInfo = (p: Props) => (
  <Icon width={20} {...p}>
    <circle cx="128" cy="128" r="96" />
    <path d="M128 80v56M128 172h.1" strokeLinecap="round" />
  </Icon>
);

export const IconFolder = (p: Props) => (
  <Icon {...p}>
    <path
      d="M32 200V64a8 8 0 018-8h60l24 32h68a8 8 0 018 8v104a8 8 0 01-8 8H40a8 8 0 01-8-8z"
      strokeLinejoin="round"
    />
  </Icon>
);

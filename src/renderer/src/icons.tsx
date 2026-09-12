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

/**
 * Haut-parleur. Le tracé précédent n'était pas centré — son corps allait de
 * y=120 à 184 mais le cône descendait à 224, si bien qu'à 16 px l'icône
 * paraissait tomber hors de son bouton et ne se lisait plus.
 *
 * Ici tout est symétrique autour de y=128 : le corps occupe 96→160, le cône
 * s'ouvre de 48 à 208, et les deux ondes sont des arcs concentriques.
 */
export const IconSound = (p: Props) => (
  <Icon {...p}>
    <path d="M92 96L144 48v160l-52-48H48V96z" strokeLinejoin="round" />
    <path d="M176 100a34 34 0 010 56M204 78a60 60 0 010 100" strokeLinecap="round" />
  </Icon>
);

/**
 * Réglages audio : un haut-parleur et trois curseurs.
 *
 * Un engrenage avec un haut-parleur en médaillon avait été essayé d'abord :
 * propre en grand, illisible à 16 px, où le haut-parleur se réduit à un point.
 * Deux symboles ne tiennent pas dans seize pixels, c'est une limite du format.
 *
 * Les curseurs disent « réglages » aussi bien qu'une roue dentée, et mieux
 * encore ce que fait la page : attribuer chaque emplacement à un mod. Chacun
 * des deux symboles garde la place de se lire.
 */
export const IconAudioSettings = (p: Props) => (
  <Icon width={16} {...p}>
    <path d="M84 100L128 60v136l-44-40H48v-56z" strokeLinejoin="round" />
    <path d="M168 72h56M168 128h20M168 184h56" strokeLinecap="round" />
    <circle cx="212" cy="128" r="16" />
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

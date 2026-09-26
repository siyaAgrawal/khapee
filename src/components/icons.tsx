/**
 * The few marks the furniture needs, drawn rather than typed.
 *
 * An emoji is somebody else's drawing, at somebody else's weight, in somebody
 * else's colour — and a screen with five of them in its chrome reads as a
 * mock-up rather than as a product. These are one stroke weight, they take
 * their colour from the text beside them, and they all sit on the same square,
 * so a row of them lines up without anything being nudged.
 *
 * The food keeps its emoji: that art is the colour on the page and is meant to
 * look hand-placed. This is only for the buttons and labels around it.
 */

type IconProps = { size?: number; className?: string }

function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function PinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 14.5s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0c0 3.3 4.5 7.5 4.5 7.5Z" />
      <circle cx="8" cy="6.9" r="1.6" />
    </Svg>
  )
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 11.5V7.3a4 4 0 0 1 8 0v4.2l1 1.3H3l1-1.3Z" />
      <path d="M6.6 14a1.6 1.6 0 0 0 2.8 0" />
    </Svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="m10.5 10.5 3 3" />
    </Svg>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.6 14.4 13.4H1.6L8 2.6Z" />
      <path d="M8 6.6v3.1" />
      <path d="M8 11.7h.01" />
    </Svg>
  )
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8h9.4" />
      <path d="M9 4.6 12.4 8 9 11.4" />
    </Svg>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.4v1.5M8 13.1v1.5M1.4 8h1.5M13.1 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
    </Svg>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.3 9.5A5.7 5.7 0 0 1 6.5 2.7a5.8 5.8 0 1 0 6.8 6.8Z" />
    </Svg>
  )
}

export function PeopleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6.2" cy="6" r="2.4" />
      <path d="M1.9 13.4c0-2.2 1.9-3.6 4.3-3.6s4.3 1.4 4.3 3.6" />
      <path d="M11 4.1a2.4 2.4 0 0 1 0 4.5" />
      <path d="M12.2 10.3c1.2.5 1.9 1.5 1.9 3.1" />
    </Svg>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.8v7.4" />
      <path d="M4.9 7.4 8 10.5l3.1-3.1" />
      <path d="M3 13h10" />
    </Svg>
  )
}

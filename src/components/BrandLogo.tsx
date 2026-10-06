'use client';

import Image from 'next/image';

interface Props {
  slug: string;
  name: string;
  src?: string | null;
  size: 'sm' | 'md' | 'lg';
}

const SIZE_MAP = {
  sm: { w: 32, h: 32 },
  md: { w: 44, h: 44 },
  lg: { w: 64, h: 64 },
};

export function BrandLogo({ slug, name, src, size = 'md' }: Props) {
  const { w, h } = SIZE_MAP[size];
  const initial = name.slice(0, 1).toUpperCase();
  const hue = slug.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const bgColor = `hsl(${hue}, 65%, 45%)`;

  return (
    <span
      className="shrink-0 overflow-hidden rounded-none border border-white/10 bg-[color-mix(in_srgb,var(--elevated)_70%,transparent)]"
      style={{ width: w, height: h }}
      aria-hidden
    >
      {src ? (
        <Image
          src={src}
          alt=""
          width={w}
          height={h}
          className="h-full w-full object-contain p-1"
          priority={size === 'lg'}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center text-white font-medium"
          style={{ fontSize: size === 'sm' ? 10 : size === 'md' ? 14 : 20, background: bgColor }}
        >
          {initial}
        </span>
      )}
    </span>
  );
}
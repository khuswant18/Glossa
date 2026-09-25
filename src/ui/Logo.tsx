/** Brand mark: three lines of text with the middle one selected. */
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#dceeb1" />
      <rect x="5" y="6" width="14" height="2.2" rx="1.1" fill="#181a20" opacity=".35" />
      <rect x="5" y="10.9" width="14" height="2.2" rx="1.1" fill="#181a20" />
      <rect x="5" y="15.8" width="9" height="2.2" rx="1.1" fill="#181a20" opacity=".35" />
    </svg>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <LogoMark size={size} />
      <span style={{ fontWeight: 700, fontSize: Math.round(size * 0.8), letterSpacing: '-0.2px', color: 'var(--text-strong)' }}>
        Glossa
      </span>
    </span>
  );
}

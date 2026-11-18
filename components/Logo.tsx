import { BRAND } from "@/lib/config";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0B3D2E" />
      <path d="M9 22V10l14 12V10" stroke="#C6F24E" strokeWidth="2.6" fill="none" strokeLinecap="square" />
    </svg>
  );
}

/** `compact` drops the wordmark on the narrowest phones, where the header needs the room. */
export default function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className={`font-display text-xl font-semibold tracking-tight text-ink ${compact ? "hidden min-[380px]:inline" : ""}`}>{BRAND.wordmark}</span>
    </span>
  );
}

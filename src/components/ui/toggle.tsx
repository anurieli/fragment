"use client";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-[22px] w-[40px] shrink-0 cursor-pointer items-center rounded-full
        overflow-hidden transition-colors duration-200 ease-in-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50
        disabled:cursor-not-allowed disabled:opacity-50
        ${checked ? "bg-gold" : "bg-surface-3 border border-border-strong"}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-4 w-4 rounded-full shadow-sm
          transition-all duration-200 ease-in-out
          ${checked
            ? "translate-x-[21px] bg-bg"
            : "translate-x-[3px] bg-text-muted"
          }
        `}
      />
    </button>
  );
}

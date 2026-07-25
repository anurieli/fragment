"use client";

import { useEffect } from "react";
import { User } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useDeviceId } from "@/hooks/use-device-id";
import { identify } from "@/lib/convex-client";

export function UserProfileSection() {
  const { settings, updateUserProfile } = useSettingsStore();
  const profile = settings.userProfile;
  const deviceId = useDeviceId();

  // Debounced Convex identify when profile changes
  useEffect(() => {
    const timer = setTimeout(() => {
      identify({
        deviceId,
        name: profile.displayName || undefined,
        email: profile.email || undefined,
        profileSource: "settings",
      }).catch(() => {
        // Non-critical — user experience is unaffected
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, [deviceId, profile.displayName, profile.email]);

  const initials = profile.displayName
    ? profile.displayName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "";

  return (
    <div className="h-full w-full bg-surface rounded-[var(--radius-xl)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-3 shrink-0">
        <User size={14} className="text-text-muted" />
        <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider font-[family-name:var(--font-mono)]">
          Profile
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {/* Avatar + name */}
        <div className="flex flex-col items-center py-5">
          <div className="w-20 h-20 rounded-full bg-surface-3 border border-border-strong flex items-center justify-center mb-3">
            {initials ? (
              <span className="text-xl font-medium text-text-secondary">
                {initials}
              </span>
            ) : (
              <User size={28} className="text-text-faint" />
            )}
          </div>
          <span className="text-sm text-text-secondary font-medium">
            {profile.displayName || "Your Name"}
          </span>
          {profile.bio && (
            <span className="text-[11px] text-text-muted mt-1 text-center max-w-[250px]">
              {profile.bio}
            </span>
          )}
        </div>

        <div className="space-y-4">
          {/* Display Name */}
          <Field
            label="Display Name"
            value={profile.displayName}
            onChange={(v) => updateUserProfile({ displayName: v })}
            placeholder="Your name"
          />

          {/* Bio */}
          <div>
            <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
              Bio
            </label>
            <textarea
              value={profile.bio}
              onChange={(e) => updateUserProfile({ bio: e.target.value })}
              placeholder="A short description about yourself"
              rows={3}
              className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150 resize-y leading-relaxed"
            />
          </div>

          {/* Website */}
          <Field
            label="Website"
            value={profile.website}
            onChange={(v) => updateUserProfile({ website: v })}
            placeholder="https://yoursite.com"
          />

          {/* Twitter / X */}
          <Field
            label="Twitter / X"
            value={profile.twitterHandle}
            onChange={(v) => updateUserProfile({ twitterHandle: v })}
            placeholder="@handle"
          />

          {/* LinkedIn */}
          <Field
            label="LinkedIn"
            value={profile.linkedinUrl}
            onChange={(v) => updateUserProfile({ linkedinUrl: v })}
            placeholder="linkedin.com/in/you"
          />

          {/* Location */}
          <Field
            label="Location"
            value={profile.location}
            onChange={(v) => updateUserProfile({ location: v })}
            placeholder="City, Country"
          />

          {/* Substack publication URL */}
          <Field
            label="Substack Publication"
            value={profile.substackPublicationUrl}
            onChange={(v) => updateUserProfile({ substackPublicationUrl: v })}
            placeholder="https://yourname.substack.com"
            helper="Powers the Substack composer link and publish verification for Share."
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  helper,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Optional one-line hint rendered under the input. */
  helper?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150"
      />
      {helper && <p className="mt-1 text-[10px] text-text-faint">{helper}</p>}
    </div>
  );
}

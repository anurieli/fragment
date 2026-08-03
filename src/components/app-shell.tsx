"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Puzzle } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore } from "@/stores/settings-store";
import { usePersistence } from "@/hooks/use-persistence";
import { useAutoSave } from "@/hooks/use-auto-save";
import { useDeviceId } from "@/hooks/use-device-id";
import { useLogSync } from "@/hooks/use-log-sync";
import { useFeedbackSync } from "@/hooks/use-feedback-sync";
import { useCodexConnection } from "@/hooks/use-codex-connection";
import { useCloudSync } from "@/hooks/use-cloud-sync";
import { useAgentInbox } from "@/hooks/use-agent-inbox";
import { usePublishVerification } from "@/hooks/use-publish-verification";
import { identify } from "@/lib/cloud-client";
import { initPostHog } from "@/lib/posthog";
import { initSentry, setSentryUser } from "@/lib/sentry";
import { Sidebar } from "./sidebar/sidebar";
import { IdeaPanel, IdeaPanelToggle } from "./idea/idea-panel";
import { Editor } from "./editor/editor";
import { HelperBar } from "./helper-bar/helper-bar";
import { SpaceToggle } from "./shortform/space-toggle";
import { ShortformView } from "./shortform/shortform-view";
import { TimelinePanel } from "./timeline/timeline-panel";
import { SettingsNav, type SettingsSection } from "./settings/settings-nav";
import { UserProfileSection } from "./settings/user-profile-section";
import { BrandVoiceSection } from "./settings/brand-voice/brand-voice-section";
import { ImageGenerationSection } from "./settings/image-generation-section";
import { AiSection } from "./settings/ai-section";
import { IntegrationsSection } from "./settings/integrations-section";
import { ApiLogsSection } from "./settings/api-logs-section";
import { AccountSection } from "./settings/account-section";
import { GlobalSearch } from "./search/global-search";
import { ToastContainer } from "./ui/toast";
import { HelpOverlay } from "./help/help-overlay";
import { FloatingDragCard } from "./floating-drag-card";
import { OnboardingFlow } from "./onboarding/onboarding-flow";
import { ConnectGate } from "./ai-connect/connect-gate";
import { useToastStore } from "@/hooks/use-toast";

const COMPACT_BREAKPOINT = 960;
const MIN_SUPPORTED_WIDTH = 768;

export function AppShell() {
  usePersistence();
  useAutoSave();
  const deviceId = useDeviceId();
  useLogSync();
  useFeedbackSync();
  useCodexConnection();
  // Cloud sync. A no-op until someone signs in, so this costs nothing in the
  // local-only setup that is still the default way to run Fragment.
  useCloudSync();
  // Polls the local agent inbox and imports pending pieces. `refreshInbox` /
  // `ingressAvailable` are intentionally unused here — no UI affordance yet
  // (see ARI-154); the hook stays consumable for whoever adds one.
  useAgentInbox();
  // Polls the user's Substack RSS feed while any piece/note is awaiting
  // publish confirmation (see src/lib/publish/substack-verify.ts).
  usePublishVerification();
  const hydrated = useDataStore((s) => s.hydrated);
  const [loadingStuck, setLoadingStuck] = useState(false);

  // Global Cmd+R / Ctrl+R → reload WebView (Tauri doesn't bind this by default)
  useEffect(() => {
    function handleReload(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        window.location.reload();
      }
    }
    window.addEventListener("keydown", handleReload);
    return () => window.removeEventListener("keydown", handleReload);
  }, []);

  // Loading timeout: if hydration takes >8s, offer a retry button
  useEffect(() => {
    if (hydrated) return;
    const timer = setTimeout(() => setLoadingStuck(true), 8000);
    return () => clearTimeout(timer);
  }, [hydrated]);

  // Identify this install to the backend + PostHog after hydration
  useEffect(() => {
    if (!hydrated) return;

    const settings = useSettingsStore.getState();
    const profile = settings.settings.userProfile;

    identify({
      deviceId,
      platform: "macos",
      appVersion: "1.0.0",
      name: profile.displayName || undefined,
      email: profile.email || undefined,
      profileSource: "settings",
    }).catch(() => {
      // Non-critical — user experience is unaffected
    });

    try {
      initSentry();
      setSentryUser(deviceId);
    } catch {
      // Non-critical — Sentry failure must not affect the app
    }

    try {
      initPostHog(deviceId);
    } catch {
      // Non-critical — telemetry failure must not affect the app
    }
  }, [hydrated, deviceId]);

  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const helperBarOpen = useAppStore((s) => s.helperBarOpen);
  const helperBarPinned = useAppStore((s) => s.helperBarPinned);
  const timelineOpen = useAppStore((s) => s.timelineOpen);
  const activeNoteId = useAppStore((s) => s.activeNoteId);
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const ideaSpace = useAppStore((s) => (activeIdeaId ? s.ideaSpaces[activeIdeaId] ?? "write" : "write"));
  const setIdeaSpace = useAppStore((s) => s.setIdeaSpace);
  const ideaPanelOpen = useAppStore((s) => s.ideaPanelOpen);
  const setIdeaPanelOpen = useAppStore((s) => s.setIdeaPanelOpen);
  const isFeedbackOpen = useAppStore((s) => s.isFeedbackOpen);
  const closeFeedback = useAppStore((s) => s.closeFeedback);
  const toggleHelperBar = useAppStore((s) => s.toggleHelperBar);
  const toggleTimeline = useAppStore((s) => s.toggleTimeline);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setHelperBarOpen = useAppStore((s) => s.setHelperBarOpen);
  const pinHelperBar = useAppStore((s) => s.pinHelperBar);
  const closeHelperBar = useAppStore((s) => s.closeHelperBar);
  const isDraggingToHelper = useAppStore((s) => s.isDraggingToHelper);
  const isDraggingToEditor = useAppStore((s) => s.isDraggingToEditor);
  const setTimelinePreviewVersionId = useAppStore((s) => s.setTimelinePreviewVersionId);
  const createVersion = useDataStore((s) => s.createVersion);

  const [showSettings, setShowSettingsRaw] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("fragment:showSettings") === "true";
  });
  const [settingsSection, setSettingsSectionRaw] = useState<SettingsSection>(() => {
    if (typeof window === "undefined") return "writing";
    return (localStorage.getItem("fragment:settingsSection") as SettingsSection) || "writing";
  });
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("fragment:onboardingComplete") !== "true";
  });
  const [isCompact, setIsCompact] = useState(false);
  const [isTooSmall, setIsTooSmall] = useState(false);

  // Compact + minimum-size detection — runs on mount and resize (avoids SSR mismatch)
  useEffect(() => {
    const handleResize = () => {
      setIsCompact(window.innerWidth < COMPACT_BREAKPOINT);
      setIsTooSmall(window.innerWidth < MIN_SUPPORTED_WIDTH);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Persist sidebar open state across sessions
  useEffect(() => {
    const saved = localStorage.getItem("fragment:sidebarOpen");
    if (saved !== null) setSidebarOpen(saved === "true");
  }, [setSidebarOpen]);

  useEffect(() => {
    localStorage.setItem("fragment:sidebarOpen", String(sidebarOpen));
  }, [sidebarOpen]);

  // Same treatment for the idea workspace column
  useEffect(() => {
    const saved = localStorage.getItem("fragment:ideaPanelOpen");
    if (saved !== null) setIdeaPanelOpen(saved === "true");
  }, [setIdeaPanelOpen]);

  // A narrow window can't hold sidebar + idea workspace + editor without
  // crushing the editor, so opening an idea there hands the left rail to the
  // workspace. ⌘\ brings the sidebar back; this only fires when the idea or
  // compactness changes, never fighting a deliberate re-open.
  useEffect(() => {
    if (isCompact && activeIdeaId && ideaPanelOpen) setSidebarOpen(false);
  }, [isCompact, activeIdeaId, ideaPanelOpen, setSidebarOpen]);

  useEffect(() => {
    localStorage.setItem("fragment:ideaPanelOpen", String(ideaPanelOpen));
  }, [ideaPanelOpen]);

  // ─── Snippets panel hover-reveal system ────────────────────────────────────
  //
  // The snippets panel (helper bar) opens on hover and collapses when the mouse
  // leaves — in both compact (overlay) and full-screen (flex child) modes.
  //
  // Flow:
  //   1. Mouse enters pull-tab  → clearHoverTimer + setHelperBarOpen(true)
  //   2. Mouse moves into panel → clearHoverTimer (cancel any pending close)
  //   3. Mouse leaves panel     → scheduleOverlayClose (300 ms debounce)
  //   4. Timer fires            → setHelperBarOpen(false) → panel collapses
  //
  // The debounce prevents accidental collapse when the pointer briefly crosses
  // the gap between the tab and the panel edge during natural mouse movement.
  //
  // Compact mode only: the overlay is also dismissed by clicking outside it
  // (mousedown listener in the click-outside effect below) and by Escape.
  // Dragging from the editor sets isDraggingToHelper, which keeps the panel
  // open as the drop target regardless of helperBarOpen state.
  // ────────────────────────────────────────────────────────────────────────────
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const scheduleOverlayClose = useCallback(() => {
    if (helperBarPinned || isDraggingToEditor) return;
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => setHelperBarOpen(false), 300);
  }, [helperBarPinned, isDraggingToEditor, clearHoverTimer, setHelperBarOpen]);

  // Pull-tab: entering opens the panel immediately and cancels any close timer
  const handleTabMouseEnter = useCallback(() => {
    clearHoverTimer();
    setHelperBarOpen(true);
  }, [clearHoverTimer, setHelperBarOpen]);

  const handleTabMouseLeave = useCallback(() => {
    scheduleOverlayClose();
  }, [scheduleOverlayClose]);

  // Panel body: entering cancels a pending close; leaving starts the timer
  const handleOverlayMouseEnter = useCallback(() => {
    clearHoverTimer();
  }, [clearHoverTimer]);

  const handleOverlayMouseLeave = useCallback(() => {
    scheduleOverlayClose();
  }, [scheduleOverlayClose]);

  // Click outside to close compact overlay
  useEffect(() => {
    if (!isCompact || !helperBarOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        closeHelperBar();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCompact, helperBarOpen, closeHelperBar]);

  const setShowSettings = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setShowSettingsRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      localStorage.setItem("fragment:showSettings", String(next));
      return next;
    });
  }, []);

  const setSettingsSection = useCallback((s: SettingsSection) => {
    setSettingsSectionRaw(s);
    localStorage.setItem("fragment:settingsSection", s);
  }, []);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem("fragment:onboardingComplete", "true");
    setShowOnboarding(false);
  }, []);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === "s" && !e.shiftKey) {
        e.preventDefault();
        if (activeNoteId) {
          createVersion(activeNoteId, "Quick save", "manual");
          useToastStore.getState().showToast("Snapshot saved");
        }
        return;
      }

      if (meta && e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        toggleTimeline();
        return;
      }

      if (meta && (e.key === "1" || e.key === "2")) {
        if (activeIdeaId) {
          e.preventDefault();
          setIdeaSpace(activeIdeaId, e.key === "1" ? "write" : "pieces");
        }
        return;
      }

      if (meta && e.key === "h") {
        e.preventDefault();
        toggleHelperBar();
        return;
      }

      if (meta && e.shiftKey && e.key === "f") {
        e.preventDefault();
        setShowGlobalSearch(true);
        return;
      }

      if (meta && e.key === "/") {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      if (meta && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      if (e.key === "Escape") {
        if (showOnboarding) { completeOnboarding(); return; }
        if (useAppStore.getState().aiGate) { useAppStore.getState().closeAiGate(); return; }
        if (isFeedbackOpen) { closeFeedback(); return; }
        if (showHelp) { setShowHelp(false); return; }
        const previewId = useAppStore.getState().timelinePreviewVersionId;
        if (previewId) { setTimelinePreviewVersionId(null); return; }
        if (showSettings) { setShowSettings(false); return; }
        if (showGlobalSearch) { setShowGlobalSearch(false); return; }
        if (isCompact && helperBarOpen) { closeHelperBar(); return; }
      }
    },
    [
      toggleHelperBar, toggleTimeline, toggleSidebar, activeNoteId, createVersion,
      setTimelinePreviewVersionId, showSettings, showGlobalSearch, showHelp,
      showOnboarding, completeOnboarding,
      isCompact, helperBarOpen, closeHelperBar,
      isFeedbackOpen, closeFeedback,
      activeIdeaId, setIdeaSpace,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!hydrated) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg">
        <div className="text-text-faint font-[family-name:var(--font-mono)] text-[11px] tracking-wider">
          Loading...
        </div>
        {loadingStuck && (
          <button
            onClick={() => window.location.reload()}
            className="text-text-faint hover:text-accent font-[family-name:var(--font-mono)] text-[11px] tracking-wider underline underline-offset-2 transition-colors"
          >
            Taking too long? Click to reload
          </button>
        )}
      </div>
    );
  }

  if (isTooSmall) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-bg px-8 text-center">
        <h1 className="font-[family-name:var(--font-heading)] text-2xl text-text">
          Fragment is designed for desktop
        </h1>
        <p className="max-w-sm text-sm text-text-muted leading-relaxed">
          This app needs a wider screen to work properly. Please resize your browser window or switch to a desktop device.
        </p>
        <p className="font-[family-name:var(--font-mono)] text-[11px] text-text-faint tracking-wider">
          Minimum width: {MIN_SUPPORTED_WIDTH}px
        </p>
      </div>
    );
  }

  const showRightPanelCompact = !showSettings && (helperBarOpen || timelineOpen || isDraggingToHelper);

  return (
    <>
      <div className="relative h-screen overflow-hidden bg-bg p-3">
        <div className="flex h-full gap-2 overflow-hidden">
          {/* Left panel: sidebar or settings nav */}
          <div
            className="transition-all duration-300 ease-out overflow-hidden shrink-0"
            style={{ width: showSettings ? 220 : sidebarOpen ? 300 : 0 }}
          >
            {showSettings ? (
              <SettingsNav
                activeSection={settingsSection}
                onSelect={setSettingsSection}
                onClose={() => setShowSettings(false)}
              />
            ) : (
              <Sidebar
                onOpenSettings={() => setShowSettings(true)}
                onOpenAccount={() => { setSettingsSection("account"); setShowSettings(true); }}
                onOpenAI={() => { setSettingsSection("ai"); setShowSettings(true); }}
                onOpenHelp={() => setShowHelp(true)}
                onOpenLogs={() => { setSettingsSection("logs"); setShowSettings(true); }}
              />
            )}
          </div>

          {/* Idea workspace: a second column, only while an idea is open.
              The sidebar navigates across ideas; this shows what's inside the
              one you're in (drafts + pieces), with the writing surface to its
              right. Collapsible, same width animation as the sidebar. */}
          <div
            className="transition-all duration-300 ease-out overflow-hidden shrink-0"
            style={{ width: !showSettings && activeIdeaId && ideaPanelOpen ? 268 : 0 }}
          >
            {activeIdeaId && <IdeaPanel ideaId={activeIdeaId} />}
          </div>

          {/* Center panel: editor, short-form feed, or settings content.
              Write <-> Pieces follows the same center-swap precedent as
              showSettings, one level down — scoped to the active idea
              instead of the whole app (see SpaceToggle / ShortformView). */}
          <main className="flex-1 min-w-0 flex flex-col bg-surface rounded-[var(--radius-xl)] overflow-hidden">
            {showSettings ? (
              <>
                {settingsSection === "account" && <AccountSection />}
                {settingsSection === "profile" && <UserProfileSection />}
                {settingsSection === "writing" && <BrandVoiceSection />}
                {settingsSection === "photos" && <ImageGenerationSection />}
                {settingsSection === "ai" && <AiSection />}
                {settingsSection === "integrations" && <IntegrationsSection />}
                {settingsSection === "logs" && <ApiLogsSection />}
              </>
            ) : activeIdeaId && ideaSpace === "pieces" ? (
              <ShortformView ideaId={activeIdeaId} />
            ) : (
              <Editor
                onOpenAISettings={() => { setSettingsSection("ai"); setShowSettings(true); }}
                leftToolbarSlot={
                  activeIdeaId ? (
                    <>
                      <IdeaPanelToggle />
                      <SpaceToggle ideaId={activeIdeaId} />
                    </>
                  ) : undefined
                }
              />
            )}
          </main>

          {/* Right panel (non-compact): timeline or helper bar as flex child.
              Width animates open/closed. Mouse enter/leave trigger the same
              hover-reveal logic as the compact overlay so the panel behaves
              consistently at any window size. isDraggingToHelper auto-reveals
              the panel when the user drags from the editor, even if it was
              closed, so there is always a visible drop target. */}
          {!isCompact && (
            <div
              className={`overflow-hidden shrink-0 ${isDraggingToHelper ? "" : "transition-all duration-300 ease-out"}`}
              style={{ width: !showSettings && (helperBarOpen || timelineOpen || isDraggingToHelper) ? 340 : 0 }}
              onMouseEnter={handleOverlayMouseEnter}
              onMouseLeave={handleOverlayMouseLeave}
            >
              {(timelineOpen && !helperBarPinned && !isDraggingToHelper) ? <TimelinePanel /> : <HelperBar />}
            </div>
          )}
        </div>

        {/* Compact overlay: the snippets panel rendered as an absolutely
            positioned layer so it never squeezes the editor. It slides in
            from the right via translate-x and is clipped by the parent's
            overflow-hidden. Mouse enter/leave drive the hover-reveal cycle
            with a 300 ms debounce (see scheduleOverlayClose). During a drag
            isDraggingToHelper keeps the overlay visible as the drop target;
            once the drag ends the overlay collapses if helperBarOpen is still
            false. */}
        {isCompact && (
          <div
            ref={overlayRef}
            className={`absolute top-3 right-3 bottom-3 z-20 w-[340px] overflow-hidden rounded-[var(--radius-xl)] shadow-2xl transition-transform duration-300 ease-out ${
              showRightPanelCompact ? "translate-x-0" : "translate-x-[120%]"
            }`}
            onMouseEnter={handleOverlayMouseEnter}
            onMouseLeave={handleOverlayMouseLeave}
          >
            {(timelineOpen && !helperBarPinned && !isDraggingToHelper) ? <TimelinePanel /> : <HelperBar />}
          </div>
        )}

        {/* Pull-tab: a puzzle-icon handle pinned to the right screen edge.
            Visible in both compact and full-screen modes whenever the snippets
            panel is closed. Hovering opens the panel (handleTabMouseEnter
            clears any pending close timer and calls setHelperBarOpen(true));
            moving the mouse away starts the 300 ms close timer. When the
            panel opens the tab slides off-screen to the right and loses
            pointer-events so it cannot interfere with the open panel.
            rounded-l-xl gives it a "drawer handle" silhouette. */}
        {!showSettings && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 right-0 z-30
              flex flex-col items-center gap-1.5 py-5 px-[7px]
              bg-surface-2 border border-border border-r-0 rounded-l-xl
              cursor-pointer hover:bg-surface-hover
              transition-all duration-300 ease-out
              ${(helperBarOpen || timelineOpen || (isCompact && isDraggingToHelper))
                ? "translate-x-full opacity-0 pointer-events-none"
                : "translate-x-0 opacity-100"}`}
            onMouseEnter={handleTabMouseEnter}
            onMouseLeave={handleTabMouseLeave}
            onClick={pinHelperBar}
          >
            <Puzzle size={13} className="text-text-muted" />
          </div>
        )}
      </div>

      {/* Modals */}
      {showOnboarding && (
        <OnboardingFlow onComplete={completeOnboarding} />
      )}
      {showGlobalSearch && (
        <GlobalSearch onClose={() => setShowGlobalSearch(false)} />
      )}
      {showHelp && (
        <HelpOverlay onClose={() => setShowHelp(false)} />
      )}

      <ToastContainer />
      <FloatingDragCard />
      <ConnectGate />
    </>
  );
}

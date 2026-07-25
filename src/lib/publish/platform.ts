// Platforms supported by the copy-for-platform / composer flows in this
// directory. Deliberately distinct from `ContentFormat` in
// src/lib/content-engine/contract.ts: that type also covers long-form
// authoring formats (essay, script, other) that never get copied to a
// social platform, and it has no "html" (generic clean-HTML export) case.
// Medium is explicitly out of scope for this feature.

export const PUBLISH_PLATFORMS = ["substack", "linkedin", "tweet", "html"] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

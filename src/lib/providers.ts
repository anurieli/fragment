import { Cloud, HardDrive, Sparkles, Bot, Brain, Compass } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PROVIDER_IDS, getProviderConfig } from "./ai/provider-runtime";
import type { AIProvider } from "./ai/provider-runtime";

// Re-export the canonical provider identity from the pure runtime module so
// existing imports (`@/lib/providers`) keep working. The runtime owns the
// wire-format config; this module owns the UI-facing metadata (icons, copy).
export type { AIProvider } from "./ai/provider-runtime";
export { PROVIDER_IDS, isAIProvider } from "./ai/provider-runtime";

export interface ProviderDefinition {
  id: AIProvider;
  name: string;
  icon: LucideIcon;
  authType: "api-key" | "oauth" | "none";
  description: string;
  defaultModel: string;
  chatEndpoint: string;
  /** Where the user obtains an API key (api-key providers). */
  getKeyUrl?: string;
  /** Short label for the "get a key" link. */
  getKeyLabel?: string;
  /** Placeholder shown in the API key input. */
  keyPlaceholder?: string;
}

export const PROVIDER_REGISTRY: Record<AIProvider, ProviderDefinition> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    icon: Cloud,
    authType: "api-key",
    description:
      "Access hundreds of AI models (GPT, Claude, Gemini, Llama, and more) through one API key. Pay per use — no subscription required.",
    defaultModel: "google/gemini-2.0-flash-001",
    chatEndpoint: getProviderConfig("openrouter").chatEndpoint,
    getKeyUrl: "https://openrouter.ai/keys",
    getKeyLabel: "Get one at openrouter.ai",
    keyPlaceholder: "sk-or-... paste your API key here",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    icon: Bot,
    authType: "api-key",
    description:
      "Use GPT-5.4 and other OpenAI models directly with your own OpenAI API key. Billed by OpenAI per use.",
    defaultModel: "gpt-4o-mini",
    chatEndpoint: getProviderConfig("openai").chatEndpoint,
    getKeyUrl: "https://platform.openai.com/api-keys",
    getKeyLabel: "Get one at platform.openai.com",
    keyPlaceholder: "sk-... paste your OpenAI API key here",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    icon: Compass,
    authType: "api-key",
    description:
      "Add your Perplexity API key for search-grounded Sonar models — great for research-backed writing.",
    defaultModel: "sonar",
    chatEndpoint: getProviderConfig("perplexity").chatEndpoint,
    getKeyUrl: "https://www.perplexity.ai/settings/api",
    getKeyLabel: "Get one at perplexity.ai",
    keyPlaceholder: "pplx-... paste your Perplexity API key here",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    icon: Brain,
    authType: "api-key",
    description:
      "Use Claude (Opus, Sonnet, Haiku) directly with your own Anthropic API key. Billed by Anthropic per use.",
    defaultModel: "claude-sonnet-4-5",
    chatEndpoint: getProviderConfig("anthropic").chatEndpoint,
    getKeyUrl: "https://console.anthropic.com/settings/keys",
    getKeyLabel: "Get one at console.anthropic.com",
    keyPlaceholder: "sk-ant-... paste your Anthropic API key here",
  },
  codex: {
    id: "codex",
    name: "ChatGPT",
    icon: Sparkles,
    authType: "oauth",
    description:
      "Sign in with your ChatGPT account to use OpenAI's latest models — no API key needed. Works with any paid ChatGPT plan, starting at $20/month.",
    defaultModel: "gpt-5.4-mini",
    chatEndpoint: getProviderConfig("codex").chatEndpoint,
  },
  ollama: {
    id: "ollama",
    name: "Local (Ollama)",
    icon: HardDrive,
    authType: "none",
    description:
      "Run AI models locally on your machine — free, private, no account needed.",
    defaultModel: "llama3",
    chatEndpoint: getProviderConfig("ollama").chatEndpoint,
  },
};

export function getProvider(id: AIProvider): ProviderDefinition {
  return PROVIDER_REGISTRY[id];
}

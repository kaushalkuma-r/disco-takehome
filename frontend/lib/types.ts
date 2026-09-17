/** API types — mirror backend/app/schemas/domain.py. */

export interface ClarityQuestion { q: string; opts: string[]; multi?: boolean }
export interface ParsedBrief {
  product: string; buyer: string; price_tier: string; price_point_usd: number | null; business_model: string;
  categories: string[]; differentiators: string[]; is_consumer_commerce: boolean;
}
export interface ClarityResult {
  score: number; label: "Vague" | "Usable" | "Clear"; summary: string; signals: string[]; missing: string[];
  questions: ClarityQuestion[]; parsed_brief: ParsedBrief; answers: string[];
}
export interface ScoreBreakdown { category: number; persona: number; aov: number; audience: number }
export interface PublisherScore { id: string; score: number; prescore: number; llm_delta: number; bd: ScoreBreakdown; why: string }
export interface ExcludedPublisher { id: string; score: number; why: string }
export interface PersonaPick { id: string; fit: number; why: string }
export interface SkippedPersona { id: string; why: string }
export interface Creative { persona_id: string; headline: string; body: string; cta: string; rationale: string; assumptions?: string[] }
export interface Allocation { publisher_id: string; pct: number }
export interface CampaignConfig {
  objective: string; primary_kpi: string;
  bid: { strategy: string; cpm_range_usd: string; cpc_range_usd: string; rationale: string };
  budget: { daily_usd: number; total_usd: number; currency: string; pacing: string };
  flight: { start: string; end: string };
  targeting: { age_range: string; gender: string; income_tiers: string[]; geos: string[]; interests: string[]; exclude_contexts: string[] };
  allocation: Allocation[]; frequency_cap: Record<string, unknown>; attribution: Record<string, unknown>;
}
export type CampaignStatus = "generating" | "draft" | "needs_review" | "ready" | "failed";
export interface Campaign {
  id: string; user_id: string; thread_id: string | null; parent_campaign_id: string | null; name: string; brief: string;
  clarity: ClarityResult; parsed_brief: ParsedBrief; publishers: PublisherScore[]; excluded: ExcludedPublisher[];
  personas: PersonaPick[]; skipped_personas: SkippedPersona[]; creatives: Creative[]; config: CampaignConfig | null;
  status: CampaignStatus; version: number; created_at: string; updated_at: string;
}
export interface ValidationResult { check: string; severity: "error" | "warning"; passed: boolean; message: string; target: Record<string, string>; repair_tool: string | null }
export interface CreditsInfo { charged: number; base: number; usage: number; balance: number }
export interface MutationResponse { campaign: Campaign; validation: ValidationResult[]; credits: CreditsInfo }

export interface CampaignListItem {
  id: string; name: string; brief: string; status: CampaignStatus; version: number; created_at: string; updated_at: string; parent_campaign_id: string | null;
  clarity_score: number; top_publisher: PublisherScore | null; budget_total: number | null; checks_passing: number; checks_total: number; creatives: number;
}
export interface Me { user: { id: string; email: string; name: string }; credit_balance: number; campaigns_count: number; preferences_count: number; facts_count: number; examples: string[] }
export interface Publisher {
  id: string; name: string; category: string; subcategories: string[]; monthly_impressions: number; avg_order_value_usd: number;
  audience: { age_skew: string; gender_split: Record<string, number>; top_geos: string[]; income_tier: string }; notes: string;
}
export interface Persona {
  id: string; name: string; age_range: string; gender_skew: string; description: string; category_affinities: string[]; price_sensitivity: string;
  messaging_preferences: string[]; disinterested_in: string[]; typical_aov_usd: number;
}
export interface Catalog { publishers: Publisher[]; personas: Persona[] }
export interface StageEvent { stage: string; status: "run" | "done" | "fail"; detail: string; ms: number }
export interface YieldEvent { kind: "thought" | "tool_card" | "tool_event" | "head_text" | "turn_end"; event_id: string; parent_id?: string; status?: "running" | "completed" | "failed"; title?: string; detail?: string; tool?: string }
export interface LedgerRow { id: string; created_at: string; reason: string; delta: number; usage: { total_tokens: number; mix: string } | null; balance_after: number; campaign_id: string | null; campaign_name: string | null; interaction_kind: string | null }
export interface CreditsPage { balance: number; grant: number; pricing: { base: Record<string, number>; tokens_per_credit: number; model_weight: Record<string, number> }; ledger: LedgerRow[]; consistent: boolean }
export interface Memory { preferences: Record<string, unknown>; sources: Record<string, { source: string; at: string }>; facts: { id: string; text: string; source: string; campaign_id: string | null; created_at: string | null }[]; keys: Record<string, string> }
export interface ChatCard { type: string; [k: string]: unknown }
export interface ChatTurn { thread_id: string; campaign_id: string | null; reply: string; cards: ChatCard[]; credits: CreditsInfo; validation: ValidationResult[] }
export interface ChatMessage { role: "user" | "assistant" | "tool"; content: { text?: string }; cards: ChatCard[]; created_at: string }
export interface ActivityRow { id: string; kind: string; mode: string; status: string; created_at: string; credits: number; duration_ms: number | null; input: Record<string, unknown>; change_note: string | null }
export interface FeedbackRow { target_kind: string; target_id: string; vote: "up" | "down"; comment: string | null; created_at: string }
export interface CompareResult { a: Campaign; b: Campaign; publishers: { publisher_id: string; name: string; a: number | null; b: number | null; delta: number | null }[]; creatives: { persona_id: string; a: string | null; b: string }[] }

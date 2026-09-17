from datetime import datetime, timezone
from uuid import uuid4

from app.agent.memory import MemoryBlock, extract_candidates
from app.agent.validators import CHECK_IDS, run_all
from app.billing.pricing import estimate, tokens_to_credits
from app.catalog import load_catalog
from app.llm.usage import CallUsage, Usage
from app.schemas.domain import (Allocation, Bid, Budget, Campaign, CampaignConfig, ClarityResult, Creative, ExcludedPublisher,
                                Flight, ParsedBrief, PersonaPick, PublisherScore, ScoreBreakdown, Targeting)


def campaign(**over) -> Campaign:
    now = datetime.now(timezone.utc)
    bd = ScoreBreakdown(category=90, persona=90, aov=90, audience=90)
    base = dict(
        id=uuid4(), user_id=uuid4(), name="Dog food", brief="premium senior dog food",
        clarity=ClarityResult(score=90, label="Clear", summary="s", parsed_brief=ParsedBrief()), parsed_brief=ParsedBrief(),
        publishers=[PublisherScore(id="pub_007", score=94, prescore=94, bd=bd, why="Pet publisher with subscription-heavy audience that pays premiums."),
                    PublisherScore(id="pub_009", score=88, prescore=88, bd=bd, why="Largest pet audience in the catalog with repeat purchase behaviour."),
                    PublisherScore(id="pub_018", score=71, prescore=71, bd=bd, why="Millennial dog-as-family audience; playful voice converts best here.")],
        excluded=[ExcludedPublisher(id="pub_013", why="Beauty audience 18–34 with no pet affinity at all; wrong context.")],
        personas=[PersonaPick(id="persona_004", fit=97, why="w")],
        creatives=[Creative(persona_id="persona_004", headline="Vet-formulated for the years that matter most.",
                            body="Grain-free, joint-supporting nutrition built for senior dogs. Every ingredient on the label, nothing hidden.", cta="See the formula")],
        config=CampaignConfig(objective="subscription_signup", primary_kpi="CPA ≤ $38",
                              bid=Bid(strategy="target_cpa", cpm_range_usd="$14–$22", cpc_range_usd="$1.10–$1.90"),
                              budget=Budget(daily_usd=400, total_usd=12000), flight=Flight(start="2026-10-01", end="2026-10-31"),
                              targeting=Targeting(age_range="30–55", gender="All", income_tiers=["mid-high"], geos=["US-West"], interests=["pet_food"]),
                              allocation=[Allocation(publisher_id="pub_007", pct=40), Allocation(publisher_id="pub_009", pct=40), Allocation(publisher_id="pub_018", pct=20)]),
        created_at=now, updated_at=now)
    base.update(over)
    return Campaign(**base)


def failing(results):
    return {r.check: r for r in results if not r.passed}


def test_clean_campaign_passes_all_checks():
    res = run_all(campaign(), load_catalog(), MemoryBlock())
    assert len(res) == 11 and not failing(res)


def test_allocation_must_sum_to_100():
    c = campaign()
    c.config.allocation[0].pct = 30
    f = failing(run_all(c, load_catalog(), MemoryBlock()))
    assert "alloc_sums_100" in f and f["alloc_sums_100"].repair_tool == "build_config"


def test_cap_45_warns():
    c = campaign()
    c.config.allocation = [Allocation(publisher_id="pub_007", pct=60), Allocation(publisher_id="pub_009", pct=40)]
    assert failing(run_all(c, load_catalog(), MemoryBlock()))["alloc_cap_45"].severity == "warning"


def test_excluded_in_allocation_is_error():
    c = campaign()
    c.config.allocation[2] = Allocation(publisher_id="pub_013", pct=20)
    assert "no_excluded_in_alloc" in failing(run_all(c, load_catalog(), MemoryBlock()))


def test_creative_lengths():
    c = campaign()
    c.creatives[0].headline = "x" * 81
    f = failing(run_all(c, load_catalog(), MemoryBlock()))
    assert f["creative_lengths"].target == {"persona_id": "persona_004"}


def test_disinterest_terms_warn():
    c = campaign()
    c.creatives[0].body = "A generic pet brand for everyone, cheap and cheerful, nothing special about it at all really."
    assert "creative_avoids_disinterest" in failing(run_all(c, load_catalog(), MemoryBlock()))


def test_brand_voice_preference_enforced():
    c = campaign()
    c.creatives[0].headline = "Best food ever!"
    mem = MemoryBlock(preferences={"brand_voice": "understated, no exclamation marks"})
    assert "creative_uses_preference" in failing(run_all(c, load_catalog(), mem))


def test_banned_publisher_is_error():
    mem = MemoryBlock(preferences={"banned_publishers": ["pub_009"]})
    f = failing(run_all(campaign(), load_catalog(), mem))
    assert f["banned_publishers"].target == {"publisher_id": "pub_009"}


def test_budget_sanity():
    c = campaign()
    c.config.budget.daily_usd = 100
    assert "budget_sanity" in failing(run_all(c, load_catalog(), MemoryBlock()))


def test_check_ids_stable():
    assert CHECK_IDS == ["alloc_sums_100", "alloc_cap_45", "no_excluded_in_alloc", "min_publishers", "reason_present", "creative_lengths",
                         "creative_avoids_disinterest", "creative_uses_preference", "persona_fit_floor", "budget_sanity", "banned_publishers"]


def test_tokens_to_credits_weights_strong_model_double():
    u = Usage(calls=[CallUsage(tool="rank", model="gpt-4.1-mini", total_tokens=4000), CallUsage(tool="creative", model="gpt-4.1", total_tokens=4000)])
    assert tokens_to_credits(u) == 3  # 4000*1 + 4000*2 = 12000 / 4000
    assert tokens_to_credits(Usage()) == 0
    assert estimate("generate_campaign") == {"action": "generate_campaign", "base": 10, "est_usage": 2, "total": 12}


def test_memory_render_and_extraction():
    mem = MemoryBlock(preferences={"brand_voice": "no exclamation marks", "banned_publishers": ["pub_001"]})
    txt = mem.render({"pub_001": "Swiftcart"})
    assert "Swiftcart" in txt and "hard constraint" in txt
    names = {"pub_001": "Swiftcart", "pub_009": "Ruffco"}
    assert extract_candidates("never use Swiftcart again", names) == [{"kind": "preference", "key": "banned_publishers", "value": ["pub_001"]}]
    assert extract_candidates("remember that our AOV is $85", names)[0] == {"kind": "fact", "text": "our AOV is $85"}
    assert extract_candidates("always keep the tone understated", names)[0]["key"] == "brand_voice"

"""Golden cases for the deterministic publisher pre-score. No network."""
from app.catalog import load_catalog
from app.schemas.domain import ParsedBrief
from app.services.scoring import prescore


def ranked(brief: ParsedBrief) -> list[str]:
    return [s.id for s in prescore(brief, load_catalog())]


DOG = ParsedBrief(product="premium grain-free senior dog food", buyer="health-conscious dog owners", price_tier="premium",
                  price_point_usd=70, business_model="subscription", categories=["pet_food", "pet_health", "subscription"])
ACTIVE = ParsedBrief(product="women's activewear from recycled ocean plastic", buyer="women who work out and care about materials",
                     price_tier="premium", price_point_usd=95, business_model="one_time", categories=["activewear", "sustainable_apparel", "women"])
SAAS = ParsedBrief(product="B2B SaaS for dental practices", buyer="dental practice managers", price_tier="unknown",
                   business_model="b2b", categories=["b2b_saas"], is_consumer_commerce=False)


def test_dog_food_ranks_pet_publishers_first():
    top = ranked(DOG)[:3]
    assert set(top) == {"pub_007", "pub_009", "pub_018"}  # Pawline, Ruffco, Tailcrate
    assert top[0] in {"pub_007", "pub_009"}


def test_dog_food_never_ranks_beauty_in_top_five():
    assert "pub_013" not in ranked(DOG)[:5]  # Velvetline


def test_activewear_ranks_movewell_first():
    assert ranked(ACTIVE)[0] == "pub_002"


def test_activewear_excludes_pet_and_impulse():
    r = ranked(ACTIVE)
    assert r.index("pub_009") > 8 and r.index("pub_001") > 8


def test_scores_are_bounded_and_sorted():
    scores = prescore(DOG, load_catalog())
    assert all(0 <= s.score <= 100 for s in scores)
    assert [s.score for s in scores] == sorted((s.score for s in scores), reverse=True)
    assert len(scores) == 20


def test_offtopic_brief_scores_everyone_low():
    scores = prescore(SAAS, load_catalog())
    assert max(s.score for s in scores) < 40


def test_breakdown_weights_sum_to_score():
    for s in prescore(DOG, load_catalog()):
        expected = round(0.35 * s.bd.category + 0.30 * s.bd.persona + 0.15 * s.bd.aov + 0.20 * s.bd.audience)
        assert s.prescore == expected

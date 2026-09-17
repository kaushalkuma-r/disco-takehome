"""The publisher / persona catalog from the take-home data pack, loaded once at startup.

Also holds the category adjacency table the deterministic scorer uses: how close two
catalog categories are when they are not literally equal (pet_food ~ pet_supplies etc.).
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field

from .config import get_settings


class Audience(BaseModel):
    age_skew: str
    gender_split: dict[str, float]
    top_geos: list[str]
    income_tier: str


class Publisher(BaseModel):
    id: str
    name: str
    category: str
    subcategories: list[str]
    monthly_impressions: int
    avg_order_value_usd: int
    audience: Audience
    notes: str

    @property
    def tags(self) -> set[str]:
        return {self.category, *self.subcategories}

    @property
    def female_share(self) -> float:
        return self.audience.gender_split.get("female", 0.5)

    @property
    def age_band(self) -> tuple[int, int]:
        return parse_age(self.audience.age_skew)


class Persona(BaseModel):
    id: str
    name: str
    age_range: str
    gender_skew: str
    description: str
    category_affinities: list[str]
    price_sensitivity: str
    messaging_preferences: list[str]
    disinterested_in: list[str]
    typical_aov_usd: int

    @property
    def age_band(self) -> tuple[int, int]:
        return parse_age(self.age_range)


class Catalog(BaseModel):
    publishers: list[Publisher]
    personas: list[Persona]
    examples: list[str] = Field(default_factory=list)

    def publisher(self, pid: str) -> Publisher:
        return next(p for p in self.publishers if p.id == pid)

    def persona(self, pid: str) -> Persona:
        return next(p for p in self.personas if p.id == pid)

    def has_publisher(self, pid: str) -> bool:
        return any(p.id == pid for p in self.publishers)

    def has_persona(self, pid: str) -> bool:
        return any(p.id == pid for p in self.personas)


def parse_age(s: str) -> tuple[int, int]:
    """'25-44' -> (25, 44); 'nationwide'/unknown -> (18, 65)."""
    try:
        lo, hi = s.split("-")
        return int(lo), int(hi)
    except ValueError:
        return 18, 65


# Category adjacency: symmetric similarity in [0, 1] for tags that are not identical.
# Curated from the catalog vocabulary; anything not listed is 0.
_ADJ: dict[frozenset[str], float] = {}


def _adj(a: str, b: str, w: float) -> None:
    _ADJ[frozenset((a, b))] = w


for a, b, w in [
    ("pet_food", "pet_supplies", 0.8), ("pet_food", "pet", 0.9), ("pet_supplies", "pet", 0.9), ("pet_health", "pet_pharmacy", 0.9),
    ("pet_health", "pet_food", 0.6), ("pet_health", "pet", 0.8), ("subscription_boxes", "subscription", 0.8), ("treats", "pet_food", 0.6),
    ("toys", "pet_supplies", 0.7), ("groceries", "pet_food", 0.3), ("organic_grocery", "organic", 0.9), ("organic_grocery", "groceries", 0.7),
    ("organic_grocery", "natural", 0.7), ("premium_grocery", "organic", 0.6), ("premium_grocery", "pantry", 0.6), ("premium_grocery", "groceries", 0.6),
    ("wellness", "wellness_services", 0.8), ("wellness", "wellness_dtc", 0.8), ("wellness", "supplements", 0.7), ("wellness", "vitamins", 0.7),
    ("wellness", "yoga", 0.7), ("wellness", "spa", 0.7), ("wellness", "fitness", 0.6), ("fitness", "fitness_classes", 0.9), ("fitness", "activewear", 0.7),
    ("fitness", "personal_training", 0.8), ("fitness_services", "fitness_classes", 0.9), ("fitness_services", "personal_training", 0.9),
    ("supplements", "vitamins", 0.9), ("supplements", "wellness_dtc", 0.7), ("recovery", "supplements", 0.5), ("recovery", "spa", 0.5),
    ("activewear", "apparel", 0.7), ("activewear", "shoes", 0.5), ("sustainable_apparel", "sustainable", 0.9), ("sustainable_apparel", "apparel", 0.7),
    ("sustainable_apparel", "activewear", 0.5), ("classic_apparel", "classic", 0.9), ("classic_apparel", "apparel", 0.8), ("classic_apparel", "workwear", 0.6),
    ("fashion", "apparel", 0.8), ("fashion", "shoes", 0.5), ("premium_basics", "basics", 0.9), ("premium_basics", "socks", 0.6), ("premium_basics", "underwear", 0.6),
    ("apparel", "women", 0.3), ("apparel", "men", 0.3), ("beauty", "skincare", 0.9), ("beauty", "makeup", 0.9), ("beauty", "haircare", 0.8),
    ("clean_beauty", "beauty", 0.8), ("clean_beauty", "skincare", 0.8), ("home_goods", "home", 0.9), ("home_goods", "bedding", 0.7), ("home_goods", "cookware", 0.7),
    ("home_goods", "kitchen", 0.7), ("home_goods", "home_textiles", 0.7), ("home_decor", "home", 0.8), ("home_decor", "home_textiles", 0.6),
    ("functional_beverages", "beverages", 0.9), ("functional_beverages", "soda_alternative", 0.8), ("functional_beverages", "gut_health", 0.7),
    ("gourmet_food", "pantry", 0.6), ("gourmet_food", "premium_grocery", 0.7), ("meal_kits", "groceries", 0.5), ("meal_kits", "convenience", 0.5),
    ("household", "cleaning", 0.7), ("household", "refillable_products", 0.5), ("refillable_products", "sustainable", 0.6), ("refillable_products", "non_toxic", 0.6),
    ("convenience", "instant_delivery", 0.9), ("quick_commerce", "instant_delivery", 0.9), ("subscription_services", "subscription", 0.9),
    ("kids_products", "family_products", 0.8), ("family_products", "household", 0.5), ("gifting", "gift", 0.9), ("gifting", "giftable", 0.9),
    ("small_batch", "candles", 0.5), ("small_batch", "home_decor", 0.4), ("candles", "home_decor", 0.6), ("candles", "home", 0.5),
    ("outerwear", "apparel", 0.7), ("outerwear", "activewear", 0.4), ("skiing", "activewear", 0.3), ("handbags", "apparel", 0.5), ("handbags", "classic", 0.4),
    ("bedding", "home", 0.8), ("linen", "bedding", 0.9), ("protein_bars", "supplements", 0.6), ("protein_bars", "convenience", 0.4), ("protein_bars", "groceries", 0.4),
    ("cleaning", "household", 0.9), ("b2b_saas", "saas", 0.9), ("supplements", "natural", 0.5), ("supplements", "organic", 0.4), ("vitamins", "natural", 0.5),
    ("wellness", "organic", 0.4), ("wellness", "natural", 0.5), ("gut_health", "supplements", 0.6), ("gut_health", "wellness", 0.7),
]:
    _adj(a, b, w)


def tag_similarity(a: str, b: str) -> float:
    if a == b:
        return 1.0
    return _ADJ.get(frozenset((a, b)), 0.0)


@lru_cache
def load_catalog() -> Catalog:
    d: Path = get_settings().data_dir
    pubs = [Publisher.model_validate(x) for x in json.loads((d / "publishers.json").read_text())]
    pers = [Persona.model_validate(x) for x in json.loads((d / "shopper_personas.json").read_text())]
    examples: list[str] = []
    ex = d / "example_advertisers.txt"
    if ex.exists():
        for line in ex.read_text().splitlines():
            line = line.strip()
            if line and line[0].isdigit() and ". " in line:
                examples.append(line.split(". ", 1)[1])
    return Catalog(publishers=pubs, personas=pers, examples=examples)

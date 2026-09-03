from decimal import Decimal

import pytest

from app.schemas.units import Dimension, Unit, UnitSystem, coerce_unit, coerce_unit_from_ai
from app.services import units as units_service


def test_convert_same_unit_is_identity() -> None:
    assert units_service.convert(Decimal("5"), Unit.G, Unit.G) == Decimal("5")


def test_convert_within_weight_dimension() -> None:
    assert units_service.convert(Decimal("1"), Unit.KG, Unit.G) == Decimal("1000")
    assert units_service.convert(Decimal("1"), Unit.LB, Unit.OZ) == Decimal("453.592") / Decimal(
        "28.3495"
    )


def test_convert_within_volume_dimension() -> None:
    assert units_service.convert(Decimal("1"), Unit.L, Unit.ML) == Decimal("1000")
    assert units_service.convert(Decimal("1"), Unit.GAL, Unit.CUP) == Decimal("3785.41") / Decimal(
        "236.588"
    )


def test_convert_across_dimensions_returns_none() -> None:
    assert units_service.convert(Decimal("1"), Unit.G, Unit.ML) is None
    assert units_service.convert(Decimal("1"), Unit.CUP, Unit.OZ) is None


def test_convert_count_is_identity_only_against_itself() -> None:
    # COUNT has exactly one member -- there's no other count-dimension unit
    # left to compare it against, unlike weight/volume where two distinct
    # recognized units can still be cross-converted.
    assert units_service.convert(Decimal("2"), Unit.COUNT, Unit.COUNT) == Decimal("2")


def test_guess_dimension_recognizes_every_unit() -> None:
    assert units_service.guess_dimension(Unit.G) == Dimension.WEIGHT
    assert units_service.guess_dimension(Unit.OZ) == Dimension.WEIGHT
    assert units_service.guess_dimension(Unit.ML) == Dimension.VOLUME
    assert units_service.guess_dimension(Unit.CUP) == Dimension.VOLUME
    assert units_service.guess_dimension(Unit.GAL) == Dimension.VOLUME
    assert units_service.guess_dimension(Unit.COUNT) == Dimension.COUNT


def test_guess_dimension_raises_for_a_non_unit_value() -> None:
    # No longer a "guess" now that Unit is a closed enum enforced by both
    # Pydantic and the `unit` Postgres column -- a value outside it reaching
    # this function is a real bug, not data to fall back gracefully from.
    with pytest.raises(KeyError):
        units_service.guess_dimension("stick")  # type: ignore[arg-type]


def test_guess_system_matches_metric_and_customary() -> None:
    assert units_service.guess_system(Unit.G) == UnitSystem.METRIC
    assert units_service.guess_system(Unit.OZ) == UnitSystem.CUSTOMARY
    assert units_service.guess_system(Unit.COUNT) is None


def test_resolve_unit_picks_the_canonical_unit_per_pair() -> None:
    assert units_service.resolve_unit(Dimension.WEIGHT, UnitSystem.METRIC) == Unit.G
    assert units_service.resolve_unit(Dimension.WEIGHT, UnitSystem.CUSTOMARY) == Unit.OZ
    assert units_service.resolve_unit(Dimension.VOLUME, UnitSystem.METRIC) == Unit.ML
    assert units_service.resolve_unit(Dimension.VOLUME, UnitSystem.CUSTOMARY) == Unit.CUP


def test_resolve_unit_for_count_ignores_system() -> None:
    assert units_service.resolve_unit(Dimension.COUNT, None) == Unit.COUNT
    assert units_service.resolve_unit(Dimension.COUNT, UnitSystem.METRIC) == Unit.COUNT


def test_resolve_unit_defaults_missing_system_to_customary() -> None:
    assert units_service.resolve_unit(Dimension.WEIGHT, None) == Unit.OZ


def test_coerce_unit_matches_exact_values_case_and_whitespace_insensitively() -> None:
    assert coerce_unit("g") == Unit.G
    assert coerce_unit("OZ") == Unit.OZ
    assert coerce_unit(" cup ") == Unit.CUP


def test_coerce_unit_matches_known_aliases() -> None:
    assert coerce_unit("pounds") == Unit.LB
    assert coerce_unit("each") == Unit.COUNT
    assert coerce_unit("fl oz") == Unit.FL_OZ
    assert coerce_unit("Gallons") == Unit.GAL


def test_coerce_unit_returns_none_for_unrecognized_or_missing() -> None:
    assert coerce_unit("stick") is None
    assert coerce_unit(None) is None
    assert coerce_unit("") is None
    assert coerce_unit("   ") is None


def test_coerce_unit_from_ai_tolerates_a_non_string_value() -> None:
    # A weak local model occasionally returns a bare JSON number/bool
    # instead of a string -- this must degrade to None, not raise.
    assert coerce_unit_from_ai(2) is None
    assert coerce_unit_from_ai(True) is None
    assert coerce_unit_from_ai(None) is None


def test_base_unit_for_dimension() -> None:
    assert units_service.base_unit_for(Dimension.WEIGHT) == Unit.G
    assert units_service.base_unit_for(Dimension.VOLUME) == Unit.ML
    assert units_service.base_unit_for(Dimension.COUNT) == Unit.COUNT


def test_to_base_and_from_base_round_trip() -> None:
    assert units_service.to_base(Decimal("1"), Unit.KG) == Decimal("1000")
    assert units_service.to_base(Decimal("2"), Unit.CUP) == Decimal("473.176")
    assert units_service.to_base(Decimal("3"), Unit.COUNT) == Decimal("3")
    # from_base is the exact inverse for a clean factor.
    assert units_service.from_base(Decimal("1000"), Unit.KG) == Decimal("1")
    assert units_service.from_base(Decimal("453.592"), Unit.LB) == Decimal("1")


def test_display_quantity_rounds_to_three_places() -> None:
    # 1 oz -> 28.3495 g stored; shown back in oz it's 1, shown in g it's
    # 28.350 (3 dp).
    assert units_service.display_quantity(Decimal("28.3495"), Unit.OZ) == Decimal("1.000")
    assert units_service.display_quantity(Decimal("28.3495"), Unit.G) == Decimal("28.350")
    assert units_service.display_quantity(Decimal("1500"), Unit.KG) == Decimal("1.5")
    assert coerce_unit_from_ai("kg") == Unit.KG

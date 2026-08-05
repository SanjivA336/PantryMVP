from decimal import Decimal

from app.schemas.units import Dimension, UnitSystem
from app.services import units as units_service


def test_convert_same_unit_is_identity() -> None:
    assert units_service.convert(Decimal("5"), "g", "g") == Decimal("5")


def test_convert_within_weight_dimension() -> None:
    assert units_service.convert(Decimal("1"), "kg", "g") == Decimal("1000")
    assert units_service.convert(Decimal("1"), "lb", "oz") == Decimal("453.592") / Decimal(
        "28.3495"
    )


def test_convert_within_volume_dimension() -> None:
    assert units_service.convert(Decimal("1"), "l", "ml") == Decimal("1000")


def test_convert_across_dimensions_returns_none() -> None:
    assert units_service.convert(Decimal("1"), "g", "ml") is None
    assert units_service.convert(Decimal("1"), "cup", "oz") is None


def test_convert_count_units_only_match_when_identical() -> None:
    assert units_service.convert(Decimal("2"), "count", "count") == Decimal("2")
    assert units_service.convert(Decimal("2"), "count", "bag") is None


def test_guess_dimension_recognizes_known_units() -> None:
    assert units_service.guess_dimension("g") == Dimension.WEIGHT
    assert units_service.guess_dimension("OZ") == Dimension.WEIGHT
    assert units_service.guess_dimension("ml") == Dimension.VOLUME
    assert units_service.guess_dimension("cup") == Dimension.VOLUME


def test_guess_dimension_defaults_unrecognized_to_count() -> None:
    assert units_service.guess_dimension("stick") == Dimension.COUNT
    assert units_service.guess_dimension("") == Dimension.COUNT


def test_guess_system_matches_metric_and_customary() -> None:
    assert units_service.guess_system("g") == UnitSystem.METRIC
    assert units_service.guess_system("oz") == UnitSystem.CUSTOMARY
    assert units_service.guess_system("bag") is None


def test_resolve_unit_picks_the_canonical_unit_per_pair() -> None:
    assert units_service.resolve_unit(Dimension.WEIGHT, UnitSystem.METRIC) == "g"
    assert units_service.resolve_unit(Dimension.WEIGHT, UnitSystem.CUSTOMARY) == "oz"
    assert units_service.resolve_unit(Dimension.VOLUME, UnitSystem.METRIC) == "ml"
    assert units_service.resolve_unit(Dimension.VOLUME, UnitSystem.CUSTOMARY) == "cup"


def test_resolve_unit_for_count_ignores_system() -> None:
    assert units_service.resolve_unit(Dimension.COUNT, None) == "count"
    assert units_service.resolve_unit(Dimension.COUNT, UnitSystem.METRIC) == "count"


def test_resolve_unit_defaults_missing_system_to_customary() -> None:
    assert units_service.resolve_unit(Dimension.WEIGHT, None) == "oz"

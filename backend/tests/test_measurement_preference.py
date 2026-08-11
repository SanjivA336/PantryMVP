import uuid
from datetime import UTC, datetime

from app.schemas.food_definition import FoodDefinition
from app.schemas.household import Household
from app.services import inventory_items as inventory_service


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeVariantQuery:
    def __init__(self, data):
        self._data = data

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def maybe_single(self):
        return self

    def update(self, values):
        self.updated = values
        return self

    def execute(self):
        return _FakeResult(self._data)


class _FakeClient:
    def __init__(self, variant_row: dict | None):
        self._variant_row = variant_row
        self.updates: list[dict] = []

    def table(self, name):
        assert name == "household_food_variants"
        query = _FakeVariantQuery(self._variant_row)
        original_update = query.update

        def update(values):
            self.updates.append(values)
            return original_update(values)

        query.update = update
        return query


def _household(**overrides) -> Household:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        name="3BR Apartment",
        address=None,
        join_code="ABCD1234",
        created_by_user_id=uuid.uuid4(),
        preferred_unit_system="CUSTOMARY",
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return Household(**defaults)


def _food(**overrides) -> FoodDefinition:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        name="Whole Milk",
        preferred_unit="ml",
        category="DAIRY_ALTERNATIVES",
        accounting_type_default="SHARED",
        shelf_life_days=None,
        freezer_shelf_life_days=None,
        common_substitutions=[],
        created_by_user_id=None,
        is_verified=True,
        usage_count=0,
        duplicate_of_id=None,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return FoodDefinition(**defaults)


def test_uses_remembered_choice_when_variant_already_has_one(monkeypatch) -> None:
    monkeypatch.setattr(
        inventory_service,
        "get_service_client",
        lambda: _FakeClient({"dimension": "WEIGHT", "unit_system": "METRIC"}),
    )

    preference = inventory_service.resolve_measurement_preference(uuid.uuid4(), uuid.uuid4())

    assert preference.dimension == "WEIGHT"
    assert preference.unit_system == "METRIC"
    assert preference.unit == "g"


def test_remembered_count_dimension_has_no_unit_system(monkeypatch) -> None:
    monkeypatch.setattr(
        inventory_service,
        "get_service_client",
        lambda: _FakeClient({"dimension": "COUNT", "unit_system": None}),
    )

    preference = inventory_service.resolve_measurement_preference(uuid.uuid4(), uuid.uuid4())

    assert preference.dimension == "COUNT"
    assert preference.unit_system is None
    assert preference.unit == "count"


def test_falls_back_to_catalog_dimension_and_household_default_when_never_tracked(
    monkeypatch,
) -> None:
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: _FakeClient(None))
    monkeypatch.setattr(
        inventory_service.food_definitions_service, "get_by_id", lambda fid: _food(
            preferred_unit="ml"
        )
    )
    monkeypatch.setattr(
        inventory_service.households_service,
        "get_household",
        lambda hh: _household(preferred_unit_system="METRIC"),
    )

    preference = inventory_service.resolve_measurement_preference(uuid.uuid4(), uuid.uuid4())

    # Dimension follows the catalog's own preferred_unit (volume, since it's
    # "ml"), but the *system* follows the household default, not whatever
    # the catalog happens to be written in.
    assert preference.dimension == "VOLUME"
    assert preference.unit_system == "METRIC"
    assert preference.unit == "ml"


def test_falls_back_to_customary_household_default(monkeypatch) -> None:
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: _FakeClient(None))
    monkeypatch.setattr(
        inventory_service.food_definitions_service, "get_by_id", lambda fid: _food(
            preferred_unit="g"
        )
    )
    monkeypatch.setattr(
        inventory_service.households_service,
        "get_household",
        lambda hh: _household(preferred_unit_system="CUSTOMARY"),
    )

    preference = inventory_service.resolve_measurement_preference(uuid.uuid4(), uuid.uuid4())

    assert preference.dimension == "WEIGHT"
    assert preference.unit_system == "CUSTOMARY"
    assert preference.unit == "oz"


def test_unrecognized_catalog_unit_falls_back_to_count_with_no_system(monkeypatch) -> None:
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: _FakeClient(None))
    monkeypatch.setattr(
        inventory_service.food_definitions_service, "get_by_id", lambda fid: _food(
            preferred_unit="stick"
        )
    )
    monkeypatch.setattr(
        inventory_service.households_service,
        "get_household",
        lambda hh: _household(preferred_unit_system="METRIC"),
    )

    preference = inventory_service.resolve_measurement_preference(uuid.uuid4(), uuid.uuid4())

    assert preference.dimension == "COUNT"
    assert preference.unit_system is None
    assert preference.unit == "count"


def test_remember_measurement_choice_records_dimension_and_system(monkeypatch) -> None:
    fake_client = _FakeClient(None)
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: fake_client)

    variant_id = uuid.uuid4()
    inventory_service._remember_measurement_choice(variant_id, "oz")

    assert fake_client.updates == [{"dimension": "WEIGHT", "unit_system": "CUSTOMARY"}]


def test_remember_measurement_choice_for_count_stores_no_system(monkeypatch) -> None:
    fake_client = _FakeClient(None)
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: fake_client)

    inventory_service._remember_measurement_choice(uuid.uuid4(), "count")

    assert fake_client.updates == [{"dimension": "COUNT", "unit_system": None}]

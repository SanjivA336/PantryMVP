from app.schemas.recipe_ai import DraftRecipeIngredient
from app.services.ai._ollama import (
    _coerce_to_list,
    _extract_json,
    _extract_json_span,
    _normalize_quantity_in_place,
)


def test_extract_json_span_plain_object() -> None:
    text = '{"name": "Pancakes", "servings": 4}'
    assert _extract_json_span(text) == text


def test_extract_json_span_with_markdown_fence() -> None:
    text = '```json\n{"name": "Pancakes"}\n```'
    assert _extract_json_span(text) == '{"name": "Pancakes"}'


def test_extract_json_span_with_preamble() -> None:
    text = 'Here is the JSON:\n{"name": "Pancakes"}'
    assert _extract_json_span(text) == '{"name": "Pancakes"}'


def test_extract_json_span_array() -> None:
    text = 'Sure, here you go: [{"name": "a"}, {"name": "b"}] Hope that helps!'
    assert _extract_json_span(text) == '[{"name": "a"}, {"name": "b"}]'


def test_extract_json_span_nested_braces() -> None:
    text = '{"outer": {"inner": 1}, "list": [1, 2, 3]}'
    assert _extract_json_span(text) == text


def test_extract_json_span_no_json_returns_none() -> None:
    assert _extract_json_span("no json here at all") is None


def test_extract_json_span_unbalanced_returns_none() -> None:
    assert _extract_json_span('{"name": "Pancakes"') is None


def test_extract_json_direct_parse() -> None:
    assert _extract_json('{"a": 1}') == {"a": 1}


def test_extract_json_falls_back_to_span_scan() -> None:
    assert _extract_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_extract_json_returns_none_for_garbage() -> None:
    assert _extract_json("not json at all") is None


def test_coerce_to_list_bare_array() -> None:
    assert _coerce_to_list([{"name": "a"}]) == [{"name": "a"}]


def test_coerce_to_list_unwraps_single_key_object() -> None:
    assert _coerce_to_list({"items": [{"name": "a"}]}) == [{"name": "a"}]


def test_coerce_to_list_rejects_multi_key_object() -> None:
    assert _coerce_to_list({"items": [{"name": "a"}], "count": 1}) is None


def test_coerce_to_list_rejects_non_list_value() -> None:
    assert _coerce_to_list({"name": "not a list"}) is None


def test_coerce_to_list_rejects_none() -> None:
    assert _coerce_to_list(None) is None


def _ingredient(quantity: str | None) -> DraftRecipeIngredient:
    return DraftRecipeIngredient(name="flour", quantity=quantity, unit="cup", note=None)


def test_normalize_quantity_plain_number_untouched() -> None:
    ingredient = _ingredient("2")
    _normalize_quantity_in_place(ingredient)
    assert ingredient.quantity == "2"
    assert ingredient.note is None


def test_normalize_quantity_decimal_untouched() -> None:
    ingredient = _ingredient("1.5")
    _normalize_quantity_in_place(ingredient)
    assert ingredient.quantity == "1.5"


def test_normalize_quantity_fraction_converted() -> None:
    ingredient = _ingredient("1/2")
    _normalize_quantity_in_place(ingredient)
    assert ingredient.quantity == "0.5"


def test_normalize_quantity_none_stays_none() -> None:
    ingredient = _ingredient(None)
    _normalize_quantity_in_place(ingredient)
    assert ingredient.quantity is None
    assert ingredient.note is None


def test_normalize_quantity_unparseable_folds_into_note() -> None:
    ingredient = _ingredient("a pinch")
    _normalize_quantity_in_place(ingredient)
    assert ingredient.quantity is None
    assert ingredient.note == "(~a pinch, as written by the AI)"


def test_normalize_quantity_unparseable_appends_to_existing_note() -> None:
    ingredient = DraftRecipeIngredient(
        name="salt", quantity="to taste", unit=None, note="kosher salt preferred"
    )
    _normalize_quantity_in_place(ingredient)
    assert ingredient.quantity is None
    assert ingredient.note == "kosher salt preferred (~to taste, as written by the AI)"


def test_normalize_quantity_zero_denominator_fraction_folds_into_note() -> None:
    ingredient = _ingredient("1/0")
    _normalize_quantity_in_place(ingredient)
    assert ingredient.quantity is None
    assert ingredient.note == "(~1/0, as written by the AI)"

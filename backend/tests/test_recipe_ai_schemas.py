from app.schemas.recipe_ai import DraftRecipe


def _base_draft(**overrides) -> dict:
    body = {
        "name": "Pancakes",
        "description": None,
        "servings": 4,
        "prep_time_minutes": 10,
        "cook_time_minutes": 15,
        "instructions": ["Mix", "Cook"],
        "ingredients": [{"name": "flour", "quantity": "2", "unit": "cup", "note": None}],
        "source_url": None,
    }
    body.update(overrides)
    return body


def test_instructions_plain_strings_pass_through() -> None:
    draft = DraftRecipe.model_validate(_base_draft(instructions=["Mix well.", "Bake it."]))
    assert draft.instructions == ["Mix well.", "Bake it."]


def test_instructions_coerces_step_wrapped_objects() -> None:
    draft = DraftRecipe.model_validate(
        _base_draft(instructions=[{"step": "Mix well."}, {"step": "Bake it."}])
    )
    assert draft.instructions == ["Mix well.", "Bake it."]


def test_instructions_coerces_object_with_no_string_value() -> None:
    draft = DraftRecipe.model_validate(_base_draft(instructions=[{"order": 1}]))
    assert draft.instructions == ["{'order': 1}"]


def test_instructions_coerces_non_string_non_dict_items() -> None:
    draft = DraftRecipe.model_validate(_base_draft(instructions=[1, 2]))
    assert draft.instructions == ["1", "2"]


def test_instructions_mixed_shapes() -> None:
    draft = DraftRecipe.model_validate(
        _base_draft(instructions=["Plain step.", {"text": "Wrapped step."}])
    )
    assert draft.instructions == ["Plain step.", "Wrapped step."]

import json
import re
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from app.core.config import get_settings
from app.schemas.purchase_session import ParsedReceiptItem
from app.schemas.recipe_ai import (
    DraftRecipe,
    DraftRecipeIngredient,
    GenerateRecipeParams,
    SubstitutionSuggestion,
)
from app.schemas.units import Unit
from app.services.ai.base import (
    AiOutputParsingError,
    AiProvider,
    AiProviderTimeoutError,
    AiProviderUnavailableError,
)

# Shared verbatim across every prompt below that asks the model for a unit,
# so it always sees the exact same closed vocabulary instead of a vague
# "a unit string" that the coercion in DraftRecipeIngredient/
# SubstitutionSuggestion/ParsedReceiptItem would otherwise have to guess at
# after the fact.
_UNIT_VOCAB = '"' + '", "'.join(u.value for u in Unit) + '"'

# Deliberately NO embedded example recipe in these prompts: an early version
# included one, and llama2 would sometimes just echo the example back
# verbatim instead of processing the actual input (confirmed by direct
# testing against the real model, not a hypothetical concern) -- small
# instruction-following models can conflate "example in the system prompt"
# with "the actual task" when the example looks like real output. A plain-
# language schema description, with no JSON blob to latch onto, tests as
# reliably following the real input instead.
_PARSE_RECIPE_SYSTEM = f"""You are a recipe-extraction assistant. Given raw recipe
text, extract it into JSON with exactly these keys: "name" (string), "description"
(string or null), "servings" (integer or null), "prep_time_minutes" (integer or
null), "cook_time_minutes" (integer or null), "instructions" (array of short step
strings, in order), "ingredients" (array of objects each with "name" (the food
only, no quantity/unit baked in), "quantity" (a decimal number as a string --
convert fractions like "1/2" to "0.5" -- or null if not stated), "unit" (one of
{_UNIT_VOCAB}, or null if not stated or if none of those fit), "note" (string or
null)). Extract from the ACTUAL recipe text the user provides. Respond with ONLY
the JSON object. No commentary, no markdown fences. Do not put ingredient lines
inside "instructions" -- ingredients belong only in the "ingredients" array. Do
not prefix each instruction string with its own step number (e.g. "1.",
"Step 2:") -- the array's order already conveys that."""

_GENERATE_RECIPE_SYSTEM = f"""You are a recipe-writing assistant. Invent an original
recipe matching the constraints the user gives you, as JSON with exactly these
keys: "name" (string), "description" (string or null), "servings" (integer or
null), "prep_time_minutes" (integer or null), "cook_time_minutes" (integer or
null), "instructions" (array of short step strings, in order), "ingredients"
(array of objects each with "name" (the food only, no quantity/unit baked in),
"quantity" (a decimal number as a string, or null), "unit" (one of {_UNIT_VOCAB},
or null if none of those fit), "note" (string or null)). Respond with ONLY the
JSON object. No commentary, no markdown fences. Do not put ingredient lines
inside "instructions" -- ingredients belong only in the "ingredients" array. Do
not prefix each instruction string with its own step number (e.g. "1.",
"Step 2:") -- the array's order already conveys that."""

_SUBSTITUTION_SYSTEM = f"""You are a cooking assistant suggesting ingredient
substitutions. Given one ingredient (with its quantity and unit, if known) plus
the rest of a recipe for context, respond with a JSON ARRAY (not a single object)
of 3 to 5 substitution objects, each with "name" (string), "quantity" (a decimal
number as a string, or null -- how much of the SUBSTITUTE is needed to match the
original ingredient's contribution, which may differ from the original amount),
"unit" (one of {_UNIT_VOCAB}, or null -- the substitute's own natural unit,
which may differ from the original ingredient's unit, e.g. counted vs weighed),
and "note" (a short reason or usage tip, under 15 words, or null).
Example shape only, do not copy this content: [{{"name": "...", "quantity": "...",
"unit": "...", "note": "..."}}, {{"name": "...", "quantity": "...", "unit": "...",
"note": "..."}}]. Respond with ONLY the JSON array. No commentary, no markdown
fences."""

_PARSE_RECEIPT_SYSTEM = f"""You are a receipt-extraction assistant. Given raw OCR
text from a grocery or retail receipt, extract every purchased line item into a
JSON ARRAY (not a single object) of objects, each with exactly these keys:
"name" (string -- the product name/description as printed, cleaned up from
obvious OCR noise but never invented), "price" (a PLAIN decimal number as a
string, with NO currency symbol and NO commas -- "4.99", never "$4.99" -- the
item's own price as printed), "quantity" (a PLAIN decimal number as a string
with nothing else attached -- "0.778", never "0.778kg NET @ $5.99/kg" -- or
null if the receipt doesn't clearly state a single number for how many/how
much of this item were bought), "unit" (one of {_UNIT_VOCAB}, or your best
guess at the closest one of those, or null if none fit). A weight/rate
breakdown line like "0.778kg NET @ $5.99/kg" printed
under an item belongs in "quantity" (just "0.778") and "unit" (just "kg"), NOT
copied verbatim into either field. Every returned item MUST have both a "name"
and a "price" -- if either is missing or unreadable for a line, leave that
line out of the array entirely rather than guessing. Do not include lines that
aren't purchased items: subtotal, tax, total, payment/card info, loyalty/
coupon lines, store name or address, cashier/register info, barcodes. Extract
only from the ACTUAL receipt text provided. Respond with ONLY the JSON array.
No commentary, no markdown fences.
Example shape only, do not copy this content: [{{"name": "...", "price": "4.99",
"quantity": "0.778", "unit": "kg"}}, {{"name": "...", "price": "1.50", "quantity":
null, "unit": null}}]."""


def _extract_json_span(text: str) -> str | None:
    """Best-effort scan for the first balanced {...} or [...] span --
    covers the common weak-model failure of wrapping otherwise-valid JSON
    in a markdown fence or a "Here is the JSON:" preamble despite
    format="json" being set. Doesn't respect string-escaping (a stray "}"
    inside a quoted string value would confuse it) -- an accepted
    limitation given this is a defensive fallback, not the primary path."""
    first_brace = text.find("{")
    first_bracket = text.find("[")
    starts = [i for i in (first_brace, first_bracket) if i != -1]
    if not starts:
        return None
    start = min(starts)
    opener = text[start]
    closer = "}" if opener == "{" else "]"
    depth = 0
    for i in range(start, len(text)):
        if text[i] == opener:
            depth += 1
        elif text[i] == closer:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _coerce_to_list(data: Any) -> list[Any] | None:
    """A weak model asked for "a JSON array" sometimes wraps it in an
    object anyway (e.g. {"items": [...]}) instead of returning the bare
    array -- even after one repair-retry, confirmed by direct testing
    against the real model. If there's exactly one dict value and it's a
    list, that's almost certainly the intended array."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and len(data) == 1:
        (value,) = data.values()
        if isinstance(value, list):
            return value
    return None


def _extract_json(text: str) -> Any:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    span = _extract_json_span(text)
    if span is None:
        return None
    try:
        return json.loads(span)
    except json.JSONDecodeError:
        return None


def _normalize_quantity_in_place(ingredient: DraftRecipeIngredient) -> None:
    """A `type="number"` input in the review form silently renders blank
    for a non-numeric value with no explanation -- so an unparseable
    quantity ("a pinch", "to taste") gets relocated into `note` instead of
    just being dropped where the user can't see it went anywhere."""
    raw = ingredient.quantity
    if raw is None or not raw.strip():
        ingredient.quantity = None
        return
    raw = raw.strip()
    try:
        float(raw)
        return
    except ValueError:
        pass
    fraction_match = re.fullmatch(r"(\d+)\s*/\s*(\d+)", raw)
    if fraction_match:
        numerator, denominator = int(fraction_match.group(1)), int(fraction_match.group(2))
        if denominator != 0:
            ingredient.quantity = str(numerator / denominator)
            return
    extra = f"(~{raw}, as written by the AI)"
    ingredient.quantity = None
    ingredient.note = f"{ingredient.note} {extra}" if ingredient.note else extra


class OllamaProvider(AiProvider):
    def parse_recipe(self, text: str, *, source_url: str | None = None) -> DraftRecipe:
        # llama2's context window is small (~4096 tokens) -- truncate well
        # before prompt+response would blow past it, rather than let Ollama
        # silently drop the tail with no error at all.
        truncated = text[:6000]
        draft = self._call_and_parse(
            system=_PARSE_RECIPE_SYSTEM, prompt=truncated, temperature=0.2, model=DraftRecipe
        )
        draft.source_url = source_url
        return self._normalize_ingredients(draft)

    def generate_recipe(self, params: GenerateRecipeParams) -> DraftRecipe:
        lines = ["Generate a recipe with these constraints:"]
        if params.cuisines:
            # The model picks one from the given options, rather than the
            # request forcing a single cuisine before generation even starts.
            lines.append(
                "- Pick ONE cuisine from this list and write the recipe in that "
                "style: " + ", ".join(params.cuisines)
            )
        if params.min_total_time_minutes and params.max_total_time_minutes:
            lines.append(
                "- Total prep+cook time MUST be between "
                f"{params.min_total_time_minutes} and {params.max_total_time_minutes} minutes"
            )
        elif params.min_total_time_minutes:
            lines.append(
                f"- Total prep+cook time MUST be at least {params.min_total_time_minutes} minutes"
            )
        elif params.max_total_time_minutes:
            lines.append(
                f"- Total prep+cook time MUST NOT exceed {params.max_total_time_minutes} minutes"
            )
        if params.dietary_restrictions:
            lines.append(
                "- MUST respect these dietary restrictions: "
                + ", ".join(params.dietary_restrictions)
            )
        if params.required_ingredients:
            lines.append(
                "- MUST include these ingredients: " + ", ".join(params.required_ingredients)
            )
        if params.pantry_only and params.available_ingredients:
            lines.append(
                "- MUST ONLY use ingredients from this list, plus basic seasonings, oil, "
                "and water if needed -- do not introduce any other new ingredient: "
                + ", ".join(params.available_ingredients)
            )
        if params.description:
            lines.append(f"- Additional request from the user: {params.description}")
        draft = self._call_and_parse(
            system=_GENERATE_RECIPE_SYSTEM,
            prompt="\n".join(lines),
            temperature=0.7,
            model=DraftRecipe,
        )
        return self._normalize_ingredients(draft)

    def suggest_substitutions(
        self,
        ingredient_name: str,
        ingredient_quantity: str | None,
        ingredient_unit: Unit | None,
        recipe_name: str | None,
        other_ingredient_names: list[str],
    ) -> list[SubstitutionSuggestion]:
        amount = " ".join(p for p in (ingredient_quantity, ingredient_unit) if p)
        lines = [
            f'Ingredient to substitute: "{ingredient_name}"'
            + (f" (amount used: {amount})" if amount else "")
        ]
        if recipe_name:
            lines.append(f'Recipe: "{recipe_name}"')
        if other_ingredient_names:
            lines.append("Other ingredients in the recipe: " + ", ".join(other_ingredient_names))
        return self._call_and_parse_list(
            system=_SUBSTITUTION_SYSTEM,
            prompt="\n".join(lines),
            temperature=0.4,
            item_model=SubstitutionSuggestion,
        )

    def parse_receipt_items(self, raw_text: str) -> list[ParsedReceiptItem]:
        # Same context-window reasoning as parse_recipe's truncation --
        # receipts are usually much shorter than a recipe page, but this
        # keeps the same safety margin rather than assuming that always.
        truncated = raw_text[:6000]
        return self._call_and_parse_list(
            system=_PARSE_RECEIPT_SYSTEM,
            prompt=truncated,
            temperature=0.1,
            item_model=ParsedReceiptItem,
        )

    # -- shared plumbing -----------------------------------------------

    def _call_ollama(self, system: str, prompt: str, temperature: float) -> str:
        settings = get_settings()
        try:
            # /api/chat (not /api/generate): keeping the schema instructions
            # in a "system" message and the actual data in its own "user"
            # message gives the model a much clearer signal about which
            # part is instruction and which part is the real task input --
            # tested directly against /api/generate's single-blob "system"
            # + "prompt" fields first, where a weak model was more prone to
            # blur the two together.
            response = httpx.post(
                f"{settings.ollama_base_url}/api/chat",
                json={
                    "model": settings.ollama_model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "format": "json",
                    # Ollama defaults to streaming NDJSON chunks -- without
                    # this, a plain response.json() call misbehaves.
                    "stream": False,
                    "options": {"temperature": temperature},
                },
                timeout=settings.ai_request_timeout_seconds,
            )
        except httpx.ConnectError as exc:
            raise AiProviderUnavailableError(
                f"Could not reach Ollama at {settings.ollama_base_url}"
            ) from exc
        except httpx.TimeoutException as exc:
            raise AiProviderTimeoutError("Ollama did not respond in time") from exc

        if response.status_code != 200:
            # e.g. the configured model isn't pulled -- Ollama returns 404
            # with {"error": "model '...' not found, try pulling it first"}
            raise AiProviderUnavailableError(
                f"Ollama returned {response.status_code}: {response.text[:300]}"
            )
        return response.json()["message"]["content"]

    def _call_and_parse(
        self, *, system: str, prompt: str, temperature: float, model: type[BaseModel]
    ) -> Any:
        raw = self._call_ollama(system, prompt, temperature)
        data = _extract_json(raw)
        validation_error: ValidationError | None = None
        if data is not None:
            try:
                return model.model_validate(data)
            except ValidationError as exc:
                validation_error = exc

        settings = get_settings()
        if not settings.ai_retry_enabled:
            raise AiOutputParsingError(f"Ollama produced unparseable output: {raw[:300]}")

        error_summary = str(validation_error) if validation_error else "not valid JSON"
        repair_prompt = (
            f"Your previous output was invalid: {error_summary}\n"
            f"Original request: {prompt}\n"
            "Return ONLY corrected JSON matching the required shape."
        )
        raw_repair = self._call_ollama(system, repair_prompt, temperature)
        repaired_data = _extract_json(raw_repair)
        if repaired_data is None:
            raise AiOutputParsingError(
                f"Ollama's repair attempt was still unparseable: {raw_repair[:300]}"
            )
        try:
            return model.model_validate(repaired_data)
        except ValidationError as exc:
            raise AiOutputParsingError(f"Ollama's repair attempt was still invalid: {exc}") from exc

    def _call_and_parse_list(
        self, *, system: str, prompt: str, temperature: float, item_model: type[BaseModel]
    ) -> list[Any]:
        raw = self._call_ollama(system, prompt, temperature)
        items = _coerce_to_list(_extract_json(raw))
        if items is None:
            settings = get_settings()
            if not settings.ai_retry_enabled:
                raise AiOutputParsingError(f"Ollama produced unparseable output: {raw[:300]}")
            repair_prompt = (
                f"Your previous output was not a JSON array.\nOriginal request: {prompt}\n"
                "Return ONLY a corrected JSON array."
            )
            raw_repair = self._call_ollama(system, repair_prompt, temperature)
            items = _coerce_to_list(_extract_json(raw_repair))
            if items is None:
                raise AiOutputParsingError(
                    f"Ollama's repair attempt was still not a JSON array: {raw_repair[:300]}"
                )
        try:
            return [item_model.model_validate(item) for item in items]
        except ValidationError as exc:
            raise AiOutputParsingError(f"Ollama produced invalid substitution data: {exc}") from exc

    def _normalize_ingredients(self, draft: DraftRecipe) -> DraftRecipe:
        for ingredient in draft.ingredients:
            _normalize_quantity_in_place(ingredient)
        return draft

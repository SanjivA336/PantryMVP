"""One-time data loader: seeds global_food_definitions with official entries.

Run from the backend/ directory: `uv run python scripts/seed_food_definitions.py`

Inserts are upserted on `name` so this script is safe to re-run — it won't
create duplicates if some entries already exist.
"""

import json
from pathlib import Path

from app.core.supabase import get_service_client


def main() -> None:
    seed_path = Path(__file__).parent / "food_definitions_seed.json"
    entries = json.loads(seed_path.read_text(encoding="utf-8"))

    client = get_service_client()
    rows = [
        {
            "name": entry["name"],
            "preferred_unit": entry["preferred_unit"],
            "food_group": entry.get("food_group"),
            "accounting_type_default": entry["accounting_type_default"],
            "shelf_life_days": entry.get("shelf_life_days"),
            "freezer_shelf_life_days": entry.get("freezer_shelf_life_days"),
            "common_substitutions": entry.get("common_substitutions", []),
            "created_by_user_id": None,
            "is_verified": True,
            "usage_count": 0,
        }
        for entry in entries
    ]

    result = (
        client.table("global_food_definitions")
        .upsert(rows, on_conflict="name", ignore_duplicates=True)
        .execute()
    )
    print(f"Seeded {len(result.data)} food definitions (of {len(rows)} in the seed file).")


if __name__ == "__main__":
    main()

"""Conservative deterministic index scope: fresh fruits, vegetables, berries, herbs and salads.

Only the price INDEX uses this classifier; actual invoice audit data is untouched.
When a new product family appears, add its prefix after verifying its category.
"""
FRESH_PRODUCE_PREFIXES = (
    "абрикос", "авокадо", "айсберг", "ананас", "апельсин", "арбуз",
    "базилик", "баклажан", "батат", "виноград", "голубик",
    "горошек сладкий", "грейпфрут", "гриб", "груш", "дайкон",
    "дын", "ежевик", "имбир", "кабач", "капуста", "картофель",
    "киви", "кинз", "клубник", "корень сельдер", "лайм", "лимон",
    "лолло росс", "лук", "малин", "морков", "мят", "нектарин",
    "огурц", "пейшен", "перец", "персик", "петруш", "помидор",
    "радич", "редис", "розмарин", "романо", "руккол", "салат",
    "свекл", "спарж", "стебель сельдер", "тимьян", "томат",
    "трава лимон", "тыкв", "укроп", "фенхел", "фризе", "хурм",
    "чеснок", "шпинат", "щавел", "эстрагон", "яблок", "черемш",
    "сельдерей", "зелень", "мангольд", "ягода",
)
NOT_FRESH_MARKERS = (
    "солен", "квашен", "маринован", "с/м", "заморож", "консерв",
    "вялен", "сушен", "пюре", "паста", "душист", "молот",
    "сироп", "готовый салат", "сухофрукт",
)


def is_fresh_produce(normalized_product_name):
    """Allow-list produce; exclude processed variants. No fuzzy product matching."""
    import re
    name = normalized_product_name
    if not name or not name.startswith(FRESH_PRODUCE_PREFIXES):
        return False
    if any(marker in name for marker in NOT_FRESH_MARKERS):
        return False
    if re.search(r"(?:^|\s)фри(?:\s|$)", name):
        return False
    return True

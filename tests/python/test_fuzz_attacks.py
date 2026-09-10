"""Tests for the attack-corpus fuzzer.

The battery is what level 5 is scored against and what the engine tests run
through, so the fuzzer's own behaviour is pinned down: that it is
deterministic, that each mutation really does what it claims, and that the
committed corpus is current.
"""

import base64
import json
import pathlib
import re
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import fuzz_attacks as fz  # noqa: E402


@pytest.fixture(scope="module")
def built():
    return fz.build()


@pytest.fixture(scope="module")
def attacks(built):
    return {a["id"]: a for a in built[0]["attacks"]}


def test_committed_corpus_is_current(built):
    attacks, benign = built
    assert json.loads(fz.ATTACKS.read_text(encoding="utf-8")) == attacks, "attacks.json is stale — run: npm run fuzz"
    assert json.loads(fz.BENIGN.read_text(encoding="utf-8")) == benign, "benign.json is stale — run: npm run fuzz"


def test_output_is_deterministic():
    assert fz.serialise(fz.build()[0]) == fz.serialise(fz.build()[0])


def test_ids_are_unique(built):
    ids = [a["id"] for a in built[0]["attacks"]]
    assert len(ids) == len(set(ids))


def test_every_seed_gets_every_applicable_mutation(attacks):
    for seed in fz.SEEDS:
        expected = ["original", *fz.TERM_MUTATIONS, "adversarial-suffix"]
        if seed["owasp"] == fz.DIRECT:
            expected += ["base64-wrapped", "payload-split"]
        for mutation in expected:
            assert f"{seed['id']}--{mutation}" in attacks, f"{seed['id']} missing {mutation}"


def test_every_language_variant_is_present(attacks):
    for lang in fz.MULTILINGUAL:
        assert attacks[f"override-ignore--lang-{lang}"]["technique"] == "multilingual"


def test_mutations_remove_the_literal_blocked_word(attacks):
    # The point of each term mutation is that a naive filter for "password"
    # no longer sees it. Case noise is the exception: case-insensitive filters
    # still catch it, which the engine tests rely on.
    for seed in fz.SEEDS:
        for mutation in ("leetspeak", "homoglyph", "zero-width", "spaced-letters"):
            text = " ".join(attacks[f"{seed['id']}--{mutation}"]["turns"])
            assert "password" not in text.lower(), f"{seed['id']}--{mutation}"


def test_homoglyphs_really_are_cyrillic(attacks):
    text = attacks["override-ignore--homoglyph"]["turns"][0]
    assert re.search(r"[Ѐ-ӿ]", text)


def test_zero_width_characters_really_are_there(attacks):
    assert "​" in attacks["override-ignore--zero-width"]["turns"][0]


def test_leetspeak_uses_digits(attacks):
    assert re.search(r"p[4a][5s]{2}w[0o]rd", attacks["override-ignore--leetspeak"]["turns"][0])
    assert re.search(r"\d", attacks["override-ignore--leetspeak"]["turns"][0])


def test_case_noise_changes_case_only(attacks):
    text = attacks["override-ignore--case-noise"]["turns"][0]
    assert text.lower() == fz.SEEDS[0]["text"].lower()
    assert text != fz.SEEDS[0]["text"]


def test_base64_payloads_decode_back_to_their_seed(attacks):
    seeds = {s["id"]: s["text"] for s in fz.SEEDS}
    for attack in attacks.values():
        if attack["mutation"] == "base64-wrapped":
            token = attack["turns"][0].rsplit(" ", 1)[1]
            assert base64.b64decode(token).decode("utf-8") == seeds[attack["seed"]]


def test_split_payloads_rejoin_to_their_seed_and_hide_the_word(attacks):
    seeds = {s["id"]: s["text"] for s in fz.SEEDS}
    for attack in attacks.values():
        if attack["mutation"] == "payload-split":
            assert len(attack["turns"]) == 2
            parts = [re.search(r"«(.*?)»", t, re.S).group(1) for t in attack["turns"]]
            assert "".join(parts) == seeds[attack["seed"]]
            assert all("password" not in t for t in attack["turns"]), attack["id"]


def test_every_attack_is_labelled_with_an_owasp_class(built):
    for attack in built[0]["attacks"]:
        assert attack["owasp"] in (fz.DIRECT, fz.INDIRECT)


def test_benign_set_contains_the_traps_a_lazy_filter_falls_for(built):
    texts = [r["text"].lower() for r in built[1]["requests"]]
    assert sum("password" in t for t in texts) >= 3
    assert any("api key" in t for t in texts)
    assert any("keyboard" in t for t in texts)
    assert any(t.startswith("ignore") for t in texts)
    assert any("summarise" in t for t in texts)


def test_battery_is_a_useful_size(built):
    assert 60 <= len(built[0]["attacks"]) <= 150
    assert len(built[1]["requests"]) >= 15

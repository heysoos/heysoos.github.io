"""
extract_weights.py — extract minimalNCA weights from .pth files to JSON

Usage:
    python extract_weights.py <path/to/model.pth> [--out <website/src/data/nca-weights/>]

Output:
    <out>/<stem>.json   — flat float array in WGSL buffer order:
                          [W1_weights (transposed) | W1_biases | W2_weights (transposed)]

The JSON file can then be loaded into nca-presets.ts via the /admin/nca page.

Weight layout (matches nca-codegen.ts):
    W1: [CHANNELS*N_FILTERS, HIDDEN]  (PyTorch stores [HIDDEN, CHANNELS*N_FILTERS, 1, 1], transposed here)
    B1: [HIDDEN]
    W2: [HIDDEN, CHANNELS]            (PyTorch stores [CHANNELS, HIDDEN, 1, 1], transposed here)
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch


def extract(pth_path: Path) -> dict:
    """Load a .pth file and return weights + config for nca-presets.ts."""
    data = torch.load(pth_path, map_location="cpu", weights_only=False)

    # Handle both raw state_dict and wrapped model
    if isinstance(data, dict) and not any(k.startswith("rule.") for k in data):
        # Might be a bare state_dict with different key names — print and bail
        print("Keys found:", list(data.keys())[:20])
        raise ValueError("Unexpected state_dict format — check keys above")

    state = data if isinstance(data, dict) else data.state_dict()

    # Expected keys from CA model (CA > rule > w1/w2)
    w1_key = next((k for k in state if "w1.weight" in k), None)
    b1_key = next((k for k in state if "w1.bias" in k), None)
    w2_key = next((k for k in state if "w2.weight" in k), None)

    if w1_key is None or b1_key is None or w2_key is None:
        print("Available keys:", list(state.keys()))
        raise ValueError(f"Could not find w1/b1/w2 — expected keys containing 'w1.weight', 'w1.bias', 'w2.weight'")

    # PyTorch Conv2d weight shape: [out_channels, in_channels, kH, kW]
    # For 1x1 conv: [HIDDEN, CHANNELS*N_FILTERS, 1, 1]
    w1 = state[w1_key].squeeze().numpy()  # [HIDDEN, CHANNELS*N_FILTERS]
    b1 = state[b1_key].numpy()            # [HIDDEN]
    w2 = state[w2_key].squeeze().numpy()  # [CHANNELS, HIDDEN]

    hidden, perception = w1.shape
    channels = w2.shape[0]
    n_filters = perception // channels

    print(f"  channels={channels}, hidden={hidden}, n_filters={n_filters}")
    print(f"  W1 shape: {w1.shape}, B1 shape: {b1.shape}, W2 shape: {w2.shape}")

    # Transpose W1 to match WGSL layout (vec4-packed on hidden dimension):
    #   WGSL W1: weights_v4[i * HIDDEN_4 + hi4]  -> row-major [PERCEPTION, HIDDEN], reinterp as vec4
    #   WGSL B1: weights_v4[W1_BIAS_OFF4 + hi4]  -> [HIDDEN_4] vec4s
    #   WGSL W2: weights_v4[W2_OFF4 + c * HIDDEN_4 + hi4]  -> row-major [CHANNELS, HIDDEN], reinterp as vec4
    # Note: W2 is stored as [CHANNELS, HIDDEN] (NOT transposed) so vec4 slices along hidden are contiguous.
    w1_t = w1.T  # [CHANNELS*N_FILTERS, HIDDEN]
    # w2 kept as-is: shape [CHANNELS, HIDDEN]

    flat = np.concatenate([w1_t.flatten(), b1, w2.flatten()]).astype(np.float32)

    # Verify layout offsets match nca-codegen.ts computeWeightLayout
    w1_bias_offset = channels * n_filters * hidden
    w2_offset = w1_bias_offset + hidden
    total = w2_offset + hidden * channels
    assert len(flat) == total, f"Length mismatch: {len(flat)} vs expected {total}"

    config = {
        "channels": int(channels),
        "hidden": int(hidden),
        "filters": {
            "identity": True,
            "sobelX": True,
            "sobelY": True,
            "laplacian": n_filters >= 4,
        },
        "activation": "relu",
        "fireRate": 0.5,
        "stepsPerFrame": 4,
        "dt": 1.0,
        "gridWidth": 256,
        "gridHeight": 256,
        "channelR": 0,
        "channelG": 1,
        "channelB": 2,
        "normalizeDisplay": False,
        "seedMode": "random",
    }

    return {
        "config": config,
        "weights": flat.tolist(),
    }


def main():
    parser = argparse.ArgumentParser(description="Extract minimalNCA weights to JSON")
    parser.add_argument("pth", type=Path, nargs="+", help=".pth model files")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("src/data/nca-weights"),
        help="Output directory (default: src/data/nca-weights)",
    )
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    for pth_path in args.pth:
        stem = pth_path.stem  # e.g. "CA_vgg16_starry" → use as id
        # Sanitise to lowercase hyphenated id
        id_ = stem.lower().replace("_", "-").replace(" ", "-")
        name = " ".join(w.capitalize() for w in id_.replace("ca-vgg16-", "").split("-"))

        print(f"\n{pth_path.name}  ->  {id_}.json")
        try:
            result = extract(pth_path)
        except Exception as e:
            print(f"  ERROR: {e}")
            continue

        out_file = args.out / f"{id_}.json"
        # Write just the weights array (config goes in the preset via admin UI)
        out_file.write_text(json.dumps(result["weights"]) + "\n", encoding="utf-8")
        print(f"  Wrote {len(result['weights'])} floats -> {out_file}")
        print(f"  Config: channels={result['config']['channels']}, hidden={result['config']['hidden']}")
        print(f"  Paste this config into /admin/nca after loading the JSON:")
        print(f"    {json.dumps(result['config'], indent=2)}")


if __name__ == "__main__":
    main()

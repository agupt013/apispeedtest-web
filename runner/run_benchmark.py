#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List
from datetime import datetime, timezone, timedelta
import logging

# Expect apispeedtest to be installed (pip install -e ../APISpeedTest) in CI or locally
from apispeedtest.cli import _load_config_from_args  # type: ignore
from apispeedtest.config import RunConfig, default_prompt
from apispeedtest.model_registry import DEFAULT_REGISTRY, list_models
from apispeedtest.latency_tester import summarize_model, ModelLatencySummary


OUTPUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"
LOGGER = logging.getLogger("apispeedtest-web")
HISTORY_RETENTION_DAYS = 365  # Keep history for 1 year


def _env(name: str, fallback: str | None = None) -> str | None:
	val = os.environ.get(name)
	return val if val is not None else fallback


def build_config_from_env() -> RunConfig:
	models_env = _env("MODELS", "all")
	if models_env == "all":
		model_keys = list(list_models(DEFAULT_REGISTRY).keys())
	else:
		model_keys = [m.strip() for m in models_env.split(",") if m.strip()]

	runs = int(_env("RUNS", "3") or 3)
	mode = _env("MODE", "both") or "both"
	request_timeout = _env("REQUEST_TIMEOUT")
	request_timeout_seconds = float(request_timeout) if request_timeout else None

	prompt = _env("PROMPT") or default_prompt()

	cfg = RunConfig(
		prompt=prompt,
		models=model_keys,
		runs=runs,
		mode=mode,
		request_timeout_seconds=request_timeout_seconds,
		model_overrides={},
	)
	cfg.validate()
	return cfg


def write_meta(path: Path, cfg: RunConfig, timestamp: str = None, error_message: str | None = None) -> Dict[str, Any]:
	meta: Dict[str, Any] = {
		"generated_at": timestamp or datetime.now(timezone.utc).isoformat(),
		"runs": cfg.runs,
		"mode": cfg.mode,
		"models": cfg.models,
		"request_timeout_seconds": cfg.request_timeout_seconds,
	}
	if error_message:
		meta["error_message"] = error_message
	path.write_text(json.dumps(meta, indent=2))
	return meta


def _result_to_dict(r: ModelLatencySummary) -> Dict[str, Any]:
	# Mirror apispeedtest.write_json structure
	return {
		"key": r.key,
		"provider": r.provider,
		"model": r.model,
		"nonstreaming_avg_s": r.nonstreaming_avg_s,
		"nonstreaming_runs": [vars(x) for x in r.nonstreaming_runs],
		"streaming_ttfb_avg_s": r.streaming_ttfb_avg_s,
		"streaming_total_avg_s": r.streaming_total_avg_s,
		"streaming_runs": [vars(x) for x in r.streaming_runs],
		"total_prompt_tokens": r.total_prompt_tokens,
		"total_completion_tokens": r.total_completion_tokens,
		"total_tokens": r.total_tokens,
		"nonstream_tokens_per_second": r.nonstream_tokens_per_second,
		"stream_tokens_per_second": r.stream_tokens_per_second,
	}


def extract_metrics_for_history(result: Dict[str, Any]) -> Dict[str, Any]:
	"""Extract the key metrics from a result to store in history"""
	timestamp = result.get("updated_at")
	if not timestamp:
		timestamp = datetime.now(timezone.utc).isoformat()
		
	return {
		"timestamp": timestamp,
		"key": result["key"],
		"provider": result["provider"],
		"model": result["model"],
		"nonstreaming_avg_s": result["nonstreaming_avg_s"],
		"streaming_ttfb_avg_s": result["streaming_ttfb_avg_s"],
		"streaming_total_avg_s": result["streaming_total_avg_s"],
		"nonstream_tokens_per_second": result["nonstream_tokens_per_second"],
		"stream_tokens_per_second": result["stream_tokens_per_second"],
	}


def update_history(results: List[Dict[str, Any]]) -> None:
	"""Update the history.json file with the latest results"""
	history_file = OUTPUT_DIR / "history.json"
	
	# Load existing history or create empty list
	if history_file.exists():
		try:
			history = json.loads(history_file.read_text())
			if not isinstance(history, list):
				LOGGER.warning("History file exists but is not a list, resetting")
				history = []
		except Exception as e:
			LOGGER.warning(f"Failed to parse history file: {e}, resetting")
			history = []
	else:
		history = []
		
	# Add new entries
	current_time = datetime.now(timezone.utc)
	cutoff_date = current_time - timedelta(days=HISTORY_RETENTION_DAYS)
	
	# Filter out old entries
	history = [entry for entry in history if datetime.fromisoformat(entry["timestamp"]) >= cutoff_date]
	
	# Add new entries
	for result in results:
		history.append(extract_metrics_for_history(result))
		
	# Write back to file
	history_file.write_text(json.dumps(history, indent=2))
	LOGGER.info(f"Updated history.json with {len(results)} new entries, total entries: {len(history)}")


def run() -> None:
	# Configure logging if not already set by the environment/runner
	if not logging.getLogger().handlers:
		logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

	LOGGER.info("Preparing output directory at %s", str(OUTPUT_DIR))
	OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

	LOGGER.info("Building benchmark config from environment")
	cfg = build_config_from_env()
	LOGGER.info(
		"Config: models=%d, runs=%d, mode=%s, timeout=%s",
		len(cfg.models), cfg.runs, cfg.mode, str(cfg.request_timeout_seconds),
	)

	results: List[ModelLatencySummary] = []
	result_updated_at: Dict[str, str] = {}
	# Use a single timestamp for all models
	benchmark_timestamp = datetime.now(timezone.utc).isoformat()
	reg = list_models(DEFAULT_REGISTRY)
	LOGGER.info("Starting benchmark for %d models", len(cfg.models))
	error_message: str | None = None
	for idx, key in enumerate(cfg.models, start=1):
		card = reg.get(key)
		if not card:
			LOGGER.warning("Skipping unknown model key: %s", key)
			continue
		LOGGER.info("[%d/%d] Running model %s (%s - %s)", idx, len(cfg.models), key, card.provider, card.model)
		try:
			res = summarize_model(
				model_key=key,
				card=card,
				prompt=cfg.prompt,
				runs=cfg.runs,
				mode=cfg.mode,
				request_timeout_seconds=cfg.request_timeout_seconds,
				model_overrides=cfg.model_overrides.get(key),
			)
		except Exception as exc:
			LOGGER.exception("Model %s failed", key)
			if error_message is None:
				error_message = f"Benchmark failures encountered. Last error: {type(exc).__name__}: {exc}"
			res = None
		if res is not None:
			results.append(res)
			# Use the same timestamp for all models
			result_updated_at[res.key] = benchmark_timestamp
			LOGGER.info("Completed model %s", key)

	# Write meta.json with optional error
	if not results and error_message is None:
		error_message = "No benchmark results were produced. Check API keys and configuration."
	meta = write_meta(OUTPUT_DIR / "meta.json", cfg, timestamp=benchmark_timestamp, error_message=error_message)
	LOGGER.info("Wrote meta.json")

	# Write results.json including per-model updated_at
	generated_at = meta.get("generated_at") if isinstance(meta, dict) else None
	json_results: List[Dict[str, Any]] = []
	for r in results:
		obj = _result_to_dict(r)
		obj["updated_at"] = result_updated_at.get(r.key) or generated_at
		json_results.append(obj)
	(OUTPUT_DIR / "results.json").write_text(json.dumps(json_results, indent=2))
	LOGGER.info("Wrote results.json with %d summaries", len(json_results))
	
	# Update history with the latest results
	update_history(json_results)
	LOGGER.info("Updated history data")


if __name__ == "__main__":
	run()

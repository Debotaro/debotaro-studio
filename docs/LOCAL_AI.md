# Optional local model inference

Studio can request a structured change proposal from a private Ollama server without a paid inference API. Editing, collaboration and export do not depend on this option. The default example configuration disables live inference. OpenAI remains a separately configured option; there is no fallback from Ollama to OpenAI and no paid call in the local evaluation.

## Trust and resource boundaries

Only trusted server environment selects the provider, model and endpoint. A browser request cannot supply a URL, model, schema or credentials. `OLLAMA_BASE_URL` must use HTTP at literal `127.0.0.1`/`[::1]`, or the exact private Compose service `ollama:11434`; credentials, paths, queries, fragments and redirects are refused. The local service has no authentication of its own: do not publish its port or expose it to untrusted local users. Run the serving instance without outbound network after the explicit initial model download.

`AI_PROVIDER=disabled` prevents inference even when provider credentials happen to be present. Select `AI_PROVIDER=ollama` deliberately after installing and verifying the local runtime/model. The reviewed tags are `qwen3.5:4b` and `qwen3.5:2b`; cloud model tags and arbitrary aliases are not accepted. Keep Ollama cloud support disabled with `OLLAMA_NO_CLOUD=1`.

Every request uses structured `format` JSON schema, non-streamed output, `think:false`, temperature 0, seed 17, a 16,384-token context window, 2,048 maximum generated tokens, two CPU threads and `num_gpu:0`. The application admits one concurrent Ollama request, caps context JSON at 24,000 UTF-8 bytes and caps the complete HTTP response at 300,000 bytes. Runtime settings should additionally limit loaded models, request parallelism and queue depth to one. Context-size refusals preserve editing/export; silently truncating the design is not a quality improvement.

`OLLAMA_TIMEOUT_MS` defaults to 120,000 and accepts integers from 1,000 through 180,000. Caller cancellation and timeout abort the HTTP request and refuse application. This bounds the application's wait; it does not prove instantaneous stopping of every backend CPU operation. Keep the runtime's own concurrency controls. Requests are not automatically retried. Responses with unfinished/truncated generation, malformed JSON or invalid operations are refused. Structured JSON is not sufficient proof of a safe or correct change.

The existing proposal decoder, permission/revision checks, dependency validation and whole-document invariants still apply. A valid proposal remains a reviewable draft and is never applied automatically. Layer text and the user's instruction are transmitted to the private model server; ticket datasets, code drafts and server credentials are excluded from the built context. Text a user types into a layer or request is not automatically redacted. Application requests do not log model text; the explicit synthetic evaluation records its controlled inputs/outputs.

## Local setup

Use a separately installed or workspace-contained Ollama runtime from its official distribution. A workspace-contained Windows CLI archive can run `ollama serve` without an installer or global PATH/environment change. Keep its home/model directories private and outside Git. The project's evaluation used an isolated owned runtime, not the user's global installation.

Example service settings, applied only to the owned Ollama process:

```text
OLLAMA_HOST=127.0.0.1:11434
OLLAMA_NO_CLOUD=1
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_MAX_QUEUE=1
OLLAMA_MODELS=<private persistent model directory>
```

Download the reviewed local model explicitly with `ollama pull qwen3.5:4b`. Check the actual digest in `/api/tags` against the accepted evaluation record before enabling a deployment; a mutable tag alone does not establish identical weights. Model download/storage and CPU/RAM are real resource requirements even when there is no API invoice. A 12 GB ARM host has not been proven suitable merely because a 32 GB Windows workstation can run it. Recheck dependency/runtime support and measure the actual target.

After a successful review, set these **Studio server** environment values:

```text
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
OLLAMA_TIMEOUT_MS=120000
```

For the private Compose service use `http://ollama:11434`. Never pass the runtime's server address or model parameters from a public request. `aiStatus.available` reports valid configuration, not daemon readiness or measured model quality. A stopped daemon produces an explicit provider error. Select `AI_PROVIDER=disabled` to leave inference off. Legacy OpenAI configuration is retained for compatibility, but a new deployment should select its provider explicitly; using that optional external provider requires separate cost authorization.

## Actual acceptance command and reporting

With the local runtime/model ready and the environment above selected:

```sh
node --import tsx scripts/verify-local-ai.ts
```

The command refuses any provider other than Ollama. It creates a fresh report under ignored `artifacts/local-ai/`, records the real model digest, runtime, hardware, options, source hashes, controlled prompts/context, raw model responses, validation errors, requested-effect checks and elapsed times. Each case starts with a fresh fictional document. Normal cases cover theme, layer name, padding, gap, a new token and displayed text. Adversarial cases cover a foreign-project/script request and instructions planted in layer text. Every generated proposal passes the unchanged application validation and explicit in-memory review/apply path; the original fixture must remain unchanged.

All cases are author-created **development acceptance fixtures**, not a held-out quality benchmark. They do not measure arbitrary design work, broad prompt-injection robustness, hosted latency, user satisfaction or equivalence to another model. Invalid responses and timeouts remain in the report. A safety refusal is distinguished from successfully performing the requested normal change. Unit/HTTP transport fixtures are separately labelled and are not live model evidence.

On 17 October 2026, the optional adapter passed 82 AI validation/transport tests, including actual loopback HTTP role, explicit-review and cancellation boundaries. These use labelled response fixtures, not model inference. Ollama v0.40.5's official standalone archive was downloaded and verified against SHA-256 `5134ce7e3bc8e94d0494721c799ec293b429450d0c52461b0ee3647dd3bb4bb7`; its isolated local server started with cloud disabled. The model download did not finish before the user's hosting direction changed. The owned server/download processes stopped and partial files were preserved. **No real local-model acceptance run occurred.**

Live acceptance remains pending. Do not enable public Ollama AI or describe the model as accepted until the concrete report is reviewed. No live OpenAI inference has been executed by this work. This optional local runtime does not establish card-free public hosting.

## Official references

- [Structured JSON schema output](https://docs.ollama.com/capabilities/structured-outputs) and [chat API](https://docs.ollama.com/api/chat): `format`, `think`, stream and runtime controls.
- [Windows standalone CLI](https://docs.ollama.com/windows): official CLI archive and `ollama serve`.
- [Qwen3.5 model library](https://ollama.com/library/qwen3.5:4b): reviewed model family and upstream license. Retain the actual model's license/notices when redistributing weights.

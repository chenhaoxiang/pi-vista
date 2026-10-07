# @pi-vista/adapter-shadow

An additive, opt-in ESM observer for **owner-normalized metadata** from Laya,
Kev, Intern-Decision-4B and StartLux-Decision-4B. Node.js 20 or later is required.
There is no owner reader, model runtime, selection policy, default activation,
authorization adapter, council verifier, or promotion pipeline.

```ts
import { toVistaEventInput, type ShadowObservation } from "@pi-vista/adapter-shadow";

const observation: ShadowObservation = {
  schema: "shadow-observation/1",
  shadow: true,
  model_family: "intern",
  model_id: "intern-decision-4b",
  model_version: "synthetic-v1",
  verdict: "pass",
  status: "observed",
  context_status: "complete",
  correlation: { run_id: "synthetic-run" },
  humanExpectationWritten: false,
  trainingEligible: false,
  promotionEligible: false,
};
const event = toVistaEventInput(observation); // pure, detached and deeply frozen
// event.result === "unknown"; a model pass never becomes permission or Vista ok.
```

`emitShadowObservation(observation, options?)` explicitly delegates best-effort
persistence to public `@pi-vista/core`. Input/schema/identity errors reject with
a fixed `VistaProtocolError` before callbacks; store failures/timeouts are
fail-open. A caller must keep optional observer failures out of its safety
owner's decision path. Use a plain own-data `{ append: event => store.append(event) }`
wrapper when supplying an `EventStore`; class instances are not source records.

The closed runtime boundary rejects unknown fields, undefined values, custom
prototypes, symbols, accessors, all Proxies (including revoked Proxies), unsafe
labels, paths, URLs, commands, packet bodies and known embedded credentials.
Raw guard wire events, authorization requests/votes, offline proof/report
objects, model inputs and outputs are **unsupported**. An owner must explicitly
select and normalize safe identity, outcome and digest metadata first.

See [the maintained adapter guide](../../docs/adapters/shadow.md) for the exact
schema, correlation rules, projection, failure behavior and limitations.
Source tests use only synthetic fixtures and public package imports. Passing
tests or packing this package does not establish registry publication, private
owner integration, real-input isolation, model quality, active/live admission,
training or promotion. The MIT license here covers adapter code, **not** any
model weights, runtime, datasets or owner licenses.

## Focused workspace validation

From the repository root (offline cache prerequisites must already exist):

```sh
npm install --no-package-lock --offline --ignore-scripts
npm run build --workspace=@pi-vista/protocol
npm run build --workspace=@pi-vista/core
npm run typecheck --workspace=@pi-vista/adapter-shadow
npm run test --workspace=@pi-vista/adapter-shadow
npm pack --dry-run --workspace=@pi-vista/adapter-shadow
```

Package test scripts use a fixed, shell-expanded `dist-test/*.test.mjs` glob,
not recursive Node glob support. Runtime has no external dependencies besides
the matching public core/protocol packages. This additive lane intentionally
does not modify root build/test/pack scripts or the lockfile: run the explicit
workspace commands above in addition to existing repository validation.

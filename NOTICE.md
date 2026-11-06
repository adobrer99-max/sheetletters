# Third-party parts and their licences

Sheet Letters' own code is MIT-licensed (see `LICENSE`). It uses, ships or downloads these:

| What | Used for | Licence | Where it comes from |
|---|---|---|---|
| **HTDemucs** by Meta Platforms (Simon Rouard, Francisco Massa, Alexandre Défossez) | Splitting a song into drums, bass, other and vocals | MIT | Model (`htdemucs_embedded.onnx`, ~172 MB) downloaded from Hugging Face ([timcsy/demucs-web-onnx](https://huggingface.co/timcsy/demucs-web-onnx)) the first time someone splits a song, then kept in the browser's cache |
| **demucs-web** by timcsy | Running HTDemucs in the browser | MIT | npm, bundled |
| **ONNX Runtime Web** by Microsoft | The engine that runs HTDemucs (WebGPU or WebAssembly) | MIT | Loaded from jsDelivr (`cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1`), because its WebGPU engine file is larger than many static hosts allow |
| **Basic Pitch** by Spotify | Hearing the notes in a recording | Apache 2.0 | npm, bundled; model in `public/models/basic-pitch` |
| **TensorFlow.js** by Google | The engine that runs Basic Pitch | Apache 2.0 | npm, bundled |
| **Salamander Grand Piano** by Alexander Holm | Piano sound for playback (trimmed to 6 s, mono) | CC BY 3.0 | `public/piano` |
| **Atkinson Hyperlegible** (Braille Institute), **Instrument Serif** (Instrument), **JetBrains Mono** (JetBrains) | Type | SIL Open Font Licence 1.1 | `src/assets/fonts`, via Fontsource |

## Privacy

Recordings are decoded, split and transcribed on the visitor's own device. No audio is uploaded.
The model and engine downloads above carry no audio and no personal data.

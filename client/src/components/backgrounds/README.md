# Aero Shards ambient background

This is a local visual experiment based on ReactBits `AeroShards`
(https://reactbits.dev/c/backgrounds/aero-shards).

The live WebGPU shader is **not** loaded at runtime. It was rendered once and
baked into theme-specific static stills:

- `client/public/ambient/aero-shards-dark.jpg`
- `client/public/ambient/aero-shards-light.jpg`

The stills are 1600×856 and preserve the original shader framing. The runtime
component renders only the matching still, so there is no WebGPU, video
decoding, animation loop, or loop seam. It is disabled below 768px.

The original component is MIT + Commons Clause. The exported image is used as
part of the application; do not redistribute it as a standalone background
pack.

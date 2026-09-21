/**
 * Registers the prepared sample clips as projects under DATA_DIR (runs prepare-samples first).
 * Out: <DATA_DIR>/projects/<sampleId>/{project.json, clip.mp4, strip.jpg}
 */
import { join } from "node:path";
import { SAMPLE_CLIPS } from "../src/lib/samples";
import { createProject } from "../src/lib/store/ingest";

async function main(): Promise<void> {
  for (const clip of SAMPLE_CLIPS) {
    const project = await createProject({
      id: clip.id,
      title: clip.title,
      kind: "sample",
      sourceFile: join("runtime/samples", clip.id, "clip.mp4"),
      alreadyNormalised: true,
      filmLanguageCode: "en-US",
      attribution: clip.attribution,
      license: clip.license,
    });
    console.log(
      `${project.id}: ${project.clipSeconds.toFixed(2)} s, strip step ${project.stripStepSeconds} s`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { collectBaiduIndex, loginBaidu } from "./baidu.js";
import { collectGoogleTrends, loginGoogle } from "./google.js";
import type { CollectOutput, Options, Source } from "./types.js";
import { toUnifiedMultiSourceOutput, toUnifiedOutput, type UnifiedMultiSourceOutput, type UnifiedOutput } from "./unified-output.js";

export type MultiSourceCollection = {
  outputs: [CollectOutput, CollectOutput];
  sourceOptions: [Options, Options];
};

export type SourceFailure = { source: Source; message: string };

export function collectFailures(collection: MultiSourceCollection): SourceFailure[] {
  return collection.outputs
    .filter((output): output is CollectOutput & { error: string } => Boolean(output.error))
    .map((output) => ({ source: output.source, message: output.error }));
}

export async function collectUnified(options: Options): Promise<UnifiedOutput | UnifiedMultiSourceOutput> {
  if (options.source === "all") {
    const { outputs, sourceOptions } = await collectAllSources(options);
    return toUnifiedMultiSourceOutput([
      toUnifiedOutput(outputs[0], sourceOptions[0]),
      toUnifiedOutput(outputs[1], sourceOptions[1]),
    ], options);
  }

  const output = await collectSource(options.source, options);
  return toUnifiedOutput(output, options);
}

export async function collectAllSources(options: Options): Promise<MultiSourceCollection> {
  const baiduOptions = optionsForSource(options, "baidu");
  const googleOptions = optionsForSource(options, "google");
  const settled = await Promise.allSettled([
    collectSource("baidu", baiduOptions),
    collectSource("google", googleOptions),
  ]);
  return {
    outputs: [
      settled[0].status === "fulfilled" ? settled[0].value : errorOutputFor("baidu", baiduOptions, settled[0].reason),
      settled[1].status === "fulfilled" ? settled[1].value : errorOutputFor("google", googleOptions, settled[1].reason),
    ],
    sourceOptions: [baiduOptions, googleOptions],
  };
}

function errorOutputFor(source: Source, options: Options, reason: unknown): CollectOutput {
  const message = reason instanceof Error ? reason.message : String(reason);
  return {
    capturedAt: new Date().toISOString(),
    source,
    sourceUrl: options.url || "",
    apiUrl: "",
    words: options.words,
    status: "no_data",
    reason: message,
    overview: [],
    trends: [],
    error: message,
  };
}

export async function collectSource(source: Source, options: Options): Promise<CollectOutput> {
  return await withProfileCollectionLock(source, options.profileDir, async () =>
    source === "google"
      ? await collectGoogleTrends(options)
      : await collectBaiduIndex(options)
  );
}

const profileCollectionLocks = new Map<string, Promise<void>>();

async function withProfileCollectionLock<T>(source: Source, profileDir: string, task: () => Promise<T>): Promise<T> {
  const key = `${source}:${profileDir}`;
  const previous = profileCollectionLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  profileCollectionLocks.set(key, previous.then(() => current, () => current));

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (profileCollectionLocks.get(key) === current) {
      profileCollectionLocks.delete(key);
    }
  }
}

export function optionsForSource(options: Options, source: Source): Options {
  const isProfileRoot = options.source === "all";
  const inherited = {
    ...options,
    source,
    profileDir: isProfileRoot ? `${options.profileDir}/${source}` : options.profileDir,
  };
  if (source === "google" && options.rangeLabel !== "custom") {
    return {
      ...inherited,
      startDate: undefined,
      endDate: undefined,
      days: undefined,
    };
  }
  return {
    ...inherited,
    range: undefined,
  };
}

export async function loginWithOptions(options: Options): Promise<void> {
  if (options.source === "all") {
    await loginAllSourcesSequential(options);
    return;
  }
  await loginSourceWithOptions(options);
}

export async function loginAllSourcesSequential(options: Options): Promise<void> {
  if (options.source === "all") {
    await loginBaidu(optionsForSource(options, "baidu"));
    await loginGoogle(optionsForSource(options, "google"));
    return;
  }
  await loginSourceWithOptions(options);
}

export async function loginSourceWithOptions(options: Options): Promise<void> {
  if (options.source === "google") {
    await loginGoogle(options);
    return;
  }
  await loginBaidu(options);
}

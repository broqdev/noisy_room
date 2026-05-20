const EUPHONY_HOME = "https://openai.github.io/euphony/";
const FALLBACK_BUNDLE_URL =
  "https://openai.github.io/euphony/assets/main-LKI_ICf3.js";

let loaderPromise: Promise<void> | null = null;

export function ensureOpenAiEuphony() {
  if (customElements.get("euphony-conversation")) {
    return Promise.resolve();
  }

  loaderPromise ??= loadOpenAiEuphony();
  return loaderPromise;
}

async function loadOpenAiEuphony() {
  const bundleUrl = await resolveBundleUrl();

  await new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[data-openai-euphony="true"]`,
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Failed to load OpenAI Euphony.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.crossOrigin = "anonymous";
    script.dataset.openaiEuphony = "true";
    script.src = bundleUrl;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Failed to load OpenAI Euphony.")),
      { once: true },
    );
    document.head.appendChild(script);
  });

  await Promise.race([
    customElements.whenDefined("euphony-conversation"),
    new Promise((_, reject) => {
      window.setTimeout(
        () => reject(new Error("OpenAI Euphony did not register in time.")),
        8000,
      );
    }),
  ]);
}

async function resolveBundleUrl() {
  try {
    const response = await fetch(EUPHONY_HOME, { cache: "no-store" });
    const html = await response.text();
    const match = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);

    if (match?.[1]) {
      return new URL(match[1], EUPHONY_HOME).href;
    }
  } catch (error) {
    console.warn("Using fallback OpenAI Euphony bundle URL.", error);
  }

  return FALLBACK_BUNDLE_URL;
}


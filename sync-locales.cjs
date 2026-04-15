#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const LOCALES_RELATIVE_PATH = path.join("public", "i18n", "locales");
const DEFAULT_REFERENCE_LOCALES = ["en"];
const DEFAULT_PLACEHOLDER = "TO BE TRANSLATED";
const DEFAULT_SORT_REFERENCES = true;
const DEFAULT_PAUSE_ON_EXIT = Boolean(process.pkg);

function parseArgs(argv) {
  const options = {
    baseDir: null,
    referenceLocales: DEFAULT_REFERENCE_LOCALES,
    refsProvided: false,
    placeholder: DEFAULT_PLACEHOLDER,
    dryRun: false,
    sortReferences: DEFAULT_SORT_REFERENCES,
    pauseOnExit: DEFAULT_PAUSE_ON_EXIT,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--sort-refs") {
      options.sortReferences = true;
      continue;
    }

    if (arg === "--no-sort-refs") {
      options.sortReferences = false;
      continue;
    }

    if (arg === "--pause") {
      options.pauseOnExit = true;
      continue;
    }

    if (arg === "--no-pause") {
      options.pauseOnExit = false;
      continue;
    }

    if (arg.startsWith("--base=")) {
      const value = arg.slice("--base=".length).trim();
      if (!value) {
        throw new Error("The --base option requires a value.");
      }
      options.baseDir = path.resolve(process.cwd(), value);
      continue;
    }

    if (arg.startsWith("--refs=")) {
      const value = arg.slice("--refs=".length);
      const refs = value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      if (refs.length === 0) {
        throw new Error("The --refs option requires at least one locale code.");
      }

      options.referenceLocales = refs;
      options.refsProvided = true;
      continue;
    }

    if (arg.startsWith("--placeholder=")) {
      options.placeholder = arg.slice("--placeholder=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readJsonObject(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`Expected a JSON object in ${filePath}`);
  }

  return parsed;
}

function sortObjectKeys(obj) {
  const sorted = {};
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b, "en"));

  for (const key of keys) {
    sorted[key] = obj[key];
  }

  return sorted;
}

function detectFileEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function hasTrailingEol(text) {
  return text.endsWith("\r\n") || text.endsWith("\n");
}

function stringifyJsonWithFormatting(obj, eol, keepTrailingEol) {
  const jsonWithLf = JSON.stringify(obj, null, 2);
  const normalizedJson =
    eol === "\n" ? jsonWithLf : jsonWithLf.replace(/\n/g, eol);
  return keepTrailingEol ? `${normalizedJson}${eol}` : normalizedJson;
}

function toNormalizedLineArray(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function countChangedLines(beforeText, afterText) {
  const beforeLines = toNormalizedLineArray(beforeText);
  const afterLines = toNormalizedLineArray(afterText);
  const maxLines = Math.max(beforeLines.length, afterLines.length);

  let changed = 0;
  for (let i = 0; i < maxLines; i += 1) {
    if (beforeLines[i] !== afterLines[i]) {
      changed += 1;
    }
  }

  return changed;
}

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getLocaleDirs(baseDir) {
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

function findLocalesDirFrom(startDir) {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, LOCALES_RELATIVE_PATH);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

function resolveBaseDir(baseDir) {
  if (baseDir) {
    if (!fs.existsSync(baseDir)) {
      throw new Error(`Locales directory not found: ${baseDir}`);
    }
    return baseDir;
  }

  const searchRoots = [
    process.cwd(),
    path.dirname(process.execPath),
    __dirname,
  ];
  const seen = new Set();

  for (const root of searchRoots) {
    const normalizedRoot = path.resolve(root);
    if (seen.has(normalizedRoot)) {
      continue;
    }
    seen.add(normalizedRoot);

    const found = findLocalesDirFrom(normalizedRoot);
    if (found) {
      return found;
    }
  }

  throw new Error(
    `Locales directory not found. Looked for ${LOCALES_RELATIVE_PATH} from: ${Array.from(seen).join("; ")}. Use --base=<path>.`,
  );
}

function waitForExitKeyPress() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Press Enter to close...", () => {
      rl.close();
      resolve();
    });
  });
}

async function maybePauseBeforeExit(pauseOnExit) {
  if (!pauseOnExit) {
    return;
  }

  await waitForExitKeyPress();
}

function moveCursorUp(lines) {
  if (lines > 0) {
    process.stdout.write(`\x1b[${lines}A`);
  }
}

function moveCursorDown(lines) {
  if (lines > 0) {
    process.stdout.write(`\x1b[${lines}B`);
  }
}

function clearCurrentLine() {
  process.stdout.write("\x1b[2K\r");
}

function clearRenderedLines(lines) {
  moveCursorUp(lines);

  for (let i = 0; i < lines; i += 1) {
    clearCurrentLine();
    if (i < lines - 1) {
      moveCursorDown(1);
    }
  }

  moveCursorUp(lines - 1);
}

function clearScreen() {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write("\x1b[2J\x1b[0f");
}

async function promptSingleSelect(title, options) {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    const renderedLines = options.length + 1;

    const render = () => {
      process.stdout.write(`${title}\n`);
      for (let i = 0; i < options.length; i += 1) {
        const prefix = i === selectedIndex ? "> " : "  ";
        process.stdout.write(`${prefix}${options[i].label}\n`);
      }
    };

    const rerender = () => {
      clearRenderedLines(renderedLines);
      render();
    };

    const cleanup = () => {
      process.stdin.off("data", onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };

    const onData = (chunk) => {
      const key = chunk.toString("utf8");

      if (key === "\u0003") {
        cleanup();
        process.exit(1);
      }

      if (key === "\r" || key === "\n") {
        const chosen = options[selectedIndex].value;
        cleanup();
        resolve(chosen);
        return;
      }

      if (key === "\u001b[A") {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        rerender();
        return;
      }

      if (key === "\u001b[B") {
        selectedIndex = (selectedIndex + 1) % options.length;
        rerender();
      }
    };

    render();
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function selectReferenceLocaleInteractive(baseDir) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const localeDirs = getLocaleDirs(baseDir);
  const otherMenuLocales = Array.from(new Set(localeDirs)).sort((a, b) =>
    a.localeCompare(b, "en"),
  );

  while (true) {
    const mainChoice = await promptSingleSelect(
      "Select reference locale (Use arrows and Enter):",
      [
        { label: "it", value: "it" },
        { label: "en", value: "en" },
        { label: "other languages", value: "__other__" },
      ],
    );

    if (mainChoice !== "__other__") {
      process.stdout.write(`Selected reference locale: ${mainChoice}\n`);
      return mainChoice;
    }

    clearScreen();

    const otherOptions = otherMenuLocales.map((locale) => ({
      label: locale,
      value: locale,
    }));
    otherOptions.push({ label: "go back", value: "__back__" });

    const otherChoice = await promptSingleSelect(
      "Select one of the other available languages (Use arrows and Enter):",
      otherOptions,
    );

    if (otherChoice !== "__back__") {
      process.stdout.write(`Selected reference locale: ${otherChoice}\n`);
      return otherChoice;
    }

    clearScreen();
  }
}

function runSync(options) {
  const localeDirs = getLocaleDirs(options.baseDir);

  if (localeDirs.length === 0) {
    throw new Error(`No locale folders found in ${options.baseDir}`);
  }

  for (const ref of options.referenceLocales) {
    if (!localeDirs.includes(ref)) {
      throw new Error(
        `Reference locale folder not found: ${path.join(options.baseDir, ref)}`,
      );
    }
  }

  const referenceSet = new Set(options.referenceLocales);
  const targetLocales = localeDirs.filter(
    (locale) => !referenceSet.has(locale),
  );

  if (targetLocales.length === 0 && !options.sortReferences) {
    throw new Error("No target locales found after excluding references.");
  }

  const fileSet = new Set();
  for (const ref of options.referenceLocales) {
    const refDir = path.join(options.baseDir, ref);
    const refFiles = fs
      .readdirSync(refDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);

    for (const fileName of refFiles) {
      fileSet.add(fileName);
    }
  }

  const files = Array.from(fileSet).sort((a, b) => a.localeCompare(b, "en"));
  if (files.length === 0) {
    throw new Error("No JSON files found in reference locale folders.");
  }

  const localesToProcess = options.sortReferences ? localeDirs : targetLocales;

  let filesWritten = 0;
  let totalMissingAdded = 0;
  let sortOnlyFilesChanged = 0;
  let sortOnlyLinesChanged = 0;

  for (const fileName of files) {
    const referenceKeys = new Set();

    for (const ref of options.referenceLocales) {
      const refPath = path.join(options.baseDir, ref, fileName);
      if (!fs.existsSync(refPath)) {
        continue;
      }

      const refJson = readJsonObject(refPath);
      for (const key of Object.keys(refJson)) {
        referenceKeys.add(key);
      }
    }

    const orderedReferenceKeys = Array.from(referenceKeys).sort((a, b) =>
      a.localeCompare(b, "en"),
    );

    for (const locale of localesToProcess) {
      const localeDir = path.join(options.baseDir, locale);
      const localePath = path.join(localeDir, fileName);
      const fileExists = fs.existsSync(localePath);
      const originalText = fileExists
        ? fs.readFileSync(localePath, "utf8")
        : "";
      const currentJson = fileExists ? readJsonObject(localePath) : {};
      const fileEol = fileExists ? detectFileEol(originalText) : "\n";
      const keepTrailingEol = fileExists ? hasTrailingEol(originalText) : true;

      let missingAdded = 0;

      if (!referenceSet.has(locale)) {
        for (const key of orderedReferenceKeys) {
          if (!Object.prototype.hasOwnProperty.call(currentJson, key)) {
            currentJson[key] = options.placeholder;
            missingAdded += 1;
          }
        }
      }

      const sortedJson = sortObjectKeys(currentJson);
      const nextText = stringifyJsonWithFormatting(
        sortedJson,
        fileEol,
        keepTrailingEol,
      );

      if (nextText !== originalText) {
        if (!options.dryRun) {
          ensureDirectoryExists(localeDir);
          fs.writeFileSync(localePath, nextText, "utf8");
        }

        filesWritten += 1;
        totalMissingAdded += missingAdded;
        if (missingAdded === 0) {
          sortOnlyFilesChanged += 1;
          sortOnlyLinesChanged += countChangedLines(originalText, nextText);
        }

        const action = options.dryRun ? "would update" : "updated";
        console.log(
          `${action} ${path.relative(process.cwd(), localePath)} (missing added: ${missingAdded})`,
        );
      }
    }
  }

  const modeLabel = options.dryRun ? "Dry run completed" : "Sync completed";
  console.log(
    `${modeLabel}. Files changed: ${filesWritten}, missing keys added: ${totalMissingAdded}, sort-only lines changed: ${sortOnlyLinesChanged} (files: ${sortOnlyFilesChanged}).`,
  );
}

async function run() {
  let options = null;

  try {
    options = parseArgs(process.argv.slice(2));
    options.baseDir = resolveBaseDir(options.baseDir);

    if (!options.refsProvided) {
      const selected = await selectReferenceLocaleInteractive(options.baseDir);
      if (selected) {
        options.referenceLocales = [selected];
      }
    }

    runSync(options);
    await maybePauseBeforeExit(options.pauseOnExit);
  } catch (error) {
    console.error(error.message);
    const pauseOnExit = options ? options.pauseOnExit : DEFAULT_PAUSE_ON_EXIT;
    await maybePauseBeforeExit(pauseOnExit);
    process.exit(1);
  }
}

run();

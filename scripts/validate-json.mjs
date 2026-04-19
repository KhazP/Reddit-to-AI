import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REQUIRED_FILES = [
  "manifest.json",
  "_locales/en/messages.json"
];
const IGNORE_DIRS = new Set([".git", "node_modules", "images"]);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectJsonFiles(dir, output = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        await collectJsonFiles(path.join(dir, entry.name), output);
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      output.push(path.join(dir, entry.name));
    }
  }

  return output;
}

function validateLocaleShape(filePath, parsed) {
  const errors = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object") {
      errors.push(`${filePath}: key '${key}' must map to an object`);
      continue;
    }

    if (typeof value.message !== "string") {
      errors.push(`${filePath}: key '${key}' is missing a string 'message' field`);
    }
  }

  return errors;
}

async function main() {
  const errors = [];

  for (const relativePath of REQUIRED_FILES) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!(await exists(absolutePath))) {
      errors.push(`Missing required file: ${relativePath}`);
    }
  }

  const files = await collectJsonFiles(ROOT);

  for (const filePath of files) {
    const relativePath = path.relative(ROOT, filePath).replaceAll(path.sep, "/");

    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);

      if (relativePath.startsWith("_locales/") && relativePath.endsWith("/messages.json")) {
        errors.push(...validateLocaleShape(relativePath, parsed));
      }
    } catch (error) {
      errors.push(`${relativePath}: invalid JSON (${error.message})`);
    }
  }

  if (errors.length > 0) {
    console.error("JSON validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`JSON validation passed for ${files.length} file(s).`);
}

main().catch(error => {
  console.error("Unexpected validation error:", error);
  process.exit(1);
});
